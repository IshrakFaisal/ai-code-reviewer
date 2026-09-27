import type { Metadata } from "next";
import { Shell } from "@/components/dashboard/shell";
import { getConfig } from "@/lib/config";
import "./globals.css";
export const metadata: Metadata = {
  title: "AI Change Verifier · Evidence-backed code review",
  description:
    "Investigate behavioral changes, verify risk hypotheses, and prioritize human attention in GitHub pull requests.",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Shell demo={getConfig().demo}>{children}</Shell>
      </body>
    </html>
  );
}
