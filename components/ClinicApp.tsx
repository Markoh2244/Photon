"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MedPhoto } from "@/lib/community";
import type { PhotonPatient, ScreenAlert } from "@/lib/photon";
import { SAMPLE_NOTES, type DraftPlan, type DraftPrescription } from "@/lib/protocols";
import { Card, RoleNav } from "@/components/ui";
import { MedPhotoGallery } from "@/components/MedPhotos";
import {
  PreferredPharmacyPicker,
  usePreferredPharmacy,
} from "@/components/PreferredPharmacy";

type DraftResponse = {
  plan: DraftPlan;
  alerts: ScreenAlert[];
  screenError?: string | null;
  catalog: { id: string; name: string; treatments: { id: string }[] } | null;
  error?: string;
};

export function ClinicApp() {
  const [patients, setPatients] = useState<PhotonPatient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [note, setNote] = useState(SAMPLE_NOTES[0].text);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [busy, setBusy] = useState<"patients" | "draft" | "create" | null>("patients");
  const [error, setError] = useState<string | null>(null);
  const [showSign, setShowSign] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [photos, setPhotos] = useState<MedPhoto[]>([]);

  const selectedPatient = patients.find((patient) => patient.id === patientId);
  const { preferred, reload: reloadPreferred } = usePreferredPharmacy(patientId);

  const loadPhotos = useCallback(async () => {
    if (!patientId) {
      setPhotos([]);
      return;
    }
    const response = await fetch(`/api/med-photos?patientId=${patientId}`);
    const json = await response.json();
    setPhotos(response.ok ? json.photos : []);
  }, [patientId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  async function loadPatients(selectId?: string) {
    setBusy("patients");
    setError(null);
    try {
      const response = await fetch("/api/patients");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load patients");
      setPatients(json.patients);
      setPatientId(selectId || json.patients[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patients");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    loadPatients();
  }, []);

  async function runDraft() {
    setBusy("draft");
    setError(null);
    setShowSign(false);
    try {
      const response = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note, patientId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Draft failed");
      setDraft(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy(null);
    }
  }

  function toggleDraft(key: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      plan: {
        ...draft.plan,
        drafts: draft.plan.drafts.map((item) =>
          item.key === key ? { ...item, selected: !item.selected } : item,
        ),
      },
    });
    setShowSign(false);
  }

  const selectedDrafts = useMemo(
    () => draft?.plan.drafts.filter((item) => item.selected) || [],
    [draft],
  );
  const initialPrescriptions = useMemo(
    () =>
      JSON.stringify(
        selectedDrafts.map((item) => ({
          treatmentId: item.treatmentId,
          dispenseQuantity: item.dispenseQuantity,
          dispenseUnit: item.dispenseUnit,
          fillsAllowed: item.fillsAllowed,
          daysSupply: item.daysSupply,
          instructions: item.instructions,
          notes: item.notes || "",
        })),
      ),
    [selectedDrafts],
  );

  return (
    <main className="min-h-screen">
      <RoleNav role="doctor" />
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="space-y-5">
          <Card title="Patient">
            <div className="flex gap-2">
              <select
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                value={patientId}
                onChange={(event) => {
                  setPatientId(event.target.value);
                  setDraft(null);
                  setShowSign(false);
                }}
              >
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name.full} · {patient.dateOfBirth} · {patient.sex}
                  </option>
                ))}
              </select>
              <button
                className="rounded-lg border border-black/15 px-3 text-sm"
                onClick={() => setShowCreate((value) => !value)}
              >
                New
              </button>
            </div>
            {selectedPatient && <PatientChart patient={selectedPatient} />}
            {selectedPatient && !(selectedPatient.benefits || []).length && (
              <button
                className="mt-3 rounded-lg border border-black/15 px-3 py-1.5 text-sm"
                onClick={async () => {
                  setBusy("create");
                  setError(null);
                  try {
                    const response = await fetch(`/api/patients/${selectedPatient.id}/benefits`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ fixture: "covered" }),
                    });
                    const json = await response.json();
                    if (!response.ok) throw new Error(json.error || "Could not add benefits");
                    await loadPatients(selectedPatient.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not add benefits");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Add sandbox insurance benefit
              </button>
            )}
            {showCreate && (
              <CreatePatientForm
                busy={busy === "create"}
                onCreated={async (id) => {
                  setShowCreate(false);
                  await loadPatients(id);
                }}
                onBusy={(value) => setBusy(value ? "create" : null)}
                onError={setError}
              />
            )}
          </Card>

          <Card title="Visit note">
            <div className="mb-3 flex flex-wrap gap-2">
              {SAMPLE_NOTES.map((sample) => (
                <button
                  key={sample.label}
                  className="rounded-full border border-black/15 px-3 py-1 text-xs"
                  onClick={() => {
                    setNote(sample.text);
                    setDraft(null);
                    setShowSign(false);
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
            <textarea
              className="h-44 w-full rounded-lg border border-black/15 p-3 text-sm leading-6"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy === "draft" || !patientId}
              onClick={runDraft}
            >
              {busy === "draft" ? "Matching catalog…" : "Draft plan"}
            </button>
          </Card>

          {selectedPatient && (
            <PreferredPharmacyPicker
              patientId={selectedPatient.id}
              patientName={selectedPatient.name.full}
              preferred={preferred}
              onSaved={reloadPreferred}
            />
          )}

          <Card title="Patient-submitted photos">
            <p className="mb-3 text-sm leading-6 text-black/70">
              Patients redact their own identifiers in the browser before upload, so what arrives
              here is already flattened. Useful when someone asks “is this the right tube?”
            </p>
            <MedPhotoGallery
              photos={photos}
              emptyText="This patient has not uploaded a medication photo."
            />
          </Card>
        </section>

        <section className="space-y-5">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}

          {!draft && (
            <Card title="What this demo does">
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-black/70">
                <li>Read the patient and existing Photon prescriptions/orders.</li>
                <li>Match a small dermatology protocol from the visit note.</li>
                <li>Resolve real treatments from the Neutron catalog.</li>
                <li>Run Photon’s drug/allergy screen.</li>
                <li>Hand a draft to Photon Elements. You still click send.</li>
                <li>Switch to patient view so they can pick a pharmacy.</li>
              </ol>
            </Card>
          )}

          {draft && (
            <>
              <Card title={draft.plan.title}>
                <p className="text-sm leading-6">{draft.plan.assessment}</p>
                {draft.plan.icd10 && (
                  <p className="mt-2 text-xs uppercase tracking-wide text-black/50">
                    {draft.plan.icd10.code} · {draft.plan.icd10.name}
                  </p>
                )}
                {draft.catalog && (
                  <p className="mt-3 text-xs text-black/50">
                    Org catalog “{draft.catalog.name}” has {draft.catalog.treatments.length} treatments.
                    Drafts search the full Photon catalog because the org formulary is empty.
                  </p>
                )}
              </Card>

              {draft.plan.holds.map((hold) => (
                <div
                  key={hold.title}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4"
                >
                  <p className="text-sm font-medium">{hold.title}</p>
                  <p className="mt-1 text-sm text-black/70">{hold.detail}</p>
                </div>
              ))}

              {draft.plan.questions.map((question) => (
                <div key={question.id} className="rounded-xl border border-black/10 bg-white px-5 py-4">
                  <p className="text-xs uppercase tracking-wide text-clay">Ask before signing</p>
                  <p className="mt-1 text-sm font-medium">{question.prompt}</p>
                  <p className="mt-1 text-sm text-black/60">{question.why}</p>
                </div>
              ))}

              {draft.screenError && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                  Screening skipped: {draft.screenError}
                </p>
              )}

              {draft.alerts.length > 0 && (
                <Card title="Photon screening alerts">
                  <ul className="space-y-3">
                    {draft.alerts.map((alert, index) => (
                      <li key={index} className="text-sm">
                        <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium">
                          {alert.severity || alert.type || "ALERT"}
                        </span>
                        {alert.description}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card title="Proposed prescriptions">
                {draft.plan.drafts.length === 0 && (
                  <p className="text-sm text-black/60">Nothing to send. That is intentional.</p>
                )}
                <ul className="space-y-4">
                  {draft.plan.drafts.map((item) => (
                    <DraftRow key={item.key} item={item} onToggle={() => toggleDraft(item.key)} />
                  ))}
                </ul>
                {draft.plan.counseling.length > 0 && (
                  <ul className="mt-4 list-disc pl-5 text-sm text-black/60">
                    {draft.plan.counseling.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                <button
                  className="mt-4 rounded-lg bg-clay px-4 py-2 text-sm text-white disabled:opacity-40"
                  disabled={!selectedDrafts.length}
                  onClick={() => setShowSign(true)}
                >
                  Review and sign in Photon
                </button>
              </Card>
            </>
          )}

          {showSign && selectedPatient && selectedDrafts.length > 0 && (
            <Card title="Photon prescribe workflow">
              <p className="mb-4 text-sm text-black/60">
                Elements logs you in as the authorized prescriber. Coverage check is on — if this
                patient has benefits on file, Photon will estimate the copay as you review the draft.
              </p>
              <photon-prescribe-workflow
                key={`${selectedPatient.id}-${initialPrescriptions}`}
                patient-id={selectedPatient.id}
                enable-order="true"
                enable-send-to-patient="true"
                enable-local-pickup="true"
                enable-med-history="true"
                enable-coverage-check="true"
                hide-patient-card="true"
                initial-prescriptions={initialPrescriptions}
              />
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

function PatientChart({ patient }: { patient: PhotonPatient }) {
  const rxs = patient.prescriptions || [];
  const orders = patient.orders || [];
  const benefits = patient.benefits || [];
  const preferred = patient.preferredPharmacies || [];
  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="text-black/60">
        {patient.phone || "No phone"} · {patient.address?.city || "No address on file"}
      </p>
      <div>
        <p className="text-xs uppercase tracking-wide text-black/40">Insurance benefits</p>
        {benefits.length === 0 ? (
          <p className="text-black/50">None on file — coverage check will not run.</p>
        ) : (
          benefits.map((benefit) => (
            <p key={benefit.id}>
              BIN {benefit.bin}
              {benefit.pcn ? ` · PCN ${benefit.pcn}` : ""}
              {benefit.memberId ? ` · member ${benefit.memberId}` : " · sandbox covered fixture"}
              {benefit.type ? ` · ${benefit.type}` : ""}
            </p>
          ))
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-black/40">Preferred pharmacies</p>
        {preferred.length === 0 ? (
          <p className="text-black/50">None set in Photon.</p>
        ) : (
          preferred.map((pharmacy) => (
            <p key={pharmacy.id}>
              {pharmacy.name}
              {pharmacy.address?.city ? ` · ${pharmacy.address.city}` : ""}
            </p>
          ))
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-black/40">Prescriptions</p>
        {rxs.length === 0 && <p className="text-black/50">None in Photon yet.</p>}
        {rxs.slice(0, 5).map((rx) => (
          <p key={rx.id}>
            {rx.treatment?.name} · {rx.state.toLowerCase()}
          </p>
        ))}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-black/40">Orders</p>
        {orders.length === 0 && <p className="text-black/50">No orders.</p>}
        {orders.slice(0, 5).map((order) => (
          <p key={order.id}>
            {order.id.slice(0, 14)} · {order.state.toLowerCase()}
            {order.pharmacy?.name ? ` · ${order.pharmacy.name}` : " · pharmacy not chosen"}
          </p>
        ))}
      </div>
    </div>
  );
}

function DraftRow({ item, onToggle }: { item: DraftPrescription; onToggle: () => void }) {
  return (
    <li className="rounded-lg border border-black/10 p-3">
      <label className="flex cursor-pointer gap-3">
        <input type="checkbox" checked={item.selected} onChange={onToggle} className="mt-1" />
        <div>
          <p className="text-sm font-medium">{item.treatmentName}</p>
          <p className="text-xs uppercase tracking-wide text-black/40">{item.role}</p>
          <p className="mt-1 text-sm text-black/70">{item.why}</p>
          <p className="mt-2 text-sm">
            {item.dispenseQuantity} {item.dispenseUnit} · {item.daysSupply} day supply ·{" "}
            {item.fillsAllowed} fills
          </p>
          <p className="text-sm italic text-black/60">{item.instructions}</p>
        </div>
      </label>
    </li>
  );
}

function CreatePatientForm({
  busy,
  onCreated,
  onBusy,
  onError,
}: {
  busy: boolean;
  onCreated: (id: string) => Promise<void>;
  onBusy: (value: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const [first, setFirst] = useState("Maya");
  const [last, setLast] = useState("Chen");
  const [dateOfBirth, setDateOfBirth] = useState("2002-04-12");
  const [sex, setSex] = useState<"FEMALE" | "MALE" | "UNKNOWN">("FEMALE");
  const [phone, setPhone] = useState("+12125550123");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    onBusy(true);
    onError(null);
    try {
      const response = await fetch("/api/patients/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first,
          last,
          dateOfBirth,
          sex,
          phone,
          address: {
            street1: "200 Park Ave S",
            city: "New York",
            state: "NY",
            postalCode: "10003",
            country: "US",
          },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Create failed");
      await onCreated(json.patient.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Create failed");
    } finally {
      onBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-2 gap-2 text-sm">
      <input className="rounded border px-2 py-1" value={first} onChange={(e) => setFirst(e.target.value)} />
      <input className="rounded border px-2 py-1" value={last} onChange={(e) => setLast(e.target.value)} />
      <input className="rounded border px-2 py-1" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
      <select className="rounded border px-2 py-1" value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
        <option value="FEMALE">Female</option>
        <option value="MALE">Male</option>
        <option value="UNKNOWN">Unknown</option>
      </select>
      <input className="col-span-2 rounded border px-2 py-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button className="col-span-2 rounded bg-ink py-2 text-white" disabled={busy}>
        {busy ? "Creating…" : "Create in Photon"}
      </button>
    </form>
  );
}
