import { enqueueApproval } from "../../core/approvals/approval-queue.mjs";
import { createDocument } from "../../core/workspace/documents.mjs";
import { ensureWorkspace, saveSystemArtifact } from "../../core/workspace/workspace.mjs";
import { generateDailyPlan } from "../../rituals/daily-plan/run.mjs";
import { planToMarkdown } from "../../rituals/daily-plan/render.mjs";
import { readBody, sendJson } from "../http.mjs";

export async function dailyPlanRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  const result = await generateDailyPlan(body);
  const planName = `plans/daily-${result.plan.date}-${Date.now()}.json`;
  await saveSystemArtifact(planName, `${JSON.stringify(result, null, 2)}\n`);
  const doc = await createDocument({
    name: `daily-plan-${result.plan.date}-${Date.now()}.md`,
    content: planToMarkdown(result.plan),
  });
  for (const approval of result.plan.approvalsNeeded || []) {
    await enqueueApproval({
      kind: approval.kind,
      title: approval.title,
      summary: approval.summary,
      payload: approval,
      requiredPermission: "ask-first",
    });
  }
  sendJson(res, 200, { ...result, document: doc });
}
