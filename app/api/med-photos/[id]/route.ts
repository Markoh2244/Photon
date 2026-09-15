import { NextResponse } from "next/server";
import { deleteMedPhoto, readMedPhotoFile } from "@/lib/community";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await readMedPhotoFile(id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "content-type": found.photo.mimeType,
      "cache-control": "private, max-age=60",
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteMedPhoto(id);
  return NextResponse.json({ ok: true });
}
