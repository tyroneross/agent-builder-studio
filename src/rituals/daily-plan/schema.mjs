export const DAILY_PLAN_SCHEMA = {
  title: "string",
  date: "YYYY-MM-DD",
  summary: "string",
  topPriorities: [{ outcome: "string", why: "string", owner: "string|null" }],
  scheduleBlocks: [{ date: "YYYY-MM-DD", start: "HH:mm", end: "HH:mm", title: "string", mode: "string", why: "string" }],
  followUps: [{ owner: "string|null", action: "string", dueBy: "string|null" }],
  risks: [{ risk: "string", severity: "low|medium|high", mitigation: "string" }],
  approvalsNeeded: [{ kind: "calendar|document|message|system|internet", title: "string", summary: "string" }],
  notes: ["string"],
};

export function normalizeDailyPlan(plan, date) {
  const planDate = plan?.date || date || new Date().toISOString().slice(0, 10);
  return {
    title: plan?.title || "Daily Operating Plan",
    date: planDate,
    summary: plan?.summary || "",
    topPriorities: Array.isArray(plan?.topPriorities) ? plan.topPriorities : [],
    scheduleBlocks: Array.isArray(plan?.scheduleBlocks) ? plan.scheduleBlocks : [],
    followUps: Array.isArray(plan?.followUps) ? plan.followUps : [],
    risks: Array.isArray(plan?.risks) ? plan.risks : [],
    approvalsNeeded: Array.isArray(plan?.approvalsNeeded) ? plan.approvalsNeeded : [],
    notes: Array.isArray(plan?.notes) ? plan.notes : [],
  };
}
