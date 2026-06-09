import "./globals.css";

export const metadata = {
  title: "Agent Studio",
  description: "Visual canvas for agent design and testing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
