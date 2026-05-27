import "./globals.css";

export const metadata = {
  title: "Agent Builder App",
  description: "Local app/workbench for designing, previewing, packaging, and reusing agent harnesses.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
