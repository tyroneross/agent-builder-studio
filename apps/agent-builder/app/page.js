// The interactive agent-builder UI has been retired. Graph design + packaging
// now live in Agent Builder Studio (the canvas authors a governed spec and
// exports the full package via @tyroneross/agent-pack). This app remains the
// home for the published plugin (plugin/), agent-structures, and the research/
// DoE/sandbox/artifact tooling (see package.json scripts). The side products
// moved to their own apps. This page is a signpost to where everything went.

export const metadata = {
  title: "Agent Builder → Agent Builder Studio",
};

const LINKS = [
  { label: "Agent Builder Studio (design + package agents)", href: "http://localhost:3030", note: "the canvas — replaces this builder UI" },
  { label: "Chief of Staff", href: "http://localhost:3034", note: "moved to apps/cos" },
  { label: "Investments review", href: "http://localhost:3033", note: "moved to apps/investments" },
  { label: "Meetings analyzer", href: "http://localhost:3032", note: "moved to apps/meetings" },
];

export default function RetiredBuilder() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>This builder UI has moved</h1>
      <p style={{ color: "#555", lineHeight: 1.6, marginBottom: 24 }}>
        Designing and packaging agents now happens in <strong>Agent Builder Studio</strong>:
        author the graph and node governance on the canvas, then <em>export package</em> to
        produce the full installable bundle via the shared <code>@tyroneross/agent-pack</code>
        engine. The former side-products moved to their own apps.
      </p>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {LINKS.map((l) => (
          <li key={l.href} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 14 }}>
            <a href={l.href} style={{ fontWeight: 600, color: "#0b6", textDecoration: "none" }}>
              {l.label}
            </a>
            <div style={{ fontSize: 13, color: "#777", marginTop: 2 }}>{l.note}</div>
          </li>
        ))}
      </ul>
      <p style={{ color: "#777", fontSize: 13, marginTop: 24, lineHeight: 1.6 }}>
        This package still hosts the published <code>@tyroneross/agent-builder</code> plugin,
        <code> agent-structures</code>, and the DoE / sandbox / artifact / chief-of-staff
        generation tooling (see <code>package.json</code> scripts).
      </p>
    </main>
  );
}
