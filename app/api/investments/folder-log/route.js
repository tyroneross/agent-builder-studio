import { saveInvestmentFolderLog } from "../../../../lib/investment-review-store.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await saveInvestmentFolderLog(body, { root: process.cwd() });

    return Response.json({
      ok: true,
      path: result.relativePath,
      jsonPath: result.relativeJsonPath,
      markdown: result.markdown,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not save folder log",
      },
      { status: 400 },
    );
  }
}
