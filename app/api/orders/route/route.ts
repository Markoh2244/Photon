import { NextResponse } from "next/server";
import { PhotonError, routeOrder } from "@/lib/photon";

export async function POST(request: Request) {
  try {
    const { orderId, pharmacyId } = await request.json();
    if (!orderId || !pharmacyId) {
      return NextResponse.json({ error: "orderId and pharmacyId are required" }, { status: 400 });
    }
    const order = await routeOrder(orderId, pharmacyId);
    return NextResponse.json({ order });
  } catch (error) {
    const message = error instanceof PhotonError ? error.message : "Failed to choose pharmacy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
