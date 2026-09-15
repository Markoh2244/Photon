import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listPatients, type PhotonPatient } from "@/lib/photon";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "inbox.json");

export type InboxSeverity = "high" | "medium" | "low";

export type ProposedAction = {
  id: string;
  label: string;
  detail: string;
  kind:
    | "reroute_pharmacy"
    | "switch_medication"
    | "clarify_pharmacy"
    | "approve_refill"
    | "bridge_refill"
    | "deny_needs_visit"
    | "attach_diagnosis"
    | "find_new_pharmacy";
  primary?: boolean;
};

export type OrderExceptionItem = {
  id: string;
  type: "order_exception";
  status: "open" | "resolved" | "dismissed";
  severity: InboxSeverity;
  patientId: string;
  patientName: string;
  orderId: string;
  medication: string;
  pharmacyName: string | null;
  problem: string;
  reasonCode: string;
  createdAt: string;
  proposal: ProposedAction;
  alternatives?: ProposedAction[];
  resolvedAt?: string;
  resolutionNote?: string;
};

export type RefillRequestItem = {
  id: string;
  type: "refill_request";
  status: "open" | "resolved" | "dismissed";
  severity: InboxSeverity;
  patientId: string;
  patientName: string;
  medication: string;
  pharmacyName: string;
  requestSource: string;
  lastVisitDaysAgo: number | null;
  daysSupplyLeft: number | null;
  controlled: boolean;
  highRisk: boolean;
  notes: string;
  createdAt: string;
  proposal: ProposedAction;
  alternatives?: ProposedAction[];
  triage: "approve" | "bridge" | "needs_clinician";
  resolvedAt?: string;
  resolutionNote?: string;
};

export type InboxItem = OrderExceptionItem | RefillRequestItem;

type InboxDb = {
  orders: OrderExceptionItem[];
  refills: RefillRequestItem[];
  seededAt: string | null;
};

const EMPTY: InboxDb = { orders: [], refills: [], seededAt: null };

async function read(): Promise<InboxDb> {
  try {
    const raw = await readFile(DB_FILE, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<InboxDb>) };
  } catch {
    return { ...EMPTY };
  }
}

async function write(db: InboxDb) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function pickPatients(patients: PhotonPatient[]) {
  const byLast = (last: string) =>
    patients.find((p) => p.name.last?.toLowerCase() === last.toLowerCase()) ||
    patients.find((p) => p.name.full.toLowerCase().includes(last.toLowerCase()));

  return {
    maya: byLast("Chen") || patients[0],
    ethan: byLast("Park") || patients[1] || patients[0],
    sofia: byLast("Reyes") || patients[2] || patients[0],
    jordan: byLast("Hale") || patients[3] || patients[0],
    john: byLast("Doe") || patients[4] || patients[0],
  };
}

function orderException(input: Omit<OrderExceptionItem, "id" | "type" | "status" | "createdAt">): OrderExceptionItem {
  return {
    ...input,
    id: `ordx_${randomUUID().slice(0, 8)}`,
    type: "order_exception",
    status: "open",
    createdAt: new Date().toISOString(),
  };
}

function refillRequest(input: Omit<RefillRequestItem, "id" | "type" | "status" | "createdAt">): RefillRequestItem {
  return {
    ...input,
    id: `rfl_${randomUUID().slice(0, 8)}`,
    type: "refill_request",
    status: "open",
    createdAt: new Date().toISOString(),
  };
}

