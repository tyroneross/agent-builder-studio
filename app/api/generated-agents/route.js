import { listGeneratedAgentStructures } from "../../../lib/generated-agent-packages.mjs";

export const runtime = "nodejs";

export async function GET() {
  try {
    const structures = await listGeneratedAgentStructures({ root: process.cwd() });
    return Response.json({ ok: true, structures });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not list generated agents" },
      { status: 500 },
    );
  }
}
