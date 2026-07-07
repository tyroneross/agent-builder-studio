import "./globals.css";

export const metadata = {
  title: "Agent Studio",
  description: "Visual canvas for agent design and testing.",
};

// C6: minimal nav link to the tool dashboard. Fixed + out-of-flow so it
// never affects existing pages' height math (the canvas page is itself a
// `position: fixed; inset: 0;` layout with its own toolbar) — this is a
// small bottom-right corner pill, additive only.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <a
          href="/dashboard"
          className="global-dashboard-link"
          data-global-nav-dashboard
        >
          Dashboard
        </a>
        <style>{`
          .global-dashboard-link {
            position: fixed;
            right: 12px;
            bottom: 12px;
            z-index: 9999;
            height: 28px;
            display: inline-flex;
            align-items: center;
            padding: 0 12px;
            border-radius: 999px;
            border: 1px solid var(--border, #d9ded5);
            background: var(--surface, #ffffff);
            color: var(--ink, #1f2520);
            font-family: inherit;
            font-size: 12px;
            text-decoration: none;
            box-shadow: var(--shadow, 0 4px 12px rgba(31, 37, 32, 0.06));
          }
          .global-dashboard-link:hover {
            border-color: var(--accent, #2e6f64);
            color: var(--accent-strong, #1f574e);
          }
        `}</style>
      </body>
    </html>
  );
}
