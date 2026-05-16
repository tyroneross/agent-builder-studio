import { writeAgentArtifacts } from "../../../lib/build-files.js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await writeAgentArtifacts(body?.spec ?? body, {
      root: process.cwd(),
    });

    return Response.json({
      ok: true,
      slug: result.slug,
      outputRoot: result.outputRoot,
      outputDir: result.outputDir,
      installableDir: result.installableDir,
      files: result.files.map((file) => file.path),
      warnings: result.warnings,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Build failed",
      },
      { status: 400 },
    );
  }
}
