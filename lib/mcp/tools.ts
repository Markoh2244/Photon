/**
 * Photon MCP-style tool runtime.
 *
 * Photon's hosted MCP (https://ai.neutron.health) uses the same tools/list +
 * tools/call shape. Cursor cannot complete that OAuth flow yet, so this app
 * exposes an equivalent tool surface over Photon's GraphQL Clinical + Benefits APIs.
 */

import {
  PhotonError,
  comparePharmacyCoverage,
  createPatient,
  createPrescription,
  ensurePatientBenefit,
  getPatient,
  listPatientBenefits,
  listPatients,
  prescriptionScreen,
  searchPharmacies,
  searchTreatments,
  type CoverageOption,
  type PhotonPatient,
  type PhotonPharmacy,
  type ScreenAlert,
  type TreatmentHit,
} from "@/lib/photon";
import { buildPlan, parseNote, type DraftPlan } from "@/lib/protocols";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type McpContent = { type: "text"; text: string };

export type McpToolResult = {
  content: McpContent[];
  isError?: boolean;
  structured?: unknown;
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_patients",
    description: "List patients in the Photon org (deduped). Use to find a patient id by name.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional name filter (case-insensitive substring).",
        },
      },
    },
  },
  {
    name: "get_patient",
    description:
      "Retrieve a patient chart: demographics, allergies, preferred pharmacies, prescriptions, and orders.",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "Photon patient id (pat_…)." },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "get_insurance",
    description:
      "Retrieve a patient's insurance benefits on file (BIN/PCN/member). Required before coverage checks.",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "ensure_sandbox_benefit",
    description:
      "Attach a Photon sandbox benefit fixture so coverage checks work in Neutron. Use 'covered' (BIN 610014) or 'paRequired' (BIN 020321).",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        fixture: {
          type: "string",
          enum: ["covered", "paRequired"],
          description: "Sandbox benefit fixture. Default covered.",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "search_treatments",
    description: "Search Photon's medication catalog by free-text term (drug name, strength, form).",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Search term, e.g. 'Adapalene' or 'Wegovy'." },
      },
      required: ["term"],
    },
  },
  {
    name: "search_pharmacies",
    description: "Find nearby pickup pharmacies by lat/long (defaults to NYC demo coords).",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        radius: { type: "number", description: "Miles. Default 8." },
      },
    },
  },
  {
    name: "screen_prescription",
    description: "Run Photon's drug/allergy interaction screen for drafted treatment ids.",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        treatment_ids: {
          type: "array",
          items: { type: "string" },
          description: "Photon treatment ids to screen.",
        },
      },
      required: ["patient_id", "treatment_ids"],
    },
  },
  {
    name: "check_medication_coverage",
    description:
      "Compare real-time insurance coverage / patient pay across pharmacies for existing prescription ids. Returns PA flags, prices, and alternatives when Photon has them.",
    inputSchema: {
      type: "object",
      properties: {
        prescription_ids: {
          type: "array",
          items: { type: "string" },
        },
        pharmacy_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional. If omitted, searches nearby NYC pharmacies first.",
        },
      },
      required: ["prescription_ids"],
    },
  },
  {
    name: "suggest_medication_coverage",
    description:
      "Before placing an order: search the catalog, screen, create a provisional Rx (no order/pharmacy), and run a live benefit check across nearby pharmacies. Returns coverage status, estimated patient pay, PA flags, and plan alternatives so the clinician can choose before signing.",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        medication: {
          type: "string",
          description: "Medication search term, e.g. Adapalene or Wegovy.",
        },
        treatment_id: {
          type: "string",
          description: "Optional exact Photon treatment id to skip catalog search.",
        },
      },
      required: ["patient_id", "medication"],
    },
  },
  {
    name: "draft_visit_plan",
    description:
      "Draft a narrow dermatology protocol plan (acne/rosacea/eczema) from a visit note, resolve catalog treatments, and optionally screen. Does not send a prescription.",
    inputSchema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        note: { type: "string", description: "Visit note text." },
      },
      required: ["note"],
    },
  },
  {
    name: "create_patient",
    description: "Create a patient in Photon (demo helper).",
    inputSchema: {
      type: "object",
      properties: {
        first: { type: "string" },
        last: { type: "string" },
        date_of_birth: { type: "string", description: "YYYY-MM-DD" },
        sex: { type: "string", enum: ["MALE", "FEMALE", "UNKNOWN"] },
        phone: { type: "string" },
      },
      required: ["first", "last", "date_of_birth", "sex"],
    },
  },
];

