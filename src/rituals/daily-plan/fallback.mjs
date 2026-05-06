import { parseIcsEvents } from "../../integrations/calendar/ics.mjs";

function eventToBlock(event, fallbackDate) {
  const date = event.start?.slice(0, 8);
  const isoDate = date && date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : fallbackDate;
  const start = event.start?.match(/T(\d{2})(\d{2})/) || [];
  const end = event.end?.match(/T(\d{2})(\d{2})/) || [];
  return {
    date: isoDate,
    start: start[1] ? `${start[1]}:${start[2]}` : "09:00",
    end: end[1] ? `${end[1]}:${end[2]}` : "10:00",
    title: event.summary || "Calendar event",
    mode: /deep|focus|write|build/i.test(event.summary || "") ? "deep-work" : "fixed-event",
    why: event.description || "Imported calendar commitment.",
  };
}

export function deterministicDailyPlan({ date, goal, notes, scheduleText }) {
  const planDate = date || new Date().toISOString().slice(0, 10);
  const importedEvents = /BEGIN:VCALENDAR/.test(scheduleText || "") ? parseIcsEvents(scheduleText) : [];
  const fixedBlocks = importedEvents.slice(0, 5).map((event) => eventToBlock(event, planDate));
  const focusBlock = {
    date: planDate,
    start: "09:30",
    end: "11:00",
    title: "Protected priority block",
    mode: "deep-work",
    why: "Default high-leverage block when no better schedule signal is available.",
  };
  const adminBlock = {
    date: planDate,
    start: "16:00",
    end: "16:30",
    title: "Follow-up sweep",
    mode: "admin",
    why: "Batch open loops and reduce context switching.",
  };
  const scheduleBlocks = fixedBlocks.length ? fixedBlocks : [focusBlock, adminBlock];
  return {
    title: "Daily Operating Plan",
    date: planDate,
    summary: "A local deterministic plan was created. Run with Ollama enabled for richer prioritization.",
    topPriorities: [
      {
        outcome: goal || "Clarify the highest-leverage outcome for today.",
        why: "The plan needs one explicit outcome to protect time and reduce reactive work.",
        owner: null,
      },
    ],
    scheduleBlocks,
    followUps: [
      {
        owner: null,
        action: "Review open loops and assign owners before end of day.",
        dueBy: planDate,
      },
    ],
    risks: [
      {
        risk: "Incomplete context may hide real deadlines or fixed commitments.",
        severity: "medium",
        mitigation: "Import calendar data and add explicit owner/action/date notes.",
      },
    ],
    approvalsNeeded: [],
    notes: notes ? ["User notes were included as planning context."] : ["No notes were provided."],
  };
}