/** Deterministic “AI” resolutions clinicians can accept in one click. */
export function proposeOrderResolution(input: {
  reasonCode: string;
  medication: string;
  pharmacyName: string | null;
  patientName: string;
}): { proposal: ProposedAction; alternatives: ProposedAction[]; severity: InboxSeverity; problem: string } {
  const findNewPharmacy: ProposedAction = {
    id: "act_find_pharmacy",
    kind: "find_new_pharmacy",
    label: "Find a new pharmacy",
    detail: "Search nearby Photon pharmacies and reroute this order to one you choose.",
  };

  switch (input.reasonCode) {
    case "out_of_stock":
      return {
        severity: "high",
        problem: `${input.pharmacyName || "Pharmacy"} cannot fill ${input.medication} — reported out of stock.`,
        proposal: {
          id: "act_reroute",
          kind: "reroute_pharmacy",
          label: "Reroute to nearby pharmacy with stock",
          detail: `Send ${input.patientName}'s order to Duane Reade (0.4 mi) — same coverage estimate, open until 9pm.`,
          primary: true,
        },
        alternatives: [
          findNewPharmacy,
          {
            id: "act_mail",
            kind: "reroute_pharmacy",
            label: "Offer mail-order instead",
            detail: "Route to plan-preferred mail pharmacy if pickup is not urgent.",
          },
        ],
      };
    case "not_covered":
      return {
        severity: "high",
        problem: `${input.medication} rejected at ${input.pharmacyName || "pharmacy"} — plan reports not covered / high patient pay.`,
        proposal: {
          id: "act_switch",
          kind: "switch_medication",
          label: "Switch to covered therapeutic alternative",
          detail: "Benefit check suggests a covered alternative at ~$5–15 patient pay with no PA. Draft for clinician review.",
          primary: true,
        },
        alternatives: [
          findNewPharmacy,
          {
            id: "act_pa",
            kind: "clarify_pharmacy",
            label: "Keep original and start PA paperwork",
            detail: "Only if the clinician insists on the brand; expect multi-day delay.",
          },
        ],
      };
    case "pa_required":
      return {
        severity: "medium",
        problem: `${input.medication} is covered with restrictions — prior authorization required before fill.`,
        proposal: {
          id: "act_alt_no_pa",
          kind: "switch_medication",
          label: "Offer covered alternative that avoids PA",
          detail: "Same class option is covered today at lower patient pay. Patient can start tonight.",
          primary: true,
        },
        alternatives: [
          findNewPharmacy,
          {
            id: "act_start_pa",
            kind: "clarify_pharmacy",
            label: "Proceed with PA on requested drug",
            detail: "Queue PA packet; warn patient of 2–5 day delay.",
          },
        ],
      };
    case "needs_diagnosis":
      return {
        severity: "medium",
        problem: `Pharmacy flagged ${input.medication} — diagnosis / clinical clarification requested before dispense.`,
        proposal: {
          id: "act_dx",
          kind: "attach_diagnosis",
          label: "Attach visit diagnosis and resend",
          detail: "Pull ICD-10 from last derm visit note and reply to pharmacy with confirmation the Rx is intentional.",
          primary: true,
        },
        alternatives: [
          findNewPharmacy,
          {
            id: "act_call",
            kind: "clarify_pharmacy",
            label: "Call pharmacy with verbal clarification",
            detail: "Useful if the pharmacist already has the patient waiting.",
          },
        ],
      };
    case "routing_stuck":
    default:
      return {
        severity: "medium",
        problem: `Order for ${input.medication} is still routing with no pharmacy selected.`,
        proposal: { ...findNewPharmacy, primary: true },
        alternatives: [
          {
            id: "act_patient_choice",
            kind: "reroute_pharmacy",
            label: "Send to patient to choose pharmacy",
            detail: "Keep ROUTING open and notify patient via text to pick pickup vs mail in the patient view.",
          },
          {
            id: "act_set_cvs",
            kind: "reroute_pharmacy",
            label: "Route to clinician-preferred pharmacy",
            detail: "Use the saved preferred pharmacy reason if one exists.",
          },
        ],
      };
  }
}

