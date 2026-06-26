import "./globals.css";

export const metadata = {
  title: "Meetings — transcript analyzer",
  description: "Local meeting-transcript analysis: extract, chunk, store to SQLite + knowledge graph, and search — all on your machine.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
