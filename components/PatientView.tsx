"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MedPhoto, ReviewSummary } from "@/lib/community";
import type { CoverageOption, PhotonOrder, PhotonPatient, PhotonPharmacy } from "@/lib/photon";
import { Card, Tag } from "@/components/ui";
import { ReviewPanel, ReviewSnapshot } from "@/components/PharmacyReviews";
import { MedPhotoGallery, MedPhotoUploader } from "@/components/MedPhotos";
import {
  PreferredPharmacyBanner,
  usePreferredPharmacy,
} from "@/components/PreferredPharmacy";

const NYC = { lat: 40.731, lng: -73.989 };

type PharmacyCoverage = {
  pharmacyId: string;
  primary: CoverageOption | null;
  options: CoverageOption[];
  error: string | null;
};

function orderMeds(order: PhotonOrder) {
  return (order.fills || [])
    .map((fill) => fill.prescription?.treatment?.name || fill.treatment?.name)
    .filter(Boolean) as string[];
}

function orderPrescriptionIds(order: PhotonOrder) {
  return [
    ...new Set(
      (order.fills || [])
        .map((fill) => fill.prescription?.id)
        .filter(Boolean) as string[],
    ),
  ];
}

function formatPrice(coverage?: PharmacyCoverage | null) {
  if (!coverage) return null;
  if (coverage.error) return { label: "Price unavailable", detail: coverage.error };
  const primary = coverage.primary;
  if (!primary) return { label: "No coverage result", detail: null };
  const dollars =
    primary.price == null ? "—" : `$${Number(primary.price).toFixed(primary.price % 1 ? 2 : 0)}`;
  const status = primary.status?.replace(/_/g, " ").toLowerCase() || "unknown";
  return {
    label: `${dollars} estimated patient pay`,
    detail: `${status}${primary.paRequired ? " · PA required" : ""}${
      primary.statusMessage ? ` · ${primary.statusMessage}` : ""
    }`,
  };
}

