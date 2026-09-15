import { NextResponse } from "next/server";
import { PhotonError, searchPharmacies } from "@/lib/photon";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const latitude = Number(url.searchParams.get("lat") || "40.731");
    const longitude = Number(url.searchParams.get("lng") || "-73.989");
    const type = (url.searchParams.get("type") || "PICK_UP") as "PICK_UP" | "MAIL_ORDER";
    const pharmacies = await searchPharmacies({ latitude, longitude, type });
    return NextResponse.json({ pharmacies });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to search pharmacies";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
