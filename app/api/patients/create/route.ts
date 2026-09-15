import { NextResponse } from "next/server";
import { PhotonError, createPatient } from "@/lib/photon";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const patient = await createPatient({
      first: body.first,
      last: body.last,
      dateOfBirth: body.dateOfBirth,
      sex: body.sex,
      phone: body.phone,
      email: body.email,
      address: body.address,
    });
    return NextResponse.json({ patient });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to create patient";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
