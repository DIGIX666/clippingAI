import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "clippingAI POC",
  description: "Generate AI clip candidates from YouTube transcripts."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
