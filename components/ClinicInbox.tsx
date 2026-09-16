"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog, RoleNav } from "@/components/ui";
import type {
  InboxItem,
  OrderExceptionItem,
  ProposedAction,
  RefillRequestItem,
} from "@/lib/inbox";

type InboxPayload = {
  orders: OrderExceptionItem[];
  refills: RefillRequestItem[];
  counts: { orders: number; refills: number; high: number };
  seededAt: string | null;
  error?: string;
};

type SeverityFilter = "all" | "high" | "medium" | "low";
type TriageFilter = "all" | "approve" | "bridge" | "needs_clinician";
type ReasonFilter = "all" | "out_of_stock" | "pa_required" | "needs_diagnosis" | "routing_stuck" | "not_covered";

function severityStyles(severity: InboxItem["severity"]) {
  if (severity === "high") return "border-red-200 bg-red-50/80 text-red-900";
  if (severity === "medium") return "border-amber-200 bg-amber-50/70 text-amber-950";
  return "border-black/10 bg-mist/40 text-ink";
}

function severityLabel(severity: InboxItem["severity"]) {
  if (severity === "high") return "Needs attention";
  if (severity === "medium") return "Review soon";
  return "Routine";
}

function triageBadge(triage: RefillRequestItem["triage"]) {
  if (triage === "approve") return "Approve";
  if (triage === "bridge") return "Bridge";
  return "Clinician";
}

