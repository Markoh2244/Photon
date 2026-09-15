import { NextResponse } from "next/server";
import { addReview, getReviewSummary } from "@/lib/community";
import { PhotonError, searchPharmacies } from "@/lib/photon";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const latitude = Number(url.searchParams.get("lat") || "40.731");
    const longitude = Number(url.searchParams.get("lng") || "-73.989");
    const type = (url.searchParams.get("type") || "PICK_UP") as "PICK_UP" | "MAIL_ORDER";
    const pharmacies = await searchPharmacies({ latitude, longitude, type });
    const summary = await getReviewSummary(pharmacies.map(({ id, name }) => ({ id, name })));
    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to load reviews";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.pharmacyId || !body.pharmacyName) {
      return NextResponse.json(
        { error: "pharmacyId and pharmacyName are required" },
        { status: 400 },
      );
    }
    if (!body.comment?.trim()) {
      return NextResponse.json({ error: "Write a short comment" }, { status: 400 });
    }
    const review = await addReview(body);
    return NextResponse.json({ review });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save review";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
