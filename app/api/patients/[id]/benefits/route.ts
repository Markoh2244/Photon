import { NextResponse } from "next/server";
import {
  PhotonError,
  SANDBOX_BENEFITS,
  ensurePatientBenefit,
  getPatient,
  setPreferredPharmacies,
  type SandboxBenefitKey,
} from "@/lib/photon";

const DEFAULT_PHARMACY = "phr_01GA9HPX6GFZCVPZSJ1TPHT45T"; // CVS near demo NYC patients

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const patient = await getPatient(id);
    return NextResponse.json({
      benefits: patient.benefits || [],
      preferredPharmacies: patient.preferredPharmacies || [],
      fixtures: SANDBOX_BENEFITS,
    });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to load benefits";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const fixture = (body.fixture || "covered") as SandboxBenefitKey;
    if (!(fixture in SANDBOX_BENEFITS)) {
      return NextResponse.json({ error: "Unknown benefit fixture" }, { status: 400 });
    }

    const result = await ensurePatientBenefit(id, fixture);
    const pharmacyId = body.pharmacyId || DEFAULT_PHARMACY;
    let preferred = null;
    try {
      preferred = await setPreferredPharmacies(id, [pharmacyId]);
    } catch (error) {
      // Benefit can still be useful without a preferred pharmacy.
      preferred = {
        error: error instanceof Error ? error.message : "Could not set preferred pharmacy",
      };
    }

    const patient = await getPatient(id);
    return NextResponse.json({
      created: result.created,
      benefit: result.benefit,
      preferred,
      patient,
      fixture: SANDBOX_BENEFITS[fixture],
    });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to add benefit";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
