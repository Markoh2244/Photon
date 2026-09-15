import { NextResponse } from "next/server";
import { PhotonError, getPatient } from "@/lib/photon";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const patient = await getPatient(id);
    return NextResponse.json({ patient });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to load patient";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
