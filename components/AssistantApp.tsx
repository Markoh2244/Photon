"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotonPatient } from "@/lib/photon";
import { SAMPLE_NOTES } from "@/lib/protocols";
import { RoleNav } from "@/components/ui";

type Trace = {
  name: string;
  arguments: Record<string, unknown>;
  resultPreview: string;
  isError?: boolean;
};

type DraftRx = {
  treatmentId: string;
  treatmentName: string;
  dispenseQuantity: number;
  dispenseUnit: string;
  fillsAllowed: number;
  daysSupply: number;
  instructions: string;
  notes?: string;
  role?: "requested" | "alternative" | "protocol";
  selected?: boolean;
  coverageStatus?: string | null;
  patientPay?: number | null;
  paRequired?: boolean;
  pharmacyName?: string | null;
  why?: string;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  traces?: Trace[];
  drafts?: DraftRx[];
};

type Health = {
  ok: boolean;
  message?: string;
  reason?: string;
  patientCount?: number;
  openai?: boolean;
  expiresAt?: string;
};

type MentionState = {
  start: number;
  query: string;
} | null;

const PROMPTS = [
  {
    label: "Coverage check",
    text: "What insurance does @Maya have, and can we cover Adapalene-Benzoyl Peroxide?",
  },
  {
    label: "Draft from note",
    text: SAMPLE_NOTES[0].text,
  },
  {
    label: "List patients",
    text: "List patients",
  },
  {
    label: "Hold path",
    text: SAMPLE_NOTES[1].text,
  },
];

