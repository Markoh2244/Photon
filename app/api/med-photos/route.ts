import { NextResponse } from "next/server";
import { addMedPhoto, listMedPhotos } from "@/lib/community";

export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  return NextResponse.json({ photos: await listMedPhotos(patientId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.patientId || !body.dataUrl) {
      return NextResponse.json({ error: "patientId and dataUrl are required" }, { status: 400 });
    }
    // The browser flattens redaction boxes into the pixels before upload, so a
    // zero-box image means nothing was covered and we refuse to store it.
    if (!body.redactionCount) {
      return NextResponse.json(
        { error: "Cover your name and any identifiers before uploading" },
        { status: 400 },
      );
    }
    const photo = await addMedPhoto({
      patientId: body.patientId,
      label: body.label || "",
      note: body.note,
      redactionCount: Number(body.redactionCount) || 0,
      dataUrl: body.dataUrl,
    });
    return NextResponse.json({ photo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save photo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
