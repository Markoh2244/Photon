import { NextResponse } from "next/server";
import { PhotonError, comparePharmacyCoverage } from "@/lib/photon";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pharmacyIds: string[] = body.pharmacyIds || [];
    const prescriptionIds: string[] = body.prescriptionIds || [];
    if (!pharmacyIds.length || !prescriptionIds.length) {
      return NextResponse.json(
        { error: "pharmacyIds and prescriptionIds are required" },
        { status: 400 },
      );
    }
    const comparisons = await comparePharmacyCoverage(pharmacyIds, prescriptionIds);
    return NextResponse.json({ comparisons });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Coverage check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
