function unfoldIcs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line.trimEnd());
      }
      return lines;
    }, []);
}

function valueAfterColon(line) {
  const index = line.indexOf(":");
  return index >= 0 ? line.slice(index + 1) : "";
}

function getField(lines, name) {
  const line = lines.find((entry) => entry.startsWith(`${name}:`) || entry.startsWith(`${name};`));
  return line ? valueAfterColon(line) : null;
}

export function parseIcsEvents(text) {
  const lines = unfoldIcs(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT" && current) {
      events.push({
        uid: getField(current, "UID"),
        summary: unescapeIcs(getField(current, "SUMMARY") || "Untitled event"),
        description: unescapeIcs(getField(current, "DESCRIPTION") || ""),
        location: unescapeIcs(getField(current, "LOCATION") || ""),
        start: getField(current, "DTSTART"),
        end: getField(current, "DTEND"),
      });
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return events;
}

export function escapeIcs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function unescapeIcs(value) {
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function formatIcsDate(date, time) {
  const cleanDate = String(date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const cleanTime = String(time || "0900").replace(":", "").padEnd(4, "0");
  return `${cleanDate}T${cleanTime}00`;
}

export function buildIcs({ title = "Chief of Staff Plan", blocks = [], date }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const events = blocks.map((block, index) => {
    const start = formatIcsDate(block.date || date, block.start);
    const end = formatIcsDate(block.date || date, block.end);
    return [
      "BEGIN:VEVENT",
      `UID:cos-${Date.now()}-${index}@chief-of-staff.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcs(block.title || block.mode || "Chief of Staff block")}`,
      `DESCRIPTION:${escapeIcs(block.why || title)}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chief of Staff//Local Plan//EN",
    `X-WR-CALNAME:${escapeIcs(title)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
