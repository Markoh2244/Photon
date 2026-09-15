import type { Metadata } from "next";
import "./globals.css";
import { PhotonClient } from "@/components/PhotonClient";

export const metadata: Metadata = {
  title: "DermClose — Harbor Dermatology",
  description:
    "AI prescribing assistant for clinicians — Photon MCP tools for patients, benefits, and coverage-aware drafts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PhotonClient>{children}</PhotonClient>
      </body>
    </html>
  );
}
