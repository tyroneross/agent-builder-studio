import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedCalendarIcs } from "../lib/cos-calendar-export.mjs";
import { normalizeScheduleInput, parseIcsCalendar } from "../lib/cos-schedule-input.mjs";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
DTSTART:20260615T090000
DTEND:20260615T100000
SUMMARY:Deep work on migration
LOCATION:Office
END:VEVENT
BEGIN:VEVENT
UID:event-2
DTSTART:20260616T140000
DTEND:20260616T143000
SUMMARY:Sync with Sam
END:VEVENT
END:VCALENDAR`;

test("parseIcsCalendar converts VEVENT rows into schedule events", () => {
  const parsed = parseIcsCalendar(ICS);
  assert.equal(parsed.schedule.schemaVersion, "agent-builder.schedule-input.v1");
  assert.equal(parsed.schedule.sourceType, "ics");
  assert.equal(parsed.schedule.weekOf, "2026-06-15");
  assert.equal(parsed.schedule.events.length, 2);
  assert.equal(parsed.schedule.events[0].day, "Monday");
  assert.equal(parsed.schedule.events[0].start, "09:00");
  assert.equal(parsed.schedule.events[0].type, "deep_work");
  assert.equal(parsed.warnings.length, 0);
});

test("normalizeScheduleInput detects .ics and JSON sources", () => {
  const ics = normalizeScheduleInput(ICS, { fileName: "calendar.ics" });
  assert.equal(ics.sourceType, "ics");
  assert.equal(ics.eventCount, 2);
  assert.match(ics.normalizedText, /Deep work on migration/);

  const json = normalizeScheduleInput('{"weekOf":"2026-06-15","events":[{"title":"x"}]}');
  assert.equal(json.sourceType, "json");
  assert.equal(json.eventCount, 1);
});

test("buildApprovedCalendarIcs includes only approved blocks", () => {
  const ics = buildApprovedCalendarIcs([
    { approved: true, day: "Monday", start: "09:00", end: "10:00", mode: "Deep work", why: "Protect focus" },
    { approved: false, day: "Tuesday", start: "11:00", end: "12:00", mode: "Rejected", why: "No" },
  ], { weekOf: "2026-06-15" });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Deep work/);
  assert.doesNotMatch(ics, /Rejected/);
  assert.match(ics, /DTSTART:20260615T090000/);
});