export function PatientView() {
  const [patients, setPatients] = useState<PhotonPatient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [pharmacies, setPharmacies] = useState<PhotonPharmacy[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewSummary>>({});
  const [coverageByPharmacy, setCoverageByPharmacy] = useState<Record<string, PharmacyCoverage>>(
    {},
  );
  const [pricingBusy, setPricingBusy] = useState(false);
  const [openReviews, setOpenReviews] = useState<string | null>(null);
  const [photos, setPhotos] = useState<MedPhoto[]>([]);
  const [fulfillment, setFulfillment] = useState<"PICK_UP" | "MAIL_ORDER">("PICK_UP");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [busy, setBusy] = useState<"load" | "pharmacies" | "route" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const patient = patients.find((item) => item.id === patientId);
  const { preferred } = usePreferredPharmacy(patientId);

  const waiting = useMemo(
    () =>
      (patient?.orders || []).filter(
        (order) => !order.pharmacy && ["ROUTING", "PENDING"].includes(order.state),
      ),
    [patient],
  );
  const placed = useMemo(
    () => (patient?.orders || []).filter((order) => order.pharmacy),
    [patient],
  );

  const selectedOrder = waiting.find((order) => order.id === selectedOrderId);
  const prescriptionIds = useMemo(
    () => (selectedOrder ? orderPrescriptionIds(selectedOrder) : []),
    [selectedOrder],
  );

  // Sort by real Photon patient-pay when we have it; clinician pick still floats up.
  const rankedPharmacies = useMemo(() => {
    const priced = [...pharmacies].sort((a, b) => {
      const priceA = coverageByPharmacy[a.id]?.primary?.price;
      const priceB = coverageByPharmacy[b.id]?.primary?.price;
      if (priceA == null && priceB == null) return 0;
      if (priceA == null) return 1;
      if (priceB == null) return -1;
      return priceA - priceB;
    });
    if (!preferred) return priced;
    const match = priced.filter((pharmacy) => pharmacy.id === preferred.pharmacyId);
    const rest = priced.filter((pharmacy) => pharmacy.id !== preferred.pharmacyId);
    return [...match, ...rest];
  }, [pharmacies, preferred, coverageByPharmacy]);

  async function loadPatients(selectId?: string) {
    setBusy("load");
    setError(null);
    try {
      const response = await fetch("/api/patients");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load patients");
      setPatients(json.patients);
      const nextId = selectId || json.patients[0]?.id || "";
      setPatientId(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patients");
    } finally {
      setBusy(null);
    }
  }

  const loadPharmacies = useCallback(async (type: "PICK_UP" | "MAIL_ORDER") => {
    setBusy("pharmacies");
    setError(null);
    try {
      const [pharmacyResponse, reviewResponse] = await Promise.all([
        fetch(`/api/pharmacies?lat=${NYC.lat}&lng=${NYC.lng}&type=${type}`),
        fetch(`/api/reviews?lat=${NYC.lat}&lng=${NYC.lng}&type=${type}`),
      ]);
      const pharmacyJson = await pharmacyResponse.json();
      if (!pharmacyResponse.ok) throw new Error(pharmacyJson.error || "Could not load pharmacies");
      setPharmacies(pharmacyJson.pharmacies.slice(0, 8));
      if (reviewResponse.ok) setReviews((await reviewResponse.json()).summary || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pharmacies");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadPhotos = useCallback(async () => {
    if (!patientId) {
      setPhotos([]);
      return;
    }
    const response = await fetch(`/api/med-photos?patientId=${patientId}`);
    const json = await response.json();
    setPhotos(response.ok ? json.photos : []);
  }, [patientId]);

  const loadCoverage = useCallback(async (rxIds: string[], pharmacyList: PhotonPharmacy[]) => {
    if (!rxIds.length || !pharmacyList.length) {
      setCoverageByPharmacy({});
      return;
    }
    setPricingBusy(true);
    try {
      const response = await fetch("/api/coverage/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prescriptionIds: rxIds,
          pharmacyIds: pharmacyList.map((pharmacy) => pharmacy.id),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load prices");
      const next: Record<string, PharmacyCoverage> = {};
      for (const row of json.comparisons || []) {
        next[row.pharmacyId] = row;
      }
      setCoverageByPharmacy(next);
    } catch (err) {
      setCoverageByPharmacy({});
      setError(err instanceof Error ? err.message : "Could not load prices");
    } finally {
      setPricingBusy(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    loadPharmacies("PICK_UP");
  }, [loadPharmacies]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  useEffect(() => {
    if (waiting[0] && !waiting.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId(waiting[0].id);
    }
    if (!waiting.length) setSelectedOrderId("");
  }, [waiting, selectedOrderId]);

  useEffect(() => {
    loadCoverage(prescriptionIds, pharmacies);
  }, [loadCoverage, prescriptionIds, pharmacies]);

  async function choosePharmacy(pharmacy: PhotonPharmacy) {
    if (!selectedOrderId) {
      setError("There is no open order waiting for a pharmacy yet. Ask the clinic to send one.");
      return;
    }
    setBusy("route");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/orders/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, pharmacyId: pharmacy.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not route order");
      setNotice(`Photon is sending this order to ${pharmacy.name}.`);
      await loadPatients(patientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not route order");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef3f0]">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
        <section className="space-y-5">
          <Card title="Who is filling today?">
            <p className="mb-3 text-sm text-black/60">
              In production this would be the logged-in patient. Here you pick a Photon sandbox
              record so you can demo both sides.
            </p>
            <select
              className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value={patientId}
              onChange={(event) => {
                setPatientId(event.target.value);
                setNotice(null);
              }}
            >
              {patients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name.full}
                </option>
              ))}
            </select>
          </Card>

          <Card title="Your medications">
            {(patient?.prescriptions || []).length === 0 && (
              <p className="text-sm text-black/60">Nothing on file yet. The clinic has not sent an Rx.</p>
            )}
            <ul className="space-y-3">
              {(patient?.prescriptions || []).map((rx) => (
                <li key={rx.id} className="rounded-lg border border-black/10 p-3">
                  <p className="font-medium">{rx.treatment?.name}</p>
                  <p className="text-sm text-black/60">{rx.instructions || "See label for directions."}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-black/40">
                    {rx.state.toLowerCase()}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          {patientId && (
            <MedPhotoUploader patientId={patientId} onUploaded={loadPhotos} />
          )}

          <Card title="Photos you have shared">
            <MedPhotoGallery
              photos={photos}
              onDeleted={loadPhotos}
              emptyText="No photos yet. Upload one above if a medication looks different than expected."
            />
          </Card>
        </section>

        <section className="space-y-5">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {notice}
            </p>
          )}

          {preferred && <PreferredPharmacyBanner preferred={preferred} />}

          <Card title="Choose a pharmacy">
            <p className="mb-4 text-sm leading-6 text-black/70">
              Harbor sent the prescription into Photon without locking a pharmacy. Prices below are
              live Photon benefit checks for this patient’s insurance — sorted cheapest first when
              coverage returns a patient-pay amount.
            </p>

            {waiting.length === 0 ? (
              <p className="text-sm text-black/60">
                No open orders waiting on a pharmacy. Ask the clinic to seed unfilled Rxs, or sign
                an order with “send to patient,” then come back.
              </p>
            ) : (
              <>
                {waiting.length > 1 && (
                  <select
                    className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
                    value={selectedOrderId}
                    onChange={(event) => setSelectedOrderId(event.target.value)}
                  >
                    {waiting.map((order) => (
                      <option key={order.id} value={order.id}>
                        {orderMeds(order).join(", ") || order.id} · {order.state.toLowerCase()}
                      </option>
                    ))}
                  </select>
                )}
                {selectedOrder && (
                  <p className="mb-4 text-sm">
                    Waiting:{" "}
                    <span className="font-medium">
                      {orderMeds(selectedOrder).join(", ") || "Prescription order"}
                    </span>
                    {pricingBusy && (
                      <span className="ml-2 text-black/50">· checking prices…</span>
                    )}
                  </p>
                )}
                <div className="mb-4 flex gap-2">
                  {(["PICK_UP", "MAIL_ORDER"] as const).map((type) => (
                    <button
                      key={type}
                      className={`rounded-full px-3 py-1 text-sm ${
                        fulfillment === type ? "bg-ink text-white" : "border border-black/15"
                      }`}
                      onClick={() => {
                        setFulfillment(type);
                        setOpenReviews(null);
                        loadPharmacies(type);
                      }}
                    >
                      {type === "PICK_UP" ? "Pickup nearby" : "Mail order"}
                    </button>
                  ))}
                </div>
                <ul className="space-y-3">
                  {rankedPharmacies.map((pharmacy) => {
                    const isPreferred = preferred?.pharmacyId === pharmacy.id;
                    const price = formatPrice(coverageByPharmacy[pharmacy.id]);
                    return (
                      <li
                        key={pharmacy.id}
                        className={`rounded-xl border p-3 ${
                          isPreferred ? "border-clay/50 bg-clay/5" : "border-black/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{pharmacy.name}</p>
                              {isPreferred && <Tag>Clinician pick</Tag>}
                              {(() => {
                                const cheapest = rankedPharmacies
                                  .map((item) => ({
                                    id: item.id,
                                    price: coverageByPharmacy[item.id]?.primary?.price,
                                  }))
                                  .filter((item) => item.price != null)
                                  .sort((a, b) => (a.price as number) - (b.price as number))[0];
                                return cheapest?.id === pharmacy.id ? (
                                  <Tag>Lowest price</Tag>
                                ) : null;
                              })()}
                            </div>
                            <p className="text-sm text-black/60">
                              {[
                                pharmacy.address?.street1,
                                pharmacy.address?.city,
                                pharmacy.address?.state,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                            <ReviewSnapshot summary={reviews[pharmacy.id]} />
                            <p className="mt-1 text-sm font-medium text-ink">
                              {price?.label ||
                                (pricingBusy ? "Checking benefit price…" : "Waiting for price")}
                              {fulfillment === "MAIL_ORDER" ? " · ships to you" : " · ready for pickup"}
                            </p>
                            {price?.detail && (
                              <p className="text-xs capitalize text-black/50">{price.detail}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <button
                              className="rounded-lg bg-clay px-3 py-2 text-sm text-white disabled:opacity-40"
                              disabled={busy === "route"}
                              onClick={() => choosePharmacy(pharmacy)}
                            >
                              Fill here
                            </button>
                            <button
                              className="text-xs text-black/50 underline"
                              onClick={() =>
                                setOpenReviews((current) =>
                                  current === pharmacy.id ? null : pharmacy.id,
                                )
                              }
                            >
                              {openReviews === pharmacy.id ? "Hide reviews" : "Reviews"}
                            </button>
                          </div>
                        </div>
                        {openReviews === pharmacy.id && (
                          <ReviewPanel
                            pharmacyId={pharmacy.id}
                            pharmacyName={pharmacy.name}
                            summary={reviews[pharmacy.id]}
                            onSubmitted={() => loadPharmacies(fulfillment)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {busy === "pharmacies" && <p className="mt-3 text-sm text-black/50">Loading pharmacies…</p>}
              </>
            )}
          </Card>

          {placed.length > 0 && (
            <Card title="Already on the way">
              <ul className="space-y-2 text-sm">
                {placed.map((order) => (
                  <li key={order.id}>
                    {orderMeds(order).join(", ") || "Order"} · {order.pharmacy?.name} ·{" "}
                    {order.state.toLowerCase()}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