/** Active @query ending at cursor (e.g. "@jo" from "check @jo|"). */
function getMentionAtCursor(value: string, cursor: number): MentionState {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|[\s([{])@([A-Za-z0-9'._-]*)$/);
  if (!match) return null;
  const query = match[2] || "";
  const start = before.length - query.length - 1;
  return { start, query };
}

function ageFromDob(dob?: string | null) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function sexLabel(sex?: string | null) {
  if (!sex) return null;
  if (sex === "FEMALE") return "F";
  if (sex === "MALE") return "M";
  return sex;
}

function phoneHint(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `•••${digits.slice(-4)}`;
}

/** Clinician-facing lines for the mention picker (no Photon ids). */
function patientIdentityLines(patient: PhotonPatient) {
  const age = ageFromDob(patient.dateOfBirth);
  const parts: string[] = [];
  if (age != null) parts.push(`${age}y`);
  const sex = sexLabel(patient.sex);
  if (sex) parts.push(sex);
  if (patient.dateOfBirth) parts.push(`DOB ${patient.dateOfBirth}`);
  const location = [patient.address?.city, patient.address?.state].filter(Boolean).join(", ");
  if (location) parts.push(location);
  const phone = phoneHint(patient.phone);
  if (phone) parts.push(phone);
  return parts;
}

/** Visible chat mention — name only; Photon id stays in app state. */
function formatPatientMention(patient: PhotonPatient) {
  return `@${patient.name.full}`;
}

function patientMatchesQuery(patient: PhotonPatient, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const full = patient.name.full.toLowerCase();
  const first = (patient.name.first || "").toLowerCase();
  const last = (patient.name.last || "").toLowerCase();
  const city = (patient.address?.city || "").toLowerCase();
  const dob = (patient.dateOfBirth || "").toLowerCase();
  return (
    full.includes(q) ||
    first.startsWith(q) ||
    last.startsWith(q) ||
    city.startsWith(q) ||
    dob.startsWith(q)
  );
}

function resolveMentionedPatient(
  text: string,
  patients: PhotonPatient[],
  bindings: Record<string, string>,
) {
  const mentions = [...text.matchAll(/@([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)/g)];
  for (const mention of mentions.reverse()) {
    const name = mention[1];
    const key = name.toLowerCase();
    const boundId = bindings[key];
    if (boundId) {
      const bound = patients.find((p) => p.id === boundId);
      if (bound) return bound;
    }
    const hit =
      patients.find((p) => p.name.full.toLowerCase() === key) ||
      patients.find((p) => p.name.full.toLowerCase().startsWith(key)) ||
      patients.find((p) => patientMatchesQuery(p, key));
    if (hit) return hit;
  }
  return null;
}

export function AssistantApp() {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I’m DermClose — a prescribing assistant that talks to Photon through MCP tools (`tools/list` → `tools/call`). Type @ to mention a patient (e.g. @Maya). I draft and investigate; you still sign in Photon.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [patients, setPatients] = useState<PhotonPatient[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [showSign, setShowSign] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<DraftRx[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [mention, setMention] = useState<MentionState>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** Maps lowercase @Name → Photon patient id (kept out of the visible message). */
  const mentionBindingsRef = useRef<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setHealth({ ok: false, message: "Could not reach /api/health", reason: "error" }),
      );

    fetch("/api/inbox")
      .then((r) => r.json())
      .then((json) => {
        const orders = json.counts?.orders ?? 0;
        const refills = json.counts?.refills ?? 0;
        setInboxCount(orders + refills);
      })
      .catch(() => undefined);

    fetch("/api/patients")
      .then(async (r) => {
        const json = await r.json();
        if (r.ok) {
          setPatients(json.patients || []);
          setPatientId(json.patients?.[0]?.id || "");
        }
      })
      .catch(() => undefined);
  }, []);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    return patients.filter((p) => patientMatchesQuery(p, mention.query)).slice(0, 8);
  }, [mention, patients]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query, mention?.start]);

  const selectedPatient = patients.find((p) => p.id === patientId);
  const initialPrescriptions = useMemo(
    () =>
      JSON.stringify(
        pendingDrafts
          .filter((item) => item.selected !== false)
          .map((item) => ({
            treatmentId: item.treatmentId,
            dispenseQuantity: item.dispenseQuantity,
            dispenseUnit: item.dispenseUnit,
            fillsAllowed: item.fillsAllowed,
            daysSupply: item.daysSupply,
            instructions: item.instructions,
            notes: item.notes || "",
          })),
      ),
    [pendingDrafts],
  );

  function toggleDraftSelection(messageId: string, treatmentId: string) {
    setMessages((prev) => {
      const next = prev.map((message) => {
        if (message.id !== messageId || !message.drafts) return message;
        return {
          ...message,
          drafts: message.drafts.map((draft) =>
            draft.treatmentId === treatmentId
              ? { ...draft, selected: !(draft.selected !== false) }
              : draft,
          ),
        };
      });
      const updated = next.find((m) => m.id === messageId);
      if (updated?.drafts) {
        setPendingDrafts(updated.drafts.filter((d) => d.selected !== false));
      }
      return next;
    });
    setShowSign(false);
  }

  function selectedDraftsFrom(message: AssistantMessage) {
    return (message.drafts || []).filter((d) => d.selected !== false);
  }

  function updateMentionFromInput(value: string, cursor: number) {
    setMention(getMentionAtCursor(value, cursor));
  }

  function insertMention(patient: PhotonPatient) {
    if (!mention) return;
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? input.length;
    const before = input.slice(0, mention.start);
    const after = input.slice(cursor);
    const inserted = formatPatientMention(patient);
    const next = `${before}${inserted}${after.startsWith(" ") ? after : ` ${after}`}`;
    const nextCursor = before.length + inserted.length + 1;
    mentionBindingsRef.current[patient.name.full.toLowerCase()] = patient.id;
    setInput(next);
    setPatientId(patient.id);
    setMention(null);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setShowSign(false);
    setMention(null);

    const mentioned = resolveMentionedPatient(
      content,
      patients,
      mentionBindingsRef.current,
    );
    // Prefer the id bound when the clinician picked from @autocomplete.
    const resolvedPatientId = mentioned?.id || patientId || undefined;
    if (mentioned) setPatientId(mentioned.id);

    const userMsg: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: resolvedPatientId,
          messages: nextMessages
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Assistant failed");

      if (json.patientId) setPatientId(json.patientId);
      const drafts = (json.drafts?.prescriptions || []).map(
        (draft: DraftRx) => ({
          ...draft,
          selected: draft.selected !== false,
        }),
      );
      if (drafts.length) setPendingDrafts(drafts.filter((d: DraftRx) => d.selected));

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: json.reply,
          traces: json.traces || [],
          drafts,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Something went wrong talking to Photon.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionMatches[mentionIndex] || mentionMatches[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  return (
    <main className="min-h-screen">
      <RoleNav role="doctor" doctorTab="assistant" inboxCount={inboxCount} />

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-start">
        <section className="flex h-[min(70vh,720px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
          <div className="shrink-0 border-b border-black/10 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-clay">MCP assistant</p>
            <h1 className="font-serif text-2xl text-ink">Ask before you prescribe</h1>
            <p className="mt-1 text-sm text-black/60">
              Patient → insurance → catalog → screen → coverage. Then you sign.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[95%] ${message.role === "user" ? "ml-auto" : ""}`}
              >
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-ink text-white"
                      : "border border-black/10 bg-mist/60 text-ink"
                  }`}
                >
                  {message.content}
                </div>

                {message.traces && message.traces.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      className="text-xs uppercase tracking-wide text-clay"
                      onClick={() =>
                        setExpandedTrace(expandedTrace === message.id ? null : message.id)
                      }
                    >
                      {expandedTrace === message.id ? "Hide" : "Show"} MCP tool calls (
                      {message.traces.length})
                    </button>
                    {expandedTrace === message.id &&
                      message.traces.map((trace, index) => (
                        <div
                          key={`${trace.name}-${index}`}
                          className="rounded-xl border border-black/10 bg-white p-3 font-mono text-[11px] leading-5 text-black/80"
                        >
                          <p className={trace.isError ? "text-red-700" : "text-ink"}>
                            tools/call → {trace.name}
                          </p>
                          <pre className="mt-1 overflow-x-auto text-black/50">
                            {JSON.stringify(trace.arguments, null, 2)}
                          </pre>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-t border-black/5 pt-2">
                            {trace.resultPreview}
                          </pre>
                        </div>
                      ))}
                  </div>
                )}

                {message.drafts && message.drafts.length > 0 && (
                  <div className="mt-3 rounded-xl border border-clay/30 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-clay">
                      Proposed drafts
                    </p>
                    <p className="mt-1 text-xs text-black/50">
                      Toggle optional alternatives, then review only what you select.
                    </p>
                    <ul className="mt-3 space-y-2">
                      {message.drafts.map((draft) => {
                        const selected = draft.selected !== false;
                        return (
                          <li key={draft.treatmentId}>
                            <label
                              className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm ${
                                selected
                                  ? "border-clay/40 bg-mist/50"
                                  : "border-black/10 bg-white opacity-70"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={selected}
                                onChange={() =>
                                  toggleDraftSelection(message.id, draft.treatmentId)
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-ink">
                                    {draft.treatmentName}
                                  </span>
                                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-black/50">
                                    {draft.role === "alternative"
                                      ? "alternative"
                                      : draft.role === "protocol"
                                        ? "protocol"
                                        : "requested"}
                                  </span>
                                  {draft.paRequired && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
                                      PA
                                    </span>
                                  )}
                                  {draft.coverageStatus && !draft.paRequired && (
                                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
                                      {draft.coverageStatus}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-black/50">
                                  {draft.dispenseQuantity} {draft.dispenseUnit}
                                  {draft.patientPay != null
                                    ? ` · est. pay $${Number(draft.patientPay).toFixed(2)}`
                                    : ""}
                                  {draft.pharmacyName ? ` · ${draft.pharmacyName}` : ""}
                                </p>
                                {draft.why && (
                                  <p className="mt-1 text-xs text-black/55">{draft.why}</p>
                                )}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      className="mt-3 rounded-lg bg-clay px-3 py-2 text-sm text-white disabled:opacity-40"
                      disabled={selectedDraftsFrom(message).length === 0}
                      onClick={() => {
                        const chosen = selectedDraftsFrom(message);
                        setPendingDrafts(chosen);
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.id === message.id ? { ...m, drafts: message.drafts } : m,
                          ),
                        );
                        setShowSign(true);
                      }}
                    >
                      Review and sign in Photon
                      {selectedDraftsFrom(message).length
                        ? ` (${selectedDraftsFrom(message).length})`
                        : ""}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <p className="text-sm text-black/50">Calling Photon MCP tools…</p>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-black/10 px-5 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  className="rounded-full border border-black/15 px-3 py-1 text-xs text-black/70 hover:border-clay hover:text-ink"
                  onClick={() => send(prompt.text)}
                  disabled={busy || health?.ok === false}
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <form
              className="relative flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (mention && mentionMatches.length) return;
                send(input);
              }}
            >
              {mention && (
                <div
                  className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg"
                  role="listbox"
                  aria-label="Patient mentions"
                >
                  {mentionMatches.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-black/50">
                      No patients match “{mention.query || "…"}”
                    </p>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto py-1">
                      {mentionMatches.map((patient, index) => (
                        <li key={patient.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === mentionIndex}
                            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm ${
                              index === mentionIndex ? "bg-mist" : "hover:bg-mist/70"
                            }`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              insertMention(patient);
                            }}
                            onMouseEnter={() => setMentionIndex(index)}
                          >
                            <span className="font-medium text-ink">{patient.name.full}</span>
                            <span className="text-xs text-black/50">
                              {patientIdentityLines(patient).join(" · ") || "No demographics on file"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="border-t border-black/5 px-3 py-1.5 text-[11px] text-black/40">
                    ↑↓ to move · Enter to select · Esc to dismiss
                  </p>
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="h-20 flex-1 resize-none rounded-xl border border-black/15 px-3 py-2 text-sm leading-5"
                placeholder='Type @ to mention a patient — e.g. "coverage for @Maya"'
                value={input}
                onChange={(event) => {
                  const value = event.target.value;
                  setInput(value);
                  updateMentionFromInput(value, event.target.selectionStart);
                }}
                onClick={(event) =>
                  updateMentionFromInput(input, event.currentTarget.selectionStart)
                }
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    updateMentionFromInput(input, event.currentTarget.selectionStart);
                  }
                }}
                onKeyDown={onComposerKeyDown}
                onBlur={() => {
                  // Delay so listbox mousedown can fire first.
                  window.setTimeout(() => setMention(null), 120);
                }}
                disabled={busy}
              />
              <button
                type="submit"
                className="self-end rounded-xl bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={busy || !input.trim() || health?.ok === false}
              >
                Send
              </button>
            </form>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="font-medium">Photon connection</h2>
            {health == null && <p className="mt-2 text-sm text-black/50">Checking…</p>}
            {health?.ok && (
              <p className="mt-2 text-sm text-black/70">
                Connected · {health.patientCount ?? "?"} patients
                {health.openai ? " · OpenAI tools enabled" : " · deterministic MCP agent"}
              </p>
            )}
            {health && !health.ok && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-medium">Token needs refresh</p>
                <p className="mt-1 text-black/70">{health.message}</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-black/70">
                  <li>
                    Sign in at{" "}
                    <a className="underline" href="https://app.neutron.health" target="_blank" rel="noreferrer">
                      app.neutron.health
                    </a>
                  </li>
                  <li>Copy a fresh user access token</li>
                  <li>
                    Paste into <code className="text-xs">.env.local</code> as{" "}
                    <code className="text-xs">PHOTON_ACCESS_TOKEN</code>
                  </li>
                  <li>Restart <code className="text-xs">npm run dev</code></li>
                </ol>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="font-medium">Patient context</h2>
            <select
              className="mt-3 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
            >
              <option value="">Auto-detect from message</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name.full}
                </option>
              ))}
            </select>
            {selectedPatient && (
              <div className="mt-3 space-y-1 text-sm text-black/65">
                <p>
                  {selectedPatient.phone || "No phone"} ·{" "}
                  {selectedPatient.address?.city || "No city"}
                </p>
                <p>
                  Benefits: {(selectedPatient.benefits || []).length || "none"} · Rx:{" "}
                  {(selectedPatient.prescriptions || []).length}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="font-medium">MCP tools</h2>
            <p className="mt-2 text-sm text-black/60">
              Local JSON-RPC at <code className="text-xs">/api/mcp</code>. Same shape as Photon’s
              hosted server.
            </p>
            <ul className="mt-3 space-y-1 font-mono text-[11px] text-black/70">
              <li>list_patients</li>
              <li>get_patient</li>
              <li>get_insurance</li>
              <li>search_treatments</li>
              <li>screen_prescription</li>
              <li>suggest_medication_coverage</li>
              <li>check_medication_coverage</li>
              <li>draft_visit_plan</li>
              <li>search_pharmacies</li>
              <li>ensure_sandbox_benefit</li>
            </ul>
          </div>

          {showSign && selectedPatient && pendingDrafts.length > 0 && (
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
              <h2 className="font-medium">Photon prescribe workflow</h2>
              <p className="mb-3 mt-2 text-sm text-black/60">
                Coverage check is on. Sign-in uses Google SSO on the SPA client.
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
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
