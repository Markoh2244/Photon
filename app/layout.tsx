import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
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
        <PhotonClient>
          <AuthProvider>{children}</AuthProvider>
        </PhotonClient>
      </body>
    </html>
  );
}
