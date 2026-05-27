import { validateInvestmentClaims } from "../../../../lib/investment-research.mjs";

export async function POST(request) {
  try {
    const body = await request.json();
    const claims = Array.isArray(body.claims) ? body.claims : [];
    const validation = await validateInvestmentClaims(claims);
    return Response.json({ ok: true, validation });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Research validation failed" },
      { status: 500 },
    );
  }
}