function ok(data: unknown, summary?: string): McpToolResult {
  const text =
    summary ||
    (typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return { content: [{ type: "text", text }], structured: data };
}

function fail(error: unknown): McpToolResult {
  const message =
    error instanceof PhotonError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Tool failed";
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structured: { error: message },
  };
}

function summarizePatient(patient: PhotonPatient) {
  return {
    id: patient.id,
    name: patient.name.full,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    phone: patient.phone,
    city: patient.address?.city,
    allergies: (patient.allergies || [])
      .map((a) => a.allergen?.name)
      .filter(Boolean),
    preferredPharmacies: (patient.preferredPharmacies || []).map((p) => ({
      id: p.id,
      name: p.name,
      city: p.address?.city,
    })),
    benefitCount: patient.benefits?.length || 0,
    activePrescriptions: (patient.prescriptions || [])
      .filter((rx) => rx.state === "ACTIVE")
      .map((rx) => ({
        id: rx.id,
        treatment: rx.treatment?.name,
        state: rx.state,
      })),
    openOrders: (patient.orders || [])
      .filter((o) => ["ROUTING", "PENDING", "PLACED"].includes(o.state))
      .map((o) => ({
        id: o.id,
        state: o.state,
        pharmacy: o.pharmacy?.name || null,
        fills: (o.fills || []).map((f) => f.prescription?.treatment?.name || f.treatment?.name),
      })),
  };
}

function summarizeCoverage(options: CoverageOption[]) {
  return options.map((option) => ({
    status: option.status,
    statusMessage: option.statusMessage,
    price: option.price,
    paRequired: option.paRequired,
    isAlternative: option.isAlternative,
    treatment: option.treatment?.name || null,
    pharmacy: option.pharmacy
      ? { id: option.pharmacy.id, name: option.pharmacy.name }
      : null,
  }));
}

function guessDispense(treatmentName: string) {
  const name = treatmentName.toLowerCase();
  if (/(gel|cream|ointment|lotion)/.test(name)) {
    return { dispenseQuantity: 45, dispenseUnit: "Gram" };
  }
  if (name.includes("capsule")) return { dispenseQuantity: 30, dispenseUnit: "Capsule" };
  if (name.includes("tablet")) return { dispenseQuantity: 30, dispenseUnit: "Tablet" };
  return { dispenseQuantity: 30, dispenseUnit: "Each" };
}

