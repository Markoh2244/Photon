"use client";

import { useEffect } from "react";

export function PhotonClient({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    import("@photonhealth/elements").catch((error) => {
      console.warn("Photon Elements failed to load", error);
    });
  }, []);

  const clientId = process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID;
  const org = process.env.NEXT_PUBLIC_PHOTON_ORG_ID;
  const redirect = process.env.NEXT_PUBLIC_PHOTON_REDIRECT_URI || "http://localhost:3000";

  return (
    <photon-client
      id={clientId}
      org={org}
      redirect-uri={redirect}
      dev-mode="true"
    >
      {children}
    </photon-client>
  );
}
