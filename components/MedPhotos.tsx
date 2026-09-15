"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MedPhoto } from "@/lib/community";
import { Card, Tag } from "@/components/ui";

const MAX_EDGE = 1100;

type Box = { x: number; y: number; w: number; h: number };

function normalize(box: Box): Box {
  return {
    x: box.w < 0 ? box.x + box.w : box.x,
    y: box.h < 0 ? box.y + box.h : box.y,
    w: Math.abs(box.w),
    h: Math.abs(box.h),
  };
}

/**
 * Draws the photo and then paints every redaction box as opaque black. The
 * result is what gets encoded and uploaded, so the covered pixels are gone
 * rather than hidden behind an overlay. Re-encoding also drops EXIF/GPS.
 */
function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, boxes: Box[]) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  for (const box of boxes) {
    const rect = normalize(box);
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
}

export function MedPhotoUploader({
  patientId,
  onUploaded,
}: {
  patientId: string;
  onUploaded: () => Promise<void> | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<Box | null>(null);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !image) return;
    paint(canvasRef.current, image, drag ? [...boxes, drag] : boxes);
  }, [image, boxes, drag]);

  function reset() {
    setImage(null);
    setBoxes([]);
    setDrag(null);
    setLabel("");
    setNote("");
    setConfirmed(false);
  }

  function pickFile(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(next.width, next.height));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.round(next.width * scale);
        canvas.height = Math.round(next.height * scale);
      }
      setBoxes([]);
      setConfirmed(false);
      setImage(next);
      URL.revokeObjectURL(url);
    };
    next.onerror = () => {
      setError("That file could not be read as an image.");
      URL.revokeObjectURL(url);
    };
    next.src = url;
  }

  const toCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  function coverStrip(position: "top" | "bottom") {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const height = Math.round(canvas.height * 0.18);
    setBoxes((current) => [
      ...current,
      {
        x: 0,
        y: position === "top" ? 0 : canvas.height - height,
        w: canvas.width,
        h: height,
      },
    ]);
  }

  async function upload() {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    setBusy(true);
    setError(null);
    try {
      // Repaint without the in-progress drag box so the upload matches the preview.
      paint(canvas, image, boxes);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const response = await fetch("/api/med-photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId,
          label,
          note,
          redactionCount: boxes.length,
          dataUrl,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Upload failed");
      reset();
      await onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a photo of your medication">
      <p className="mb-3 text-sm leading-6 text-black/70">
        Take a picture of the bottle or tube so your clinic can confirm you have the right thing.
        Drag across the photo to black out your name, date of birth, and the Rx number before you
        upload. The boxes are burned into the image on your device, so the clinic never receives the
        original pixels or the location data from your camera.
      </p>

      <label className="inline-block cursor-pointer rounded-lg border border-black/15 px-3 py-2 text-sm">
        {image ? "Choose a different photo" : "Take or choose a photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) pickFile(file);
            event.target.value = "";
          }}
        />
      </label>

      {image && (
        <div className="mt-4 space-y-3">
          <canvas
            ref={canvasRef}
            className="w-full max-w-full cursor-crosshair touch-none rounded-lg border border-black/15"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const point = toCanvasPoint(event);
              setDrag({ x: point.x, y: point.y, w: 0, h: 0 });
            }}
            onPointerMove={(event) => {
              if (!drag) return;
              const point = toCanvasPoint(event);
              setDrag({ ...drag, w: point.x - drag.x, h: point.y - drag.y });
            }}
            onPointerUp={() => {
              if (!drag) return;
              const rect = normalize(drag);
              if (rect.w > 6 && rect.h > 6) setBoxes((current) => [...current, rect]);
              setDrag(null);
            }}
          />

          <div className="flex flex-wrap gap-2 text-sm">
            <button
              className="rounded-lg border border-black/15 px-3 py-1.5"
              onClick={() => coverStrip("top")}
            >
              Cover top strip
            </button>
            <button
              className="rounded-lg border border-black/15 px-3 py-1.5"
              onClick={() => coverStrip("bottom")}
            >
              Cover bottom strip
            </button>
            <button
              className="rounded-lg border border-black/15 px-3 py-1.5 disabled:opacity-40"
              disabled={!boxes.length}
              onClick={() => setBoxes((current) => current.slice(0, -1))}
            >
              Undo box
            </button>
            <span className="self-center text-black/50">
              {boxes.length} {boxes.length === 1 ? "area" : "areas"} covered
            </span>
          </div>

          <input
            className="w-full rounded border border-black/15 px-2 py-1.5 text-sm"
            placeholder="What is this? e.g. Adapalene gel from the pharmacy"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <textarea
            className="h-16 w-full rounded border border-black/15 p-2 text-sm"
            placeholder="Anything the clinic should know? e.g. this looks different from last time"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <label className="flex items-start gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I checked the preview above. My name, date of birth, address, and Rx number are covered.
          </label>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex gap-2">
            <button
              className="rounded-lg bg-clay px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={busy || !boxes.length || !confirmed}
              onClick={upload}
            >
              {busy ? "Uploading…" : "Upload redacted photo"}
            </button>
            <button className="text-sm text-black/50" onClick={reset}>
              Discard
            </button>
          </div>
          {!boxes.length && (
            <p className="text-xs text-black/50">
              Drag at least one box before uploading. Nothing is sent until something is covered.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function MedPhotoGallery({
  photos,
  onDeleted,
  emptyText,
}: {
  photos: MedPhoto[];
  onDeleted?: () => Promise<void> | void;
  emptyText: string;
}) {
  async function remove(id: string) {
    await fetch(`/api/med-photos/${id}`, { method: "DELETE" });
    await onDeleted?.();
  }

  if (!photos.length) return <p className="text-sm text-black/60">{emptyText}</p>;

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {photos.map((photo) => (
        <li key={photo.id} className="overflow-hidden rounded-xl border border-black/10">
          {/* Served from a private API route, not /public. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/med-photos/${photo.id}`}
            alt={photo.label}
            className="h-40 w-full bg-mist object-cover"
          />
          <div className="space-y-1 p-3">
            <p className="text-sm font-medium">{photo.label}</p>
            {photo.note && <p className="text-sm text-black/60">{photo.note}</p>}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Tag>
                {photo.redactionCount} {photo.redactionCount === 1 ? "area" : "areas"} redacted
              </Tag>
              <span className="text-xs text-black/40">
                {new Date(photo.createdAt).toLocaleDateString()}
              </span>
              {onDeleted && (
                <button className="ml-auto text-xs text-black/50" onClick={() => remove(photo.id)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
