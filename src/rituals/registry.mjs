import { generateDailyPlan } from "./daily-plan/run.mjs";
import { planToMarkdown } from "./daily-plan/render.mjs";

export const RITUALS = {
  "daily-plan": {
    id: "daily-plan",
    label: "Daily Plan",
    maturity: "implemented",
    permissions: ["read-local", "draft", "ask-first"],
    run: generateDailyPlan,
    render: planToMarkdown,
  },
  "weekly-review": {
    id: "weekly-review",
    label: "Weekly Review",
    maturity: "planned",
    permissions: ["read-local", "draft", "ask-first"],
  },
  "meeting-prep": {
    id: "meeting-prep",
    label: "Meeting Prep",
    maturity: "planned",
    permissions: ["read-local", "draft", "ask-first"],
  },
  "end-of-day-review": {
    id: "end-of-day-review",
    label: "End-of-Day Review",
    maturity: "planned",
    permissions: ["read-local", "draft", "ask-first"],
  },
};

export function listRituals() {
  return Object.values(RITUALS).map(({ run, render, ...ritual }) => ritual);
}
