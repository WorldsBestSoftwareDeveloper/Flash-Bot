import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flash Bot | Autonomous Perpetual Agent",
  description: "Real-time autonomous perpetual trading agent on Solana",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
