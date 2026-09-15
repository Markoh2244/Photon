import { NextResponse } from "next/server";
import { PhotonError, getCatalogSummary, prescriptionScreen, searchTreatments } from "@/lib/photon";
import { buildPlan, parseNote } from "@/lib/protocols";

export async function POST(request: Request) {
  try {
    const { note, patientId } = await request.json();
    if (!note?.trim()) {
      return NextResponse.json({ error: "Visit note is required" }, { status: 400 });
    }

    const ctx = parseNote(note);
    const plan = await buildPlan(ctx, searchTreatments);
    const treatmentIds = plan.drafts.map((draft) => draft.treatmentId);
    let alerts: Awaited<ReturnType<typeof prescriptionScreen>> = [];
    let screenError: string | null = null;
    if (patientId && treatmentIds.length) {
      try {
        alerts = await prescriptionScreen(patientId, treatmentIds);
      } catch (error) {
        screenError = error instanceof PhotonError ? error.message : "Screening unavailable";
      }
    }
    const catalogs = await getCatalogSummary();

    return NextResponse.json({
      plan,
      alerts,
      screenError,
      catalog: catalogs[0] || null,
    });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to draft plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
