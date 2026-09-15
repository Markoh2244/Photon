import type { DetailedHTMLProps, HTMLAttributes } from "react";

type PhotonClientProps = {
  id?: string;
  org?: string;
  "redirect-uri"?: string;
  "dev-mode"?: string;
  "auto-login"?: string;
};

type PhotonPrescribeProps = {
  "patient-id"?: string;
  "enable-order"?: string;
  "enable-send-to-patient"?: string;
  "enable-local-pickup"?: string;
  "enable-delivery-pharmacies"?: string;
  "enable-med-history"?: string;
  "enable-coverage-check"?: string;
  "initial-prescriptions"?: string;
  "hide-patient-card"?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "photon-client": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & PhotonClientProps;
      "photon-prescribe-workflow": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & PhotonPrescribeProps;
    }
  }
}

export {};
