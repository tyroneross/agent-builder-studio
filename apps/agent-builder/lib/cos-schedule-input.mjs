const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function detectScheduleInput(text = "", fileName = "") {
  const raw = String(text ?? "");
  const name = String(fileName ?? "").toLowerCase();
  const trimmed = raw.trim();
  if (name.endsWith(".ics") || /BEGIN:VCALENDAR/i.test(trimmed) || /BEGIN:VEVENT/i.test(trimmed)) return "ics";
  if (/^\s*[\[{]/.test(raw)) return "json";
  return "plain-text";
}

export function normalizeScheduleInput(text = "", options = {}) {
  const sourceType = detectScheduleInput(text, options.fileName);
  const raw = String(text ?? "");
  if (sourceType === "ics") {
    const parsed = parseIcsCalendar(raw, options);
    return {
      sourceType: "ics",
      normalizedText: `${JSON.stringify(parsed.schedule, null, 2)}\n`,
      parsed: parsed.schedule,
      eventCount: parsed.schedule.events.length,
      warnings: parsed.warnings,
    };
  }

  if (sourceType === "json") {
    try {
      const parsed = JSON.parse(raw);
      const eventCount = countScheduleEvents(parsed);
      return {
        sourceType: "json",
        normalizedText: `${JSON.stringify(parsed, null, 2)}\n`,
        parsed,
        eventCount,
        warnings: [],
      };
    } catch (error) {
      return {
        sourceType: "plain-text",
        normalizedText: raw.trim(),
        parsed: null,
        eventCount: null,
        warnings: [`Input looked like JSON but could not be parsed: ${error.message}`],
      };
    }
  }

  return {
    sourceType: "plain-text",
    normalizedText: raw.trim(),
    parsed: null,
    eventCount: null,
    warnings: [],
  };
}

export function parseIcsCalendar(text = {}, options = {}) {
  const lines = unfoldIcsLines(String(text ?? ""));
  const warnings = [];
  const events = [];
  let current = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  const normalizedEvents = events.map((eventLines, index) => normalizeIcsEvent(eventLines, index, warnings));
  const firstDate = normalizedEvents.find((event) => event.date)?.date;
  const weekOf = firstDate ? mondayForDate(firstDate) : options.weekOf ?? null;
  if (!firstDate) warnings.push("No DTSTART date found in the calendar.");

  return {
    schedule: {
      schemaVersion: "agent-builder.schedule-input.v1",
      sourceType: "ics",
      weekOf,
      events: normalizedEvents.map(({ date, ...event }) => event),
    },
    warnings,
  };
}

export function describeScheduleInput(meta) {
  if (!meta) return "No schedule loaded.";
  if (meta.sourceType === "ics") return `${meta.eventCount ?? 0} calendar events imported from .ics.`;
  if (meta.sourceType === "json") return `${meta.eventCount ?? 0} structured events loaded from JSON.`;
  return "Plain text schedule will be parsed by the intake node.";
}

function normalizeIcsEvent(lines, index, warnings) {
  const props = readIcsProperties(lines);
  const start = parseIcsDate(firstProp(props, "DTSTART")?.value);
  const end = parseIcsDate(firstProp(props, "DTEND")?.value);
  const title = cleanText(firstProp(props, "SUMMARY")?.value) || `Calendar event ${index + 1}`;
  const description = cleanText(firstProp(props, "DESCRIPTION")?.value);
  const location = cleanText(firstProp(props, "LOCATION")?.value);
  const uid = cleanText(firstProp(props, "UID")?.value);
  const derivedEnd = end ?? deriveEnd(start);

  if (!start) warnings.push(`VEVENT ${index + 1} is missing DTSTART.`);
  if (!end && start) warnings.push(`VEVENT "${title}" is missing DTEND; defaulted to 30 minutes.`);

  return {
    sourceUid: uid || null,
    date: start?.date ?? null,
    day: start?.day ?? null,
    start: start?.time ?? "00:00",
    end: derivedEnd?.time ?? "00:30",
    title,
    type: classifyEvent(title, description),
    fixed: true,
    location: location || null,
    description: description || null,
  };
}

function readIcsProperties(lines) {
  const props = new Map();
  for (const line of lines) {
    const parsed = parseIcsLine(line);
    if (!parsed) continue;
    const list = props.get(parsed.name) ?? [];
    list.push(parsed);
    props.set(parsed.name, list);
  }
  return props;
}

function parseIcsLine(line) {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const key = line.slice(0, idx);
  const value = unescapeIcsValue(line.slice(idx + 1));
  const [name, ...paramParts] = key.split(";");
  const params = Object.fromEntries(
    paramParts.map((part) => {
      const [k, ...rest] = part.split("=");
      return [k.toUpperCase(), rest.join("=")];
    }),
  );
  return { name: name.toUpperCase(), params, value };
}

function firstProp(props, name) {
  return props.get(name)?.[0] ?? null;
}

function unfoldIcsLines(text) {
  const lines = [];
  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(raw) && lines.length) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw.trimEnd());
    }
  }
  return lines.filter(Boolean);
}

function parseIcsDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, hh = "00", mm = "00"] = match;
  const date = `${y}-${m}-${d}`;
  return {
    date,
    day: dayNameForDate(date),
    time: `${hh}:${mm}`,
  };
}

function deriveEnd(start) {
  if (!start?.date || !start?.time) return null;
  return { ...start, time: addMinutes(start.time, 30) };
}

function addMinutes(time, minutes) {
  const [h, m] = String(time).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const total = h * 60 + m + minutes;
  const next = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function dayNameForDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAY_NAMES[day];
}

function mondayForDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - day + 1);
  return formatDate(dt);
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function countScheduleEvents(parsed) {
  if (Array.isArray(parsed)) return parsed.length;
  if (!parsed || typeof parsed !== "object") return 0;
  return [
    ...(Array.isArray(parsed.events) ? parsed.events : []),
    ...(Array.isArray(parsed.fixedEvents) ? parsed.fixedEvents : []),
    ...(Array.isArray(parsed.flexibleEvents) ? parsed.flexibleEvents : []),
  ].length;
}

function classifyEvent(title, description) {
  const text = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\b(deep|focus|build|write|design|strategy)\b/.test(text)) return "deep_work";
  if (/\b(inbox|admin|ops|follow[- ]?up)\b/.test(text)) return "admin";
  if (/\b(review|qa|retro|readout)\b/.test(text)) return "review";
  if (/\b(1:1|meeting|sync|call|standup|checkpoint)\b/.test(text)) return "coordination";
  return "fixed";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unescapeIcsValue(value) {
  return String(value ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
