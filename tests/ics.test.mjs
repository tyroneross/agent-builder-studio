import test from "node:test";
import assert from "node:assert/strict";
import { buildIcs, parseIcsEvents } from "../src/integrations/calendar/ics.mjs";

test("parses and exports basic calendar events", () => {
  const ics = buildIcs({
    title: "Plan",
    date: "2026-05-01",
    blocks: [{ start: "09:00", end: "10:00", title: "Deep Work", mode: "deep-work", why: "Protect focus" }],
  });
  const events = parseIcsEvents(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "Deep Work");
  assert.equal(events[0].start, "20260501T090000");
});
