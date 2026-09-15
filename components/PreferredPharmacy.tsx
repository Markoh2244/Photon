"use client";

import { useCallback, useEffect, useState } from "react";
import type { PreferredPharmacy, ReviewSummary } from "@/lib/community";
import type { PhotonPharmacy } from "@/lib/photon";
import { Card, Stars, Tag } from "@/components/ui";

const NYC = { lat: 40.731, lng: -73.989 };

const QUICK_REASONS = [
  "Compounds the strength we need in house",
  "Reliably stocks this medication",
  "Cheapest cash price we have seen for this patient",
  "Close to the patient's home and open late",
  "Pharmacist calls us before substituting",
];

export function formatAddress(pharmacy: PhotonPharmacy) {
  return (
    [pharmacy.address?.street1, pharmacy.address?.city, pharmacy.address?.state]
      .filter(Boolean)
      .join(", ") || null
  );
}

export function usePreferredPharmacy(patientId: string) {
  const [preferred, setPreferred] = useState<PreferredPharmacy | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) {
      setPreferred(null);
      return;
    }
    const response = await fetch(`/api/preferred-pharmacy?patientId=${patientId}`);
    const json = await response.json();
    setPreferred(response.ok ? json.preferred : null);
  }, [patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { preferred, reload };
}

export function PreferredPharmacyPicker({
  patientId,
  patientName,
  preferred,
  onSaved,
}: {
  patientId: string;
  patientName: string;
  preferred: PreferredPharmacy | null;
  onSaved: () => Promise<void> | void;
}) {
  const [pharmacies, setPharmacies] = useState<PhotonPharmacy[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewSummary>>({});
  const [type, setType] = useState<"PICK_UP" | "MAIL_ORDER">("PICK_UP");
  const [pharmacyId, setPharmacyId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fulfillment: "PICK_UP" | "MAIL_ORDER") => {
    setError(null);
    try {
      const [pharmacyResponse, reviewResponse] = await Promise.all([
        fetch(`/api/pharmacies?lat=${NYC.lat}&lng=${NYC.lng}&type=${fulfillment}`),
        fetch(`/api/reviews?lat=${NYC.lat}&lng=${NYC.lng}&type=${fulfillment}`),
      ]);
      const pharmacyJson = await pharmacyResponse.json();
      if (!pharmacyResponse.ok) throw new Error(pharmacyJson.error || "Could not load pharmacies");
      setPharmacies(pharmacyJson.pharmacies.slice(0, 8));
      if (reviewResponse.ok) setReviews((await reviewResponse.json()).summary || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pharmacies");
    }
  }, []);

  useEffect(() => {
    load(type);
  }, [load, type]);

  useEffect(() => {
    setPharmacyId(preferred?.pharmacyId || "");
    setReason(preferred?.reason || "");
  }, [preferred]);

  const selected = pharmacies.find((pharmacy) => pharmacy.id === pharmacyId);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/preferred-pharmacy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId,
          pharmacyId: selected.id,
          pharmacyName: selected.name,
          pharmacyAddress: formatAddress(selected),
          reason,
          clinician: "Harbor Dermatology",
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not save");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    await fetch(`/api/preferred-pharmacy?patientId=${patientId}`, { method: "DELETE" });
    setBusy(false);
    await onSaved();
  }

  return (
    <Card title="Preferred pharmacy for this patient">
      <p className="mb-3 text-sm leading-6 text-black/70">
        A recommendation, not a lock. The order still goes to {patientName.split(" ")[0]} to choose,
        and Photon routes wherever they land. Your reason travels with the suggestion so they know
        why you picked it.
      </p>

      <div className="mb-3 flex gap-2">
        {(["PICK_UP", "MAIL_ORDER"] as const).map((option) => (
          <button
            key={option}
            className={`rounded-full px-3 py-1 text-sm ${
              type === option ? "bg-ink text-white" : "border border-black/15"
            }`}
            onClick={() => setType(option)}
          >
            {option === "PICK_UP" ? "Local pickup" : "Mail order"}
          </button>
        ))}
      </div>

      <select
        className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
        value={pharmacyId}
        onChange={(event) => setPharmacyId(event.target.value)}
      >
        <option value="">Select a pharmacy…</option>
        {pharmacies.map((pharmacy) => (
          <option key={pharmacy.id} value={pharmacy.id}>
            {pharmacy.name}
            {reviews[pharmacy.id] ? ` — ${reviews[pharmacy.id].average.toFixed(1)}★` : ""}
          </option>
        ))}
      </select>

      {selected && (
        <div className="mt-3 rounded-lg bg-mist/60 p-3">
          <p className="text-sm font-medium">{selected.name}</p>
          <p className="text-sm text-black/60">{formatAddress(selected) || "No address on file"}</p>
          {reviews[selected.id] && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Stars value={reviews[selected.id].average} />
              <span className="text-xs text-black/50">
                {reviews[selected.id].count} patient reviews
              </span>
              {reviews[selected.id].topTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_REASONS.map((quick) => (
          <button
            key={quick}
            className="rounded-full border border-black/15 px-2.5 py-1 text-xs text-black/70"
            onClick={() => setReason(quick)}
          >
            {quick}
          </button>
        ))}
      </div>

      <textarea
        className="mt-3 h-20 w-full rounded border border-black/15 p-2 text-sm"
        placeholder="Why this pharmacy for this patient? Required."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={busy || !selected || !reason.trim()}
          onClick={save}
        >
          {preferred ? "Update recommendation" : "Save recommendation"}
        </button>
        {preferred && (
          <button className="text-sm text-black/50" disabled={busy} onClick={clear}>
            Remove
          </button>
        )}
      </div>

      {preferred && (
        <p className="mt-3 text-xs text-black/50">
          Currently recommending {preferred.pharmacyName}, saved{" "}
          {new Date(preferred.createdAt).toLocaleString()}.
        </p>
      )}
    </Card>
  );
}

export function PreferredPharmacyBanner({ preferred }: { preferred: PreferredPharmacy }) {
  return (
    <div className="rounded-xl border border-clay/40 bg-clay/5 px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-clay">Your clinician suggests</p>
      <p className="mt-1 font-medium">{preferred.pharmacyName}</p>
      {preferred.pharmacyAddress && (
        <p className="text-sm text-black/60">{preferred.pharmacyAddress}</p>
      )}
      <p className="mt-2 text-sm leading-6 text-black/70">
        <span className="font-medium">Why: </span>
        {preferred.reason}
      </p>
      <p className="mt-2 text-xs text-black/50">
        {preferred.clinician} · you can still pick anywhere else below.
      </p>
    </div>
  );
}