export function proposeRefillResolution(input: {
  medication: string;
  patientName: string;
  lastVisitDaysAgo: number | null;
  daysSupplyLeft: number | null;
  controlled: boolean;
  highRisk: boolean;
}): {
  proposal: ProposedAction;
  alternatives: ProposedAction[];
  severity: InboxSeverity;
  triage: RefillRequestItem["triage"];
} {
  if (input.highRisk || input.controlled) {
    return {
      severity: "high",
      triage: "needs_clinician",
      proposal: {
        id: "act_clinician",
        kind: "deny_needs_visit",
        label: "Hold for clinician review",
        detail: `${input.medication} needs a named prescriber decision (monitoring / iPLEDGE / controlled). Do not auto-approve.`,
        primary: true,
      },
      alternatives: [
        {
          id: "act_msg",
          kind: "deny_needs_visit",
          label: "Message patient to schedule visit",
          detail: "Portal message: refill blocked until follow-up is booked.",
        },
      ],
    };
  }

  if (input.lastVisitDaysAgo != null && input.lastVisitDaysAgo > 365) {
    return {
      severity: "high",
      triage: "needs_clinician",
      proposal: {
        id: "act_deny_visit",
        kind: "deny_needs_visit",
        label: "Deny — patient overdue for visit",
        detail: `${input.patientName} last seen ~${input.lastVisitDaysAgo} days ago. Ask front desk to schedule before refilling.`,
        primary: true,
      },
      alternatives: [
        {
          id: "act_bridge_once",
          kind: "bridge_refill",
          label: "One-time 30-day bridge",
          detail: "Only if clinically stable; attach note that follow-up is required.",
        },
      ],
    };
  }

  if (input.lastVisitDaysAgo != null && input.lastVisitDaysAgo > 180) {
    return {
      severity: "medium",
      triage: "bridge",
      proposal: {
        id: "act_bridge",
        kind: "bridge_refill",
        label: "Approve 30-day bridge + schedule follow-up",
        detail: `Last visit ~${input.lastVisitDaysAgo} days ago. Bridge supply, book return visit before next fill.`,
        primary: true,
      },
      alternatives: [
        {
          id: "act_full",
          kind: "approve_refill",
          label: "Approve full refill anyway",
          detail: "Override if chart review confirms stability.",
        },
      ],
    };
  }

  if (input.daysSupplyLeft != null && input.daysSupplyLeft > 14) {
    return {
      severity: "low",
      triage: "needs_clinician",
      proposal: {
        id: "act_early",
        kind: "deny_needs_visit",
        label: "Decline — too early to refill",
        detail: `Pharmacy request is ~${input.daysSupplyLeft} days early. Reply “not due — check active Rx.”`,
        primary: true,
      },
      alternatives: [
        {
          id: "act_approve_early",
          kind: "approve_refill",
          label: "Approve early fill (vacation / travel)",
          detail: "Use only with documented travel or dose change.",
        },
      ],
    };
  }

  return {
    severity: "low",
    triage: "approve",
    proposal: {
      id: "act_approve",
      kind: "approve_refill",
      label: "Approve refill",
      detail: `Active therapy, recent visit, ${input.medication} looks routine. Draft refill for clinician one-click confirm.`,
      primary: true,
    },
    alternatives: [
      {
        id: "act_change_pharm",
        kind: "reroute_pharmacy",
        label: "Approve but change pharmacy",
        detail: "Patient asked to move fill to a different store.",
      },
    ],
  };
}

export async function getInbox() {
  const db = await read();
  return {
    orders: db.orders.filter((i) => i.status === "open"),
    refills: db.refills.filter((i) => i.status === "open"),
    resolvedOrders: db.orders.filter((i) => i.status !== "open").slice(0, 10),
    resolvedRefills: db.refills.filter((i) => i.status !== "open").slice(0, 10),
    seededAt: db.seededAt,
    counts: {
      orders: db.orders.filter((i) => i.status === "open").length,
      refills: db.refills.filter((i) => i.status === "open").length,
      high:
        db.orders.filter((i) => i.status === "open" && i.severity === "high").length +
        db.refills.filter((i) => i.status === "open" && i.severity === "high").length,
    },
  };
}

