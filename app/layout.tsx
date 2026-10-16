import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "./components/Nav";

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AHL Vendor Ledger",
  description: "China/Mexico vendor payment and order ledger",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <header className="app-header">
          <strong>AHL Vendor Ledger</strong>
          <Suspense fallback={null}>
            <Nav />
          </Suspense>
        </header>
        <main style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
