import { runChiefOfStaff } from "../../../../lib/cos-runner.mjs";

export const runtime = "nodejs";
export const maxDuration = 1800;

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { model, schedule, goals, feedback, allowCloud, maxCloudTokens, seed } = body ?? {};

  // `model` may be omitted to use the per-node cascade defaults. When it IS
  // provided, we collapse the cascade to a single user-override step so the
  // legacy "pick this exact ollama model" behavior is preserved.
  const modelOverride = model ? { provider: "ollama", model } : null;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        await runChiefOfStaff({
          model,
          schedule,
          goals,
          feedback,
          onEvent: send,
          modelOverride,
          allowCloud,
          maxCloudTokens,
          seed: Number.isFinite(seed) ? seed : undefined,
        });
      } catch (err) {
        send({ type: "fatal", error: err?.message ?? String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
