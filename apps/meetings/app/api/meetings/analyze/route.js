import { analyzeMeetingUploads, getMeetingStoreStats } from "../../../../lib/meeting-transcript-agent.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ ok: true, store: await getMeetingStoreStats({ root: process.cwd() }) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not read meeting store" },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item) => item && typeof item.arrayBuffer === "function");
    const result = await analyzeMeetingUploads(files, {
      root: process.cwd(),
      retrievalQuery: form.get("retrievalQuery"),
      guidance: form.get("guidance"),
      outputInstructions: form.get("outputInstructions"),
      chatModel: form.get("chatModel"),
      embeddingModel: form.get("embeddingModel"),
      ramProfile: form.get("ramProfile"),
      parserMode: form.get("parserMode"),
      omniparseParseMode: form.get("omniparseParseMode"),
      temperature: form.get("temperature"),
      topP: form.get("topP"),
      numCtx: form.get("numCtx"),
      numPredict: form.get("numPredict"),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Meeting analysis failed" },
      { status: 400 },
    );
  }
}
