import { searchMeetingMemory } from "../../../../lib/meeting-transcript-agent.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await searchMeetingMemory(body?.query ?? "", {
      root: process.cwd(),
      embeddingModel: body?.embeddingModel,
      mode: body?.mode,
      limit: body?.limit ?? 8,
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Meeting search failed" },
      { status: 400 },
    );
  }
}
