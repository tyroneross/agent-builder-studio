import { saveInvestmentReview } from "../../../../lib/investment-review-store.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await saveInvestmentReview(body, { root: process.cwd() });

    return Response.json({
      ok: true,
      path: result.relativePath,
      markdown: result.markdown,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not save review",
      },
      { status: 400 },
    );
  }
}