function matchesQuery(haystack: string, query: string) {
  if (!query.trim()) return true;
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

function ActionButtons({
  item,
  busyId,
  onResolve,
  onFindPharmacy,
}: {
  item: InboxItem;
  busyId: string | null;
  onResolve: (id: string, actionId: string, resolveAction: "accept" | "dismiss", note?: string) => void;
  onFindPharmacy?: () => void;
}) {
  const actions: ProposedAction[] = [
    item.proposal,
    ...(item.alternatives || []).filter((a) => a.id !== item.proposal.id),
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => {
        if (action.kind === "find_new_pharmacy" && onFindPharmacy) {
          return (
            <button
              key={action.id}
              type="button"
              disabled={busyId === item.id}
              onClick={onFindPharmacy}
              className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 ${
                action.primary || action.id === item.proposal.id
                  ? "bg-ink text-white"
                  : "border border-black/15 bg-white text-ink"
              }`}
            >
              {action.label}
            </button>
          );
        }
        return (
          <button
            key={action.id}
            type="button"
            disabled={busyId === item.id}
            onClick={() => onResolve(item.id, action.id, "accept")}
            className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 ${
              action.primary || action.id === item.proposal.id
                ? "bg-ink text-white"
                : "border border-black/15 bg-white text-ink"
            }`}
          >
            {action.label}
          </button>
        );
      })}
      <button
        type="button"
        disabled={busyId === item.id}
        onClick={() => onResolve(item.id, item.proposal.id, "dismiss")}
        className="rounded-lg px-3 py-1.5 text-sm text-black/50 hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}

type PharmacyHit = {
  id: string;
  name: string;
  phone?: string | null;
  address?: { street1?: string | null; city?: string | null; state?: string | null } | null;
};

function OrderCard({
  item,
  busyId,
  onResolve,
}: {
  item: OrderExceptionItem;
  busyId: string | null;
  onResolve: (id: string, actionId: string, resolveAction: "accept" | "dismiss", note?: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pharmacies, setPharmacies] = useState<PharmacyHit[]>([]);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [pharmacyError, setPharmacyError] = useState<string | null>(null);
  const [pendingPharmacy, setPendingPharmacy] = useState<PharmacyHit | null>(null);

  async function openPharmacyPicker() {
    setPickerOpen(true);
    setPendingPharmacy(null);
    setPharmacyError(null);
    setLoadingPharmacies(true);
    try {
      const response = await fetch("/api/pharmacies?lat=40.731&lng=-73.989&type=PICK_UP");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Pharmacy search failed");
      setPharmacies((json.pharmacies || []).slice(0, 12));
    } catch (err) {
      setPharmacyError(err instanceof Error ? err.message : "Pharmacy search failed");
      setPharmacies([]);
    } finally {
      setLoadingPharmacies(false);
    }
  }

  function confirmPharmacyChange() {
    if (!pendingPharmacy) return;
    const pharmacy = pendingPharmacy;
    const address = [
      pharmacy.address?.street1,
      pharmacy.address?.city,
      pharmacy.address?.state,
    ]
      .filter(Boolean)
      .join(", ");
    onResolve(
      item.id,
      "act_find_pharmacy",
      "accept",
      `Rerouted to ${pharmacy.name}${address ? ` (${address})` : ""} [${pharmacy.id}]`,
    );
    setPendingPharmacy(null);
    setPickerOpen(false);
  }

  return (
    <article className={`rounded-2xl border px-4 py-4 ${severityStyles(item.severity)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] opacity-70">
            {severityLabel(item.severity)} · {item.reasonCode.split("_").join(" ")}
          </p>
          <h3 className="mt-1 font-medium text-ink">{item.patientName}</h3>
          <p className="text-sm text-black/70">{item.medication}</p>
        </div>
        <p className="text-xs text-black/45">{item.pharmacyName || "No pharmacy yet"}</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-black/80">{item.problem}</p>
      <div className="mt-3 rounded-xl border border-black/10 bg-white/80 px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-clay">AI proposed resolution</p>
        <p className="mt-1 text-sm font-medium text-ink">{item.proposal.label}</p>
        <p className="mt-0.5 text-sm leading-5 text-black/60">{item.proposal.detail}</p>
      </div>
      <ActionButtons
        item={item}
        busyId={busyId}
        onResolve={onResolve}
        onFindPharmacy={openPharmacyPicker}
      />

      {pickerOpen && (
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-clay">Choose a new pharmacy</p>
            <button
              type="button"
              className="text-xs text-black/45"
              onClick={() => setPickerOpen(false)}
            >
              Close
            </button>
          </div>
          {loadingPharmacies && (
            <p className="mt-2 text-sm text-black/50">Searching nearby pharmacies…</p>
          )}
          {pharmacyError && (
            <p className="mt-2 text-sm text-red-700">{pharmacyError}</p>
          )}
          {!loadingPharmacies && !pharmacyError && pharmacies.length === 0 && (
            <p className="mt-2 text-sm text-black/50">No pharmacies returned.</p>
          )}
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {pharmacies.map((pharmacy) => (
              <li key={pharmacy.id}>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  className="flex w-full flex-col rounded-lg border border-black/10 px-3 py-2 text-left text-sm hover:border-clay/40 hover:bg-mist/50 disabled:opacity-50"
                  onClick={() => setPendingPharmacy(pharmacy)}
                >
                  <span className="font-medium text-ink">{pharmacy.name}</span>
                  <span className="text-xs text-black/50">
                    {[pharmacy.address?.street1, pharmacy.address?.city, pharmacy.address?.state]
                      .filter(Boolean)
                      .join(", ") || "Address unavailable"}
                    {pharmacy.phone ? ` · ${pharmacy.phone}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingPharmacy)}
        title="Change pharmacy?"
        message={
          item.pharmacyName
            ? `Reroute ${item.medication} for ${item.patientName} from ${item.pharmacyName} to ${pendingPharmacy?.name || "the selected pharmacy"}?`
            : `Route ${item.medication} for ${item.patientName} to ${pendingPharmacy?.name || "the selected pharmacy"}?`
        }
        confirmLabel="Change pharmacy"
        busy={busyId === item.id}
        onConfirm={confirmPharmacyChange}
        onCancel={() => setPendingPharmacy(null)}
      />
    </article>
  );
}

function RefillCard({
  item,
  busyId,
  onResolve,
}: {
  item: RefillRequestItem;
  busyId: string | null;
  onResolve: (id: string, actionId: string, resolveAction: "accept" | "dismiss", note?: string) => void;
}) {
  return (
    <article className={`rounded-2xl border px-4 py-4 ${severityStyles(item.severity)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] opacity-70">
            {severityLabel(item.severity)} · refill · {triageBadge(item.triage)}
          </p>
          <h3 className="mt-1 font-medium text-ink">{item.patientName}</h3>
          <p className="text-sm text-black/70">{item.medication}</p>
        </div>
        <p className="max-w-[45%] text-right text-xs text-black/45">{item.requestSource}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-black/55">
        <span>
          Last visit: {item.lastVisitDaysAgo == null ? "—" : `${item.lastVisitDaysAgo}d ago`}
        </span>
        <span>
          Supply left: {item.daysSupplyLeft == null ? "—" : `${item.daysSupplyLeft}d`}
        </span>
        <span>{item.pharmacyName}</span>
      </div>
      {item.notes && <p className="mt-2 text-sm leading-6 text-black/75">{item.notes}</p>}
      <div className="mt-3 rounded-xl border border-black/10 bg-white/80 px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-clay">AI proposed resolution</p>
        <p className="mt-1 text-sm font-medium text-ink">{item.proposal.label}</p>
        <p className="mt-0.5 text-sm leading-5 text-black/60">{item.proposal.detail}</p>
      </div>
      <ActionButtons item={item} busyId={busyId} onResolve={onResolve} />
    </article>
  );
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
  hint,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="font-medium text-ink">
            {title}
            <span className="ml-2 text-sm font-normal text-black/45">{count}</span>
          </h2>
          {hint && <p className="mt-0.5 text-xs text-black/45">{hint}</p>}
        </div>
        <span className="text-sm text-clay">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open && <div className="space-y-3 border-t border-black/5 px-5 py-4">{children}</div>}
    </section>
  );
}

export function ClinicInbox() {
  const [data, setData] = useState<InboxPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [refillsOpen, setRefillsOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [triage, setTriage] = useState<TriageFilter>("all");

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/inbox");
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Could not load inbox");
    setData(json);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load inbox"),
    );
  }, [load]);

  async function reseed() {
    setSeeding(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seed", force: true }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Seed failed");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  async function onResolve(
    id: string,
    actionId: string,
    resolveAction: "accept" | "dismiss",
    note?: string,
  ) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve", id, actionId, resolveAction, note }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Update failed");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  const filteredOrders = useMemo(() => {
    const rows = data?.orders || [];
    return rows.filter((item) => {
      if (severity !== "all" && item.severity !== severity) return false;
      if (reason !== "all" && item.reasonCode !== reason) return false;
      const blob = [
        item.patientName,
        item.medication,
        item.pharmacyName || "",
        item.problem,
        item.reasonCode,
        item.proposal.label,
      ].join(" ");
      return matchesQuery(blob, query);
    });
  }, [data?.orders, query, severity, reason]);

  const filteredRefills = useMemo(() => {
    const rows = data?.refills || [];
    return rows.filter((item) => {
      if (severity !== "all" && item.severity !== severity) return false;
      if (triage !== "all" && item.triage !== triage) return false;
      const blob = [
        item.patientName,
        item.medication,
        item.pharmacyName,
        item.requestSource,
        item.notes,
        item.triage,
        item.proposal.label,
      ].join(" ");
      return matchesQuery(blob, query);
    });
  }, [data?.refills, query, severity, triage]);

  const orderCount = data?.counts.orders ?? 0;
  const refillCount = data?.counts.refills ?? 0;

  return (
    <main className="min-h-screen">
      <RoleNav role="doctor" doctorTab="inbox" inboxCount={orderCount + refillCount} />

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-clay">Clinic inbox</p>
            <h1 className="font-serif text-3xl text-ink">Exceptions & refills</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-black/60">
              Stacked queues you can collapse, search, and filter. Every item ships with an AI
              resolution to accept or dismiss.
            </p>
          </div>
          <button
            type="button"
            onClick={reseed}
            disabled={seeding}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black/70 hover:border-clay hover:text-ink disabled:opacity-50"
          >
            {seeding ? "Refreshing…" : "Refresh demo data"}
          </button>
        </div>

        <div className="mt-6 space-y-3 rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patient, medication, pharmacy, problem…"
            className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as SeverityFilter)}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All severities</option>
              <option value="high">Needs attention</option>
              <option value="medium">Review soon</option>
              <option value="low">Routine</option>
            </select>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as ReasonFilter)}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All order reasons</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="pa_required">PA required</option>
              <option value="needs_diagnosis">Needs diagnosis</option>
              <option value="routing_stuck">Routing stuck</option>
              <option value="not_covered">Not covered</option>
            </select>
            <select
              value={triage}
              onChange={(event) => setTriage(event.target.value as TriageFilter)}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All refill triage</option>
              <option value="approve">Approve</option>
              <option value="bridge">Bridge</option>
              <option value="needs_clinician">Needs clinician</option>
            </select>
            {(query || severity !== "all" || reason !== "all" || triage !== "all") && (
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-clay"
                onClick={() => {
                  setQuery("");
                  setSeverity("all");
                  setReason("all");
                  setTriage("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <p className="text-xs text-black/45">
            Showing {filteredOrders.length} orders · {filteredRefills.length} refills
            {data ? ` (of ${orderCount + refillCount} open)` : ""}
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {!data && !error && <p className="mt-8 text-sm text-black/50">Loading inbox…</p>}

        {data && (
          <div className="mt-6 space-y-4">
            <CollapsibleSection
              title="Problematic orders"
              count={filteredOrders.length}
              open={ordersOpen}
              onToggle={() => setOrdersOpen((value) => !value)}
              hint="Fulfillment failures after an Rx left the clinic"
            >
              {filteredOrders.length === 0 ? (
                <p className="py-6 text-center text-sm text-black/50">
                  No order exceptions match these filters.
                </p>
              ) : (
                filteredOrders.map((item) => (
                  <OrderCard
                    key={item.id}
                    item={item}
                    busyId={busyId}
                    onResolve={onResolve}
                  />
                ))
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Refill requests"
              count={filteredRefills.length}
              open={refillsOpen}
              onToggle={() => setRefillsOpen((value) => !value)}
              hint="Pharmacy and patient refill noise, auto-triaged"
            >
              {filteredRefills.length === 0 ? (
                <p className="py-6 text-center text-sm text-black/50">
                  No refill requests match these filters.
                </p>
              ) : (
                filteredRefills.map((item) => (
                  <RefillCard
                    key={item.id}
                    item={item}
                    busyId={busyId}
                    onResolve={onResolve}
                  />
                ))
              )}
            </CollapsibleSection>
          </div>
        )}
      </div>
    </main>
  );
}
