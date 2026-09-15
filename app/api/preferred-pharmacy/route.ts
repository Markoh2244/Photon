import { NextResponse } from "next/server";
import {
  clearPreferredPharmacy,
  getPreferredPharmacy,
  setPreferredPharmacy,
} from "@/lib/community";

export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  return NextResponse.json({ preferred: await getPreferredPharmacy(patientId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.patientId || !body.pharmacyId) {
      return NextResponse.json(
        { error: "patientId and pharmacyId are required" },
        { status: 400 },
      );
    }
    if (!body.reason?.trim()) {
      return NextResponse.json(
        { error: "A reason is required so the patient and pharmacy know why" },
        { status: 400 },
      );
    }
    const preferred = await setPreferredPharmacy({
      ...body,
      clinician: body.clinician || "Harbor Dermatology",
    });
    return NextResponse.json({ preferred });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save preferred pharmacy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  await clearPreferredPharmacy(patientId);
  return NextResponse.json({ preferred: null });
}
