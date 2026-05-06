import test from "node:test";
import assert from "node:assert/strict";
import { deterministicDailyPlan } from "../src/rituals/daily-plan/fallback.mjs";
import { planToMarkdown } from "../src/rituals/daily-plan/render.mjs";

test("deterministic plan produces safe local operating output", () => {
  const plan = deterministicDailyPlan({
    date: "2026-05-01",
    goal: "Protect strategy work",
    notes: "Need to follow up with Alex.",
    scheduleText: "",
  });
  assert.equal(plan.date, "2026-05-01");
  assert.ok(plan.topPriorities[0].outcome.includes("Protect strategy work"));
  assert.equal(plan.approvalsNeeded.length, 0);
  assert.match(planToMarkdown(plan), /Daily Operating Plan/);
});
