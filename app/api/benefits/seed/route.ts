import { NextResponse } from "next/server";
import {
  PhotonError,
  ensurePatientBenefit,
  listPatients,
  setPreferredPharmacies,
  type SandboxBenefitKey,
} from "@/lib/photon";

const DEFAULT_PHARMACY = "phr_01GA9HPX6GFZCVPZSJ1TPHT45T"; // CVS near demo NYC patients

/**
 * Seeds Photon's sandbox benefit fixtures onto every visible demo patient.
 * Maya gets the covered fixture; Jordan gets the PA-required fixture so we can
 * show both RTBC outcomes. Everyone else gets covered.
 */
export async function POST() {
  try {
    const patients = await listPatients();
    const results = [];
    for (const patient of patients) {
      const fixture: SandboxBenefitKey =
        patient.name.last?.toLowerCase() === "hale" ? "paRequired" : "covered";
      const { benefit, created } = await ensurePatientBenefit(patient.id, fixture);
      let preferredPharmacy = null;
      try {
        if (!patient.preferredPharmacies?.length) {
          preferredPharmacy = await setPreferredPharmacies(patient.id, [DEFAULT_PHARMACY]);
        } else {
          preferredPharmacy = { id: patient.id, preferredPharmacies: patient.preferredPharmacies };
        }
      } catch (error) {
        preferredPharmacy = {
          error: error instanceof Error ? error.message : "preferred pharmacy failed",
        };
      }
      results.push({
        patientId: patient.id,
        name: patient.name.full,
        fixture,
        created,
        benefit,
        preferredPharmacy,
      });
    }
    return NextResponse.json({ count: results.length, results });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to seed benefits";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
