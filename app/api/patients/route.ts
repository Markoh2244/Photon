import { NextResponse } from "next/server";
import { PhotonError, listPatients } from "@/lib/photon";

export async function GET() {
  try {
    const patients = await listPatients();
    return NextResponse.json({ patients });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to load patients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