export async function seedInbox(force = false) {
  const existing = await read();
  if (!force && existing.seededAt && (existing.orders.length || existing.refills.length)) {
    return getInbox();
  }

  let patients: PhotonPatient[] = [];
  try {
    patients = await listPatients();
  } catch {
    patients = [];
  }

  const p = pickPatients(patients);
  const name = (patient?: PhotonPatient, fallback = "Demo Patient") =>
    patient?.name.full || fallback;
  const idOf = (patient?: PhotonPatient, fallback = "pat_demo") => patient?.id || fallback;

  const orderSeeds: OrderExceptionItem[] = [
    (() => {
      const r = proposeOrderResolution({
        reasonCode: "out_of_stock",
        medication: "Adapalene-Benzoyl Peroxide Topical Gel 0.1-2.5 %",
        pharmacyName: "CVS Pharmacy #1082",
        patientName: name(p.maya, "Maya Chen"),
      });
      return orderException({
        severity: r.severity,
        patientId: idOf(p.maya),
        patientName: name(p.maya, "Maya Chen"),
        orderId: "ord_demo_maya_stock",
        medication: "Adapalene-Benzoyl Peroxide Topical Gel 0.1-2.5 %",
        pharmacyName: "CVS Pharmacy #1082",
        problem: r.problem,
        reasonCode: "out_of_stock",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const r = proposeOrderResolution({
        reasonCode: "pa_required",
        medication: "Tretinoin Topical Cream 0.05 %",
        pharmacyName: "Walgreens",
        patientName: name(p.jordan, "Jordan Hale"),
      });
      return orderException({
        severity: r.severity,
        patientId: idOf(p.jordan),
        patientName: name(p.jordan, "Jordan Hale"),
        orderId: "ord_demo_jordan_pa",
        medication: "Tretinoin Topical Cream 0.05 %",
        pharmacyName: "Walgreens",
        problem: r.problem,
        reasonCode: "pa_required",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const r = proposeOrderResolution({
        reasonCode: "needs_diagnosis",
        medication: "Triamcinolone Acetonide Topical Cream 0.1 %",
        pharmacyName: "Duane Reade",
        patientName: name(p.sofia, "Sofia Reyes"),
      });
      return orderException({
        severity: r.severity,
        patientId: idOf(p.sofia),
        patientName: name(p.sofia, "Sofia Reyes"),
        orderId: "ord_demo_sofia_dx",
        medication: "Triamcinolone Acetonide Topical Cream 0.1 %",
        pharmacyName: "Duane Reade",
        problem: r.problem,
        reasonCode: "needs_diagnosis",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const r = proposeOrderResolution({
        reasonCode: "routing_stuck",
        medication: "Metronidazole Topical Gel 0.75 %",
        pharmacyName: null,
        patientName: name(p.ethan, "Ethan Park"),
      });
      return orderException({
        severity: r.severity,
        patientId: idOf(p.ethan),
        patientName: name(p.ethan, "Ethan Park"),
        orderId: "ord_demo_ethan_route",
        medication: "Metronidazole Topical Gel 0.75 %",
        pharmacyName: null,
        problem: r.problem,
        reasonCode: "routing_stuck",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const r = proposeOrderResolution({
        reasonCode: "not_covered",
        medication: "Clindamycin Phosphate Topical Gel 1 %",
        pharmacyName: "CVS Pharmacy",
        patientName: name(p.john, "John Doe"),
      });
      return orderException({
        severity: r.severity,
        patientId: idOf(p.john),
        patientName: name(p.john, "John Doe"),
        orderId: "ord_demo_john_cov",
        medication: "Clindamycin Phosphate Topical Gel 1 %",
        pharmacyName: "CVS Pharmacy",
        problem: r.problem,
        reasonCode: "not_covered",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
  ];

  const refillSeeds: RefillRequestItem[] = [
    (() => {
      const med = "Adapalene Topical Cream 0.1 %";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.maya, "Maya Chen"),
        lastVisitDaysAgo: 45,
        daysSupplyLeft: 3,
        controlled: false,
        highRisk: false,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.maya),
        patientName: name(p.maya, "Maya Chen"),
        medication: med,
        pharmacyName: "CVS Pharmacy #1082",
        requestSource: "Surescripts · pharmacy-initiated",
        lastVisitDaysAgo: 45,
        daysSupplyLeft: 3,
        controlled: false,
        highRisk: false,
        notes: "Routine acne maintenance. Patient stable on current strength.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const med = "Triamcinolone Acetonide Topical Cream 0.1 %";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.sofia, "Sofia Reyes"),
        lastVisitDaysAgo: 210,
        daysSupplyLeft: 0,
        controlled: false,
        highRisk: false,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.sofia),
        patientName: name(p.sofia, "Sofia Reyes"),
        medication: med,
        pharmacyName: "Walgreens",
        requestSource: "Patient app refill request",
        lastVisitDaysAgo: 210,
        daysSupplyLeft: 0,
        controlled: false,
        highRisk: false,
        notes: "Eczema flare history. Overdue for follow-up body-map check.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const med = "Isotretinoin Oral Capsule 20 MG";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.jordan, "Jordan Hale"),
        lastVisitDaysAgo: 28,
        daysSupplyLeft: 2,
        controlled: false,
        highRisk: true,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.jordan),
        patientName: name(p.jordan, "Jordan Hale"),
        medication: med,
        pharmacyName: "Specialty pharmacy",
        requestSource: "Specialty pharmacy fax",
        lastVisitDaysAgo: 28,
        daysSupplyLeft: 2,
        controlled: false,
        highRisk: true,
        notes: "iPLEDGE / labs required. Do not auto-approve.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const med = "Metronidazole Topical Gel 0.75 %";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.ethan, "Ethan Park"),
        lastVisitDaysAgo: 60,
        daysSupplyLeft: 22,
        controlled: false,
        highRisk: false,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.ethan),
        patientName: name(p.ethan, "Ethan Park"),
        medication: med,
        pharmacyName: "Duane Reade",
        requestSource: "CVS Caremark auto-refill ping (wrong timing)",
        lastVisitDaysAgo: 60,
        daysSupplyLeft: 22,
        controlled: false,
        highRisk: false,
        notes: "Auto-generated early refill. Patient did not request.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const med = "Doxycycline Hyclate Oral Capsule 100 MG";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.john, "John Doe"),
        lastVisitDaysAgo: 400,
        daysSupplyLeft: 0,
        controlled: false,
        highRisk: false,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.john),
        patientName: name(p.john, "John Doe"),
        medication: med,
        pharmacyName: "Walgreens",
        requestSource: "Surescripts · pharmacy fax",
        lastVisitDaysAgo: 400,
        daysSupplyLeft: 0,
        controlled: false,
        highRisk: false,
        notes: "No visit in >12 months. Likely needs re-evaluation before more oral antibiotic.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
    (() => {
      const med = "Hydrocortisone Topical Cream 2.5 %";
      const r = proposeRefillResolution({
        medication: med,
        patientName: name(p.maya, "Maya Chen"),
        lastVisitDaysAgo: 20,
        daysSupplyLeft: 5,
        controlled: false,
        highRisk: false,
      });
      return refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId: idOf(p.maya),
        patientName: name(p.maya, "Maya Chen"),
        medication: med,
        pharmacyName: "Crossover Flatiron",
        requestSource: "Patient portal",
        lastVisitDaysAgo: 20,
        daysSupplyLeft: 5,
        controlled: false,
        highRisk: false,
        notes: "Short course facial-sparing steroid. Recent visit documented.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      });
    })(),
  ];

  const roster = [
    { patient: p.maya, fallbackName: "Maya Chen", fallbackId: "pat_maya" },
    { patient: p.ethan, fallbackName: "Ethan Park", fallbackId: "pat_ethan" },
    { patient: p.sofia, fallbackName: "Sofia Reyes", fallbackId: "pat_sofia" },
    { patient: p.jordan, fallbackName: "Jordan Hale", fallbackId: "pat_jordan" },
    { patient: p.john, fallbackName: "John Doe", fallbackId: "pat_john" },
  ];

  const meds = [
    "Adapalene Topical Cream 0.1 %",
    "Adapalene-Benzoyl Peroxide Topical Gel 0.1-2.5 %",
    "Tretinoin Topical Cream 0.025 %",
    "Tretinoin Topical Cream 0.05 %",
    "Clindamycin Phosphate Topical Gel 1 %",
    "Metronidazole Topical Gel 0.75 %",
    "Triamcinolone Acetonide Topical Cream 0.1 %",
    "Hydrocortisone Topical Cream 2.5 %",
    "Doxycycline Hyclate Oral Capsule 100 MG",
    "Ketoconazole Topical Cream 2 %",
    "Tacrolimus Topical Ointment 0.1 %",
    "Isotretinoin Oral Capsule 20 MG",
    "Spironolactone Oral Tablet 50 MG",
    "Minocycline Oral Capsule 100 MG",
  ];

  const pharmacies = [
    "CVS Pharmacy #1082",
    "Walgreens",
    "Duane Reade",
    "Crossover Flatiron",
    "Rite Aid",
    "Specialty pharmacy",
    null,
  ];

  const reasonCodes = [
    "out_of_stock",
    "pa_required",
    "needs_diagnosis",
    "routing_stuck",
    "not_covered",
  ] as const;

  const sources = [
    "Surescripts · pharmacy-initiated",
    "Patient portal",
    "Patient app refill request",
    "Specialty pharmacy fax",
    "CVS Caremark auto-refill ping",
    "Walgreens fax refill request",
  ];

  // 25 more order exceptions + 25 more refill requests (~50 added)
  for (let i = 0; i < 25; i += 1) {
    const who = roster[i % roster.length];
    const patientName = name(who.patient, who.fallbackName);
    const patientId = idOf(who.patient, `${who.fallbackId}_${i}`);
    const medication = meds[i % meds.length];
    const pharmacyName = pharmacies[i % pharmacies.length];
    const reasonCode = reasonCodes[i % reasonCodes.length];
    const r = proposeOrderResolution({
      reasonCode,
      medication,
      pharmacyName,
      patientName,
    });
    orderSeeds.push(
      orderException({
        severity: r.severity,
        patientId,
        patientName,
        orderId: `ord_bulk_${String(i + 1).padStart(2, "0")}`,
        medication,
        pharmacyName,
        problem: r.problem,
        reasonCode,
        proposal: r.proposal,
        alternatives: r.alternatives,
      }),
    );
  }

  for (let i = 0; i < 25; i += 1) {
    const who = roster[i % roster.length];
    const patientName = name(who.patient, who.fallbackName);
    const patientId = idOf(who.patient, `${who.fallbackId}_r${i}`);
    const medication = meds[(i + 3) % meds.length];
    const highRisk = medication.toLowerCase().includes("isotretinoin") || i % 11 === 0;
    const lastVisitDaysAgo = [20, 45, 60, 120, 210, 400, 15, 90][i % 8];
    const daysSupplyLeft = [0, 3, 5, 12, 22, 30, 1, 8][i % 8];
    const r = proposeRefillResolution({
      medication,
      patientName,
      lastVisitDaysAgo,
      daysSupplyLeft,
      controlled: false,
      highRisk,
    });
    refillSeeds.push(
      refillRequest({
        severity: r.severity,
        triage: r.triage,
        patientId,
        patientName,
        medication,
        pharmacyName: pharmacies[i % (pharmacies.length - 1)] || "CVS Pharmacy",
        requestSource: sources[i % sources.length],
        lastVisitDaysAgo,
        daysSupplyLeft,
        controlled: false,
        highRisk,
        notes:
          i % 4 === 0
            ? "Auto-generated request — confirm patient still wants this therapy."
            : i % 4 === 1
              ? "Stable on current regimen per last note."
              : i % 4 === 2
                ? "Patient mentioned travel next week."
                : "Chart needs quick scan before approving.",
        proposal: r.proposal,
        alternatives: r.alternatives,
      }),
    );
  }

  await write({
    orders: orderSeeds,
    refills: refillSeeds,
    seededAt: new Date().toISOString(),
  });
  return getInbox();
}

export async function resolveInboxItem(input: {
  id: string;
  action: "accept" | "dismiss";
  actionId?: string;
  note?: string;
}) {
  const db = await read();
  const stamp = new Date().toISOString();

  const patch = <T extends InboxItem>(item: T): T => {
    if (item.id !== input.id) return item;
    const chosen =
      item.proposal.id === input.actionId
        ? item.proposal
        : item.alternatives?.find((a) => a.id === input.actionId) || item.proposal;
    return {
      ...item,
      status: input.action === "accept" ? "resolved" : "dismissed",
      resolvedAt: stamp,
      resolutionNote:
        input.action === "accept"
          ? input.note || `Accepted: ${chosen.label}`
          : input.note || "Dismissed by clinician",
    };
  };

  db.orders = db.orders.map(patch);
  db.refills = db.refills.map(patch);
  await write(db);
  return getInbox();
}