function formatMoney(price: number | null | undefined) {
  if (price == null || Number.isNaN(price)) return "n/a";
  return `$${Number(price).toFixed(2)}`;
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "list_patients": {
        const query = String(args.query || "")
          .trim()
          .toLowerCase();
        const patients = await listPatients();
        const filtered = query
          ? patients.filter((p) => p.name.full.toLowerCase().includes(query))
          : patients;
        const rows = filtered.map((p) => ({
          id: p.id,
          name: p.name.full,
          dateOfBirth: p.dateOfBirth,
          sex: p.sex,
          benefits: (p.benefits || []).length,
        }));
        return ok(
          { patients: rows, count: rows.length },
          rows.length
            ? rows.map((r) => `${r.name} (${r.id})`).join("\n")
            : "No patients matched.",
        );
      }

      case "get_patient": {
        const patientId = String(args.patient_id || "");
        if (!patientId) throw new PhotonError("patient_id is required");
        const patient = await getPatient(patientId);
        const summary = summarizePatient(patient);
        return ok(
          summary,
          `${summary.name} · DOB ${summary.dateOfBirth || "?"} · ${summary.benefitCount} benefit(s) · ${summary.activePrescriptions.length} active Rx · ${summary.openOrders.length} open order(s)`,
        );
      }

      case "get_insurance": {
        const patientId = String(args.patient_id || "");
        if (!patientId) throw new PhotonError("patient_id is required");
        const benefits = await listPatientBenefits(patientId);
        if (!benefits.length) {
          return ok(
            { patient_id: patientId, benefits: [] },
            "No insurance benefits on file. Coverage checks will not run until a benefit is added (try ensure_sandbox_benefit in Neutron).",
          );
        }
        return ok(
          { patient_id: patientId, benefits },
          benefits
            .map(
              (b) =>
                `BIN ${b.bin}${b.pcn ? ` · PCN ${b.pcn}` : ""} · member ${b.memberId}${b.type ? ` · ${b.type}` : ""}`,
            )
            .join("\n"),
        );
      }

      case "ensure_sandbox_benefit": {
        const patientId = String(args.patient_id || "");
        if (!patientId) throw new PhotonError("patient_id is required");
        const fixture = (args.fixture === "paRequired" ? "paRequired" : "covered") as
          | "covered"
          | "paRequired";
        const result = await ensurePatientBenefit(patientId, fixture);
        return ok(
          result,
          result.created
            ? `Attached sandbox benefit ${fixture} (BIN ${result.benefit.bin}).`
            : `Patient already has benefit BIN ${result.benefit.bin}.`,
        );
      }

      case "search_treatments": {
        const term = String(args.term || "").trim();
        if (!term) throw new PhotonError("term is required");
        const treatments: TreatmentHit[] = await searchTreatments(term);
        const top = treatments.slice(0, 12);
        return ok(
          { term, treatments: top, total: treatments.length },
          top.length
            ? top.map((t) => `${t.name} (${t.id})`).join("\n")
            : `No catalog hits for "${term}".`,
        );
      }

      case "search_pharmacies": {
        const latitude = Number(args.latitude ?? 40.7359);
        const longitude = Number(args.longitude ?? -73.9911);
        const radius = Number(args.radius ?? 8);
        const pharmacies: PhotonPharmacy[] = await searchPharmacies({
          latitude,
          longitude,
          radius,
          type: "PICK_UP",
        });
        const top = pharmacies.slice(0, 10).map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          address: p.address,
          fulfillmentTypes: p.fulfillmentTypes,
        }));
        return ok(
          { pharmacies: top, count: pharmacies.length },
          top.map((p) => `${p.name} · ${p.address?.city || "?"} (${p.id})`).join("\n"),
        );
      }

      case "screen_prescription": {
        const patientId = String(args.patient_id || "");
        const treatmentIds = Array.isArray(args.treatment_ids)
          ? args.treatment_ids.map(String)
          : [];
        if (!patientId || !treatmentIds.length) {
          throw new PhotonError("patient_id and treatment_ids are required");
        }
        const alerts: ScreenAlert[] = await prescriptionScreen(patientId, treatmentIds);
        return ok(
          { alerts, count: alerts.length },
          alerts.length
            ? alerts
                .map((a) => `[${a.severity || a.type || "ALERT"}] ${a.description}`)
                .join("\n")
            : "No screening alerts.",
        );
      }

      case "check_medication_coverage": {
        const prescriptionIds = Array.isArray(args.prescription_ids)
          ? args.prescription_ids.map(String)
          : [];
        if (!prescriptionIds.length) {
          throw new PhotonError("prescription_ids are required");
        }
        let pharmacyIds = Array.isArray(args.pharmacy_ids)
          ? args.pharmacy_ids.map(String)
          : [];
        if (!pharmacyIds.length) {
          const pharmacies = await searchPharmacies({
            latitude: 40.7359,
            longitude: -73.9911,
            radius: 8,
            type: "PICK_UP",
          });
          pharmacyIds = pharmacies.slice(0, 5).map((p) => p.id);
        }
        const rows = await comparePharmacyCoverage(pharmacyIds, prescriptionIds);
        const compact = rows.map((row) => ({
          pharmacyId: row.pharmacyId,
          error: row.error,
          primary: row.primary ? summarizeCoverage([row.primary])[0] : null,
          alternatives: summarizeCoverage(row.options.filter((o) => o.isAlternative)).slice(0, 3),
        }));
        const lines = compact.map((row) => {
          if (row.error) return `${row.pharmacyId}: error — ${row.error}`;
          if (!row.primary) return `${row.pharmacyId}: no coverage result`;
          const p = row.primary;
          const price = p.price == null ? "?" : `$${p.price.toFixed(2)}`;
          return `${row.pharmacyId}: ${p.status} · pay ${price}${p.paRequired ? " · PA required" : ""}${p.treatment ? ` · ${p.treatment}` : ""}`;
        });
        return ok({ comparisons: compact }, lines.join("\n") || "No coverage rows.");
      }

      case "suggest_medication_coverage": {
        const patientId = String(args.patient_id || "");
        const medication = String(args.medication || "").trim();
        const treatmentIdArg = args.treatment_id ? String(args.treatment_id) : "";
        if (!patientId || !medication) {
          throw new PhotonError("patient_id and medication are required");
        }

        let treatment: TreatmentHit | null = null;
        let catalog: TreatmentHit[] = [];
        if (treatmentIdArg) {
          treatment = { id: treatmentIdArg, name: medication };
        } else {
          catalog = await searchTreatments(medication);
          treatment = catalog[0] || null;
        }
        if (!treatment) {
          return ok(
            { patient_id: patientId, medication, treatments: [] },
            `No catalog match for "${medication}".`,
          );
        }

        let alerts: ScreenAlert[] = [];
        try {
          alerts = await prescriptionScreen(patientId, [treatment.id]);
        } catch {
          alerts = [];
        }

        const dispense = guessDispense(treatment.name);
        const provisional = await createPrescription({
          patientId,
          treatmentId: treatment.id,
          dispenseQuantity: dispense.dispenseQuantity,
          dispenseUnit: dispense.dispenseUnit,
          fillsAllowed: 1,
          daysSupply: 30,
          instructions: `Provisional coverage check for ${treatment.name}. Confirm sig before sending.`,
          notes: "DermClose provisional Rx for benefit check — no order placed.",
        });

        const pharmacies = await searchPharmacies({
          latitude: 40.7359,
          longitude: -73.9911,
          radius: 8,
          type: "PICK_UP",
        });
        const pharmacySlice = pharmacies.slice(0, 5);
        const pharmacyIds = pharmacySlice.map((p) => p.id);
        const pharmacyById = new Map(pharmacySlice.map((p) => [p.id, p]));

        const rows = await comparePharmacyCoverage(pharmacyIds, [provisional.id]);
        const scored = rows
          .map((row) => {
            const pharmacy = pharmacyById.get(row.pharmacyId);
            const primary = row.primary;
            const alternatives = summarizeCoverage(
              row.options.filter((o) => o.isAlternative),
            ).slice(0, 4);
            return {
              pharmacyId: row.pharmacyId,
              pharmacyName: pharmacy?.name || row.pharmacyId,
              pharmacyCity: pharmacy?.address?.city || null,
              error: row.error,
              primary: primary ? summarizeCoverage([primary])[0] : null,
              alternatives,
              sortKey:
                row.error || !primary
                  ? Number.POSITIVE_INFINITY
                  : primary.paRequired
                    ? 10_000 + (primary.price ?? 9999)
                    : (primary.price ?? 9999),
            };
          })
          .sort((a, b) => a.sortKey - b.sortKey);

        const best = scored.find((row) => row.primary && !row.error) || null;
        const altMeds = [
          ...new Map(
            scored
              .flatMap((row) => row.alternatives)
              .filter((alt) => alt.treatment)
              .map((alt) => [
                `${alt.treatment}|${alt.paRequired}|${alt.price}`,
                alt,
              ]),
          ).values(),
        ].slice(0, 5);

        const recommendation = best?.primary
          ? {
              treatment: treatment.name,
              treatmentId: treatment.id,
              status: best.primary.status,
              statusMessage: best.primary.statusMessage,
              patientPay: best.primary.price,
              paRequired: best.primary.paRequired,
              pharmacy: best.pharmacyName,
              pharmacyId: best.pharmacyId,
            }
          : null;

        const lines = [
          `Provisional Rx ${provisional.id} created for benefit check (no order placed).`,
          `Catalog: ${treatment.name}`,
          alerts.length
            ? `Screening: ${alerts.length} alert(s) — ${alerts.map((a) => a.description).join("; ")}`
            : "Screening: no alerts",
          recommendation
            ? `Suggested path: ${recommendation.status} at ${recommendation.pharmacy} · pay ${formatMoney(recommendation.patientPay)}${recommendation.paRequired ? " · PA required" : " · no PA"}`
            : "No pharmacy returned a usable coverage result.",
          "",
          "Pharmacy quotes:",
          ...scored.slice(0, 5).map((row) => {
            if (row.error) return `• ${row.pharmacyName}: ${row.error}`;
            if (!row.primary) return `• ${row.pharmacyName}: no coverage result`;
            return `• ${row.pharmacyName}: ${row.primary.status} · ${formatMoney(row.primary.price)}${row.primary.paRequired ? " · PA" : ""}${row.primary.statusMessage ? ` — ${row.primary.statusMessage}` : ""}`;
          }),
        ];

        if (altMeds.length) {
          lines.push("", "Plan alternatives from benefit check:");
          for (const alt of altMeds) {
            lines.push(
              `• ${alt.treatment} · ${alt.status} · ${formatMoney(alt.price)}${alt.paRequired ? " · PA" : ""}${alt.pharmacy?.name ? ` @ ${alt.pharmacy.name}` : ""}`,
            );
          }
        }

        const requestedDraft = {
          treatmentId: treatment.id,
          treatmentName: treatment.name,
          ...dispense,
          fillsAllowed: 1,
          daysSupply: 30,
          instructions: `Take/use as directed for ${treatment.name}. Confirm sig in Photon before sending.`,
          notes: "Requested medication — coverage checked before order.",
          role: "requested" as const,
          coverageStatus: recommendation?.status || null,
          patientPay: recommendation?.patientPay ?? null,
          paRequired: recommendation?.paRequired ?? false,
          pharmacyName: recommendation?.pharmacy || null,
          why: recommendation?.paRequired
            ? "Requested drug requires prior authorization."
            : "Requested drug from clinician query.",
        };

        const alternativeDrafts: {
          treatmentId: string;
          treatmentName: string;
          dispenseQuantity: number;
          dispenseUnit: string;
          fillsAllowed: number;
          daysSupply: number;
          instructions: string;
          notes: string;
          role: "alternative";
          coverageStatus: string | null;
          patientPay: number | null;
          paRequired: boolean;
          pharmacyName: string | null;
          why: string;
        }[] = [];

        for (const alt of altMeds.slice(0, 4)) {
          if (!alt.treatment) continue;
          const hits = await searchTreatments(alt.treatment);
          const hit =
            hits.find((h) => h.name.toLowerCase() === alt.treatment!.toLowerCase()) ||
            hits.find((h) =>
              h.name.toLowerCase().includes(
                alt.treatment!.toLowerCase().split(/\s+/).slice(0, 2).join(" "),
              ),
            ) ||
            hits[0];
          if (!hit) continue;
          if (hit.id === treatment.id) continue;
          if (alternativeDrafts.some((d) => d.treatmentId === hit.id)) continue;
          const altDispense = guessDispense(hit.name);
          alternativeDrafts.push({
            treatmentId: hit.id,
            treatmentName: hit.name,
            ...altDispense,
            fillsAllowed: 1,
            daysSupply: 30,
            instructions: `Take/use as directed for ${hit.name}. Confirm sig in Photon before sending.`,
            notes: "Plan alternative from Photon benefit check — optional draft.",
            role: "alternative",
            coverageStatus: alt.status || null,
            patientPay: alt.price ?? null,
            paRequired: Boolean(alt.paRequired),
            pharmacyName: alt.pharmacy?.name || null,
            why: alt.paRequired
              ? "Benefit-check alternative (may still need PA)."
              : "Benefit-check alternative — typically easier path than the requested drug.",
          });
        }

        const preferAlt =
          Boolean(requestedDraft.paRequired) &&
          alternativeDrafts.some((d) => !d.paRequired);
        const draftOptions = [
          { ...requestedDraft, selected: !preferAlt },
          ...alternativeDrafts.map((d) => ({
            ...d,
            selected: preferAlt ? !d.paRequired : false,
          })),
        ];
        // If preferAlt selected multiple non-PA alts, keep only the cheapest selected by default.
        if (preferAlt) {
          const selectable = draftOptions.filter((d) => d.role === "alternative" && !d.paRequired);
          const bestAlt = [...selectable].sort(
            (a, b) => (a.patientPay ?? 9999) - (b.patientPay ?? 9999),
          )[0];
          for (const option of draftOptions) {
            option.selected =
              option.role === "alternative" && bestAlt
                ? option.treatmentId === bestAlt.treatmentId
                : false;
          }
        }

        return ok(
          {
            patient_id: patientId,
            medication,
            treatment,
            catalogOptions: catalog.slice(0, 6),
            provisionalPrescriptionId: provisional.id,
            alerts,
            recommendation,
            pharmacyQuotes: scored,
            alternativeMedications: altMeds,
            orderPlaced: false,
            draft: requestedDraft,
            draftOptions,
          },
          lines.join("\n"),
        );
      }

      case "draft_visit_plan": {
        const note = String(args.note || "");
        if (!note.trim()) throw new PhotonError("note is required");
        const patientId = args.patient_id ? String(args.patient_id) : "";
        const ctx = parseNote(note);
        const plan: DraftPlan = await buildPlan(ctx, searchTreatments);
        let alerts: ScreenAlert[] = [];
        let screenError: string | null = null;
        const treatmentIds = plan.drafts.map((d) => d.treatmentId);
        if (patientId && treatmentIds.length) {
          try {
            alerts = await prescriptionScreen(patientId, treatmentIds);
          } catch (error) {
            screenError =
              error instanceof PhotonError ? error.message : "Screening unavailable";
          }
        }
        return ok(
          { plan, alerts, screenError },
          [
            plan.title,
            plan.assessment,
            ...plan.holds.map((h) => `HOLD: ${h.title} — ${h.detail}`),
            ...plan.drafts.map(
              (d) =>
                `DRAFT ${d.role}: ${d.treatmentName} · ${d.dispenseQuantity} ${d.dispenseUnit} · ${d.why}`,
            ),
            alerts.length ? `${alerts.length} screening alert(s)` : "No screening alerts",
          ].join("\n"),
        );
      }

      case "create_patient": {
        const first = String(args.first || "");
        const last = String(args.last || "");
        const dateOfBirth = String(args.date_of_birth || "");
        const sex = String(args.sex || "UNKNOWN") as "MALE" | "FEMALE" | "UNKNOWN";
        if (!first || !last || !dateOfBirth) {
          throw new PhotonError("first, last, and date_of_birth are required");
        }
        const patient = await createPatient({
          first,
          last,
          dateOfBirth,
          sex,
          phone: args.phone ? String(args.phone) : undefined,
          address: {
            street1: "200 Park Ave S",
            city: "New York",
            state: "NY",
            postalCode: "10003",
            country: "US",
          },
        });
        return ok(
          summarizePatient(patient),
          `Created ${patient.name.full} (${patient.id}).`,
        );
      }

      default:
        throw new PhotonError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(error);
  }
}

export function listMcpTools(): McpTool[] {
  return MCP_TOOLS;
}
