// Extracted verbatim from agent-builder/lib/generator.js#slugify (single source
// of truth for the agent-builder-platform monorepo).
export function slugify(value) {
  return (
    String(value ?? "agent")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "agent"
  );
}
