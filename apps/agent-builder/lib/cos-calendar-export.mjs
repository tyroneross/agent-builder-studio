const DAY_OFFSETS = new Map([
  ["sunday", 6],
  ["sun", 6],
  ["monday", 0],
  ["mon", 0],
  ["tuesday", 1],
  ["tue", 1],
  ["tues", 1],
  ["wednesday", 2],
  ["wed", 2],
  ["thursday", 3],
  ["thu", 3],
  ["thur", 3],
  ["thurs", 3],
  ["friday", 4],
  ["fri", 4],
  ["saturday", 5],
  ["sat", 5],
]);

export function calendarBlocksFromTranscript(transcript) {
  const blocks = transcript?.nodes?.time_block_plan?.parsed?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block, index) => ({
    id: `block-${index + 1}`,
    approved: true,
    day: clean(block.day),
    start: clean(block.start),
    end: clean(block.end),
    mode: clean(block.mode),
    why: clean(block.why),
  }));
}

export function buildApprovedCalendarIcs(blocks, options = {}) {
  const approved = (blocks ?? []).filter((block) => block?.approved !== false);
  const weekOf = normalizeWeekStart(options.weekOf);
  const stamp = formatIcsDateTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agent Builder//Chief of Staff//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  approved.forEach((block, index) => {
    const dayDate = dateForDay(weekOf, block.day);
    const start = parseTime(block.start) ?? "09:00";
    const end = parseTime(block.end) ?? addMinutes(start, 60);
    const summary = block.mode || `Chief of Staff block ${index + 1}`;
    const description = block.why || "Approved Chief of Staff time block.";
    lines.push(
      "BEGIN:VEVENT",
      `UID:agent-builder-cos-${dayDate}-${index + 1}@local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatFloatingDateTime(dayDate, start)}`,
      `DTEND:${formatFloatingDateTime(dayDate, end)}`,
      `SUMMARY:${escapeIcs(summary)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      "END:VEVENT",
    );
  });

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function calendarReviewStats(blocks) {
  const total = blocks?.length ?? 0;
  const approved = (blocks ?? []).filter((block) => block?.approved !== false).length;
  return {
    total,
    approved,
    rejected: total - approved,
  };
}

function normalizeWeekStart(value) {
  const parsed = parseWeekOf(value);
  return parsed ?? "2026-01-05";
}

function parseWeekOf(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return mondayForDate(text);
  const iso = text.match(/^(\d{4})-?W(\d{2})$/i);
  if (!iso) return null;
  const [, yearRaw, weekRaw] = iso;
  const year = Number(yearRaw);
  const week = Number(weekRaw);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return formatDate(jan4);
}

function mondayForDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - day + 1);
  return formatDate(dt);
}

function dateForDay(weekOf, day) {
  const offset = DAY_OFFSETS.get(String(day ?? "").toLowerCase()) ?? 0;
  const [y, m, d] = weekOf.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return formatDate(dt);
}

function parseTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const next = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function formatFloatingDateTime(date, time) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function formatIcsDateTime(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function escapeIcs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function clean(value) {
  return String(value ?? "").trim();
}
