import { NextResponse } from "next/server";
import {
  PhotonError,
  createOrder,
  createPrescription,
  listPatients,
  searchTreatments,
} from "@/lib/photon";

type DemoRx = {
  search: string;
  preferIncludes?: string[];
  dispenseQuantity: number;
  dispenseUnit: string;
  fillsAllowed: number;
  daysSupply: number;
  instructions: string;
};

const DEFAULT_ADDRESS = {
  street1: "200 Park Ave S",
  city: "New York",
  state: "NY",
  postalCode: "10003",
  country: "US",
};

/** One unfilled Rx per demo patient so the patient view has something to price-shop. */
const DEMO_SCRIPTS: Record<string, DemoRx> = {
  chen: {
    search: "Adapalene-Benzoyl Peroxide Topical Gel 0.1-2.5",
    preferIncludes: ["0.1-2.5", "Gel"],
    dispenseQuantity: 45,
    dispenseUnit: "Gram",
    fillsAllowed: 3,
    daysSupply: 30,
    instructions: "Apply a thin layer to affected areas of the face once daily at night.",
  },
  reyes: {
    search: "Triamcinolone Acetonide Topical Cream 0.1 %",
    preferIncludes: ["Topical Cream 0.1"],
    dispenseQuantity: 80,
    dispenseUnit: "Gram",
    fillsAllowed: 2,
    daysSupply: 14,
    instructions:
      "Apply a thin layer to affected body areas twice daily for up to 14 days. Do not use on the face or groin unless instructed.",
  },
  park: {
    search: "Metronidazole Topical Gel 0.75 %",
    preferIncludes: ["Topical Gel 0.75"],
    dispenseQuantity: 45,
    dispenseUnit: "Gram",
    fillsAllowed: 3,
    daysSupply: 30,
    instructions: "Apply a thin layer to affected areas of the face twice daily.",
  },
  hale: {
    search: "Doxycycline Hyclate Oral Capsule 100 MG",
    preferIncludes: ["Oral Capsule 100"],
    dispenseQuantity: 60,
    dispenseUnit: "Capsule",
    fillsAllowed: 1,
    daysSupply: 30,
    instructions:
      "Take 1 capsule by mouth twice daily with a full glass of water. Do not lie down for 30 minutes.",
  },
  doe: {
    search: "Amoxicillin Oral Tablet 500 MG",
    preferIncludes: ["Oral Tablet 500"],
    dispenseQuantity: 30,
    dispenseUnit: "Each",
    fillsAllowed: 1,
    daysSupply: 10,
    instructions: "Take 1 tablet by mouth three times daily until finished.",
  },
};

function pickTreatment(
  hits: { id: string; name: string }[],
  preferIncludes?: string[],
) {
  if (!hits.length) return null;
  if (!preferIncludes?.length) return hits[0];
  return (
    hits.find((hit) =>
      preferIncludes.every((part) => hit.name.toLowerCase().includes(part.toLowerCase())),
    ) || hits[0]
  );
}

function scriptFor(patientName: string): DemoRx {
  const last = patientName.split(" ").pop()?.toLowerCase() || "";
  return DEMO_SCRIPTS[last] || DEMO_SCRIPTS.chen;
}

/**
 * Creates ACTIVE prescriptions wrapped in ROUTING orders with no pharmacy,
 * so the patient view can compare Photon benefit prices across stores.
 */
export async function POST() {
  try {
    const patients = await listPatients();
    const results = [];

    for (const patient of patients) {
      const waiting = (patient.orders || []).filter(
        (order) => !order.pharmacy && ["ROUTING", "PENDING"].includes(order.state),
      );
      if (waiting.length > 0) {
        results.push({
          patientId: patient.id,
          name: patient.name.full,
          skipped: true,
          reason: "Already has an open unfilled order",
          orderId: waiting[0].id,
        });
        continue;
      }

      const script = scriptFor(patient.name.full);
      const hits = await searchTreatments(script.search);
      const treatment = pickTreatment(hits, script.preferIncludes);
      if (!treatment) {
        results.push({
          patientId: patient.id,
          name: patient.name.full,
          error: `No treatment found for ${script.search}`,
        });
        continue;
      }

      const prescription = await createPrescription({
        patientId: patient.id,
        treatmentId: treatment.id,
        dispenseQuantity: script.dispenseQuantity,
        dispenseUnit: script.dispenseUnit,
        fillsAllowed: script.fillsAllowed,
        daysSupply: script.daysSupply,
        instructions: script.instructions,
        notes: "Unfilled demo Rx for pharmacy price comparison",
      });

      const address = patient.address?.street1
        ? {
            street1: patient.address.street1,
            city: patient.address.city || DEFAULT_ADDRESS.city,
            state: patient.address.state || DEFAULT_ADDRESS.state,
            postalCode: patient.address.postalCode || DEFAULT_ADDRESS.postalCode,
            country: "US",
          }
        : DEFAULT_ADDRESS;

      // Omit pharmacyId so the order stays ROUTING for patient choice.
      const order = await createOrder({
        patientId: patient.id,
        prescriptionIds: [prescription.id],
        address,
      });

      results.push({
        patientId: patient.id,
        name: patient.name.full,
        treatment: treatment.name,
        prescriptionId: prescription.id,
        orderId: order.id,
        orderState: order.state,
      });
    }

    return NextResponse.json({ count: results.length, results });
  } catch (error) {
    const message =
      error instanceof PhotonError ? error.message : "Failed to seed unfilled prescriptions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
