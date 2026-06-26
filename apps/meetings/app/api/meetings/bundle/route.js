import { buildMeetingInstallBundle } from "../../../../lib/meeting-transcript-agent.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const bundle = buildMeetingInstallBundle({
    ramProfile: url.searchParams.get("ram") ?? "24gb",
  });

  return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": "attachment; filename=\"local-knowledge-agent.agent.json\"",
    },
  });
}
