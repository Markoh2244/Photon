const API = "https://api.neutron.health/graphql";
const CLINICAL = "https://clinical-api.neutron.health/graphql";

export class PhotonError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function token() {
  const value = process.env.PHOTON_ACCESS_TOKEN;
  if (!value) {
    throw new PhotonError("Missing PHOTON_ACCESS_TOKEN in .env.local");
  }
  return value;
}

async function graphql<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token()}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new PhotonError(json.errors.map((error) => error.message).join("; "), json.errors);
  }

  if (!json.data) {
    throw new PhotonError("Photon returned an empty response");
  }

  return json.data;
}

export function photonApi<T>(query: string, variables?: Record<string, unknown>) {
  return graphql<T>(API, query, variables);
}

export function photonClinical<T>(query: string, variables?: Record<string, unknown>) {
  return graphql<T>(CLINICAL, query, variables, {
    "x-photon-auth-token": token(),
    "x-photon-auth-token-type": "auth0",
  });
}

export type PhotonPatient = {
  id: string;
  name: { full: string; first?: string; last?: string };
  dateOfBirth?: string | null;
  sex?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: {
    street1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  } | null;
  allergies?: { allergen?: { name?: string | null } | null }[] | null;
  prescriptions?: PhotonPrescription[];
  orders?: PhotonOrder[];
  preferredPharmacies?: PhotonPharmacy[] | null;
  benefits?: PhotonBenefit[] | null;
};

export type PhotonBenefit = {
  id: string;
  bin: string;
  memberId: string;
  pcn?: string | null;
  groupId?: string | null;
  type?: string | null;
};

export type PhotonPrescription = {
  id: string;
  state: string;
  instructions?: string | null;
  daysSupply?: number | null;
  dispenseQuantity?: number | null;
  dispenseUnit?: string | null;
  writtenAt?: string | null;
  treatment?: { id: string; name: string } | null;
};

export type PhotonPharmacy = {
  id: string;
  name: string;
  phone?: string | null;
  fulfillmentTypes?: string[] | null;
  address?: {
    street1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  } | null;
};

export type PhotonFill = {
  id: string;
  state: string;
  treatment?: { id?: string; name?: string } | null;
  prescription?: {
    id: string;
    instructions?: string | null;
    treatment?: { id: string; name: string } | null;
  } | null;
};

export type PhotonOrder = {
  id: string;
  state: string;
  createdAt?: string | null;
  pharmacy?: PhotonPharmacy | null;
  fills?: PhotonFill[] | null;
  exceptions?: { exceptionType?: string; message?: string }[] | null;
};

export type TreatmentHit = { id: string; name: string };

export type ScreenAlert = {
  description: string;
  severity?: string | null;
  type?: string | null;
  involvedEntities?: { id?: string; name?: string }[] | null;
};

const PATIENT_FIELDS = `
  id
  name { full first last }
  dateOfBirth
  sex
  phone
  email
  address { street1 city state postalCode }
  allergies { allergen { name } }
  preferredPharmacies {
    id
    name
    phone
    address { street1 city state postalCode }
  }
  prescriptions {
    id
    state
    instructions
    daysSupply
    dispenseQuantity
    dispenseUnit
    writtenAt
    treatment { id name }
  }
  orders {
    id
    state
    createdAt
    pharmacy { id name phone address { street1 city state postalCode } }
    fills {
      id
      state
      treatment { name }
      prescription {
        id
        instructions
        treatment { id name }
      }
    }
  }
`;

function patientActivity(patient: PhotonPatient) {
  return (patient.prescriptions?.length || 0) + (patient.orders?.length || 0);
}

function isArchivedPatient(patient: PhotonPatient) {
  const last = patient.name?.last?.toLowerCase() || "";
  const first = patient.name?.first?.toLowerCase() || "";
  return last.startsWith("archive") || first.startsWith("archive");
}

/** Dedupe by name + DOB + phone. Prefer the record with activity, then the oldest id. */
export function dedupePatients(patients: PhotonPatient[]) {
  const visible = patients.filter((patient) => !isArchivedPatient(patient));
  const byKey = new Map<string, PhotonPatient>();
  for (const patient of visible) {
    const key = [
      patient.name?.full?.toLowerCase().trim(),
      patient.dateOfBirth || "",
      patient.phone || "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, patient);
      continue;
    }
    const existingScore = patientActivity(existing);
    const nextScore = patientActivity(patient);
    if (nextScore > existingScore || (nextScore === existingScore && patient.id < existing.id)) {
      byKey.set(key, patient);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.full.localeCompare(b.name.full));
}

export async function listPatients() {
  const data = await photonApi<{ patients: PhotonPatient[] }>(
    `query { patients { ${PATIENT_FIELDS} } }`,
  );
  const patients = dedupePatients(data.patients || []);
  return Promise.all(patients.map((patient) => attachBenefits(patient)));
}

export async function getPatient(id: string) {
  const data = await photonApi<{ patient: PhotonPatient }>(
    `query Patient($id: ID!) { patient(id: $id) { ${PATIENT_FIELDS} } }`,
    { id },
  );
  return attachBenefits(data.patient);
}

async function attachBenefits(patient: PhotonPatient): Promise<PhotonPatient> {
  try {
    const benefits = await listPatientBenefits(patient.id);
    return { ...patient, benefits };
  } catch {
    return { ...patient, benefits: patient.benefits || [] };
  }
}

export async function listPatientBenefits(patientId: string): Promise<PhotonBenefit[]> {
  const data = await photonClinical<{ patient: { benefits: PhotonBenefit[] | null } }>(
    `query PatientBenefits($id: ID!) {
      patient(id: $id) {
        benefits { id bin memberId pcn groupId type }
      }
    }`,
    { id: patientId },
  );
  return data.patient?.benefits || [];
}

/** Sandbox fixtures from https://docs.photon.health/reference/patient-benefits-test-data */
export const SANDBOX_BENEFITS = {
  covered: {
    label: "Covered (any medication)",
    bin: "610014",
    // Docs show "", but the live API rejects empty member IDs.
    memberId: "TESTMEMBER",
    pcn: null as string | null,
    groupId: null as string | null,
  },
  paRequired: {
    label: "PA required (Victoza fixture)",
    bin: "020321",
    memberId: "PCMSMEM001",
    pcn: null as string | null,
    groupId: null as string | null,
  },
} as const;

export type SandboxBenefitKey = keyof typeof SANDBOX_BENEFITS;

export async function createBenefit(input: {
  patientId: string;
  bin: string;
  memberId: string;
  pcn?: string | null;
  groupId?: string | null;
}) {
  const data = await photonClinical<{ createBenefit: PhotonBenefit }>(
    `mutation CreateBenefit($input: BenefitInput!) {
      createBenefit(input: $input) {
        id
        bin
        memberId
        pcn
        groupId
        type
      }
    }`,
    {
      input: {
        patientId: input.patientId,
        bin: input.bin,
        memberId: input.memberId,
        pcn: input.pcn ?? null,
        groupId: input.groupId ?? null,
      },
    },
  );
  return data.createBenefit;
}

export async function ensurePatientBenefit(
  patientId: string,
  fixture: SandboxBenefitKey = "covered",
) {
  const existing = await listPatientBenefits(patientId);
  if (existing.length > 0) return { benefit: existing[0], created: false };
  const template = SANDBOX_BENEFITS[fixture];
  const benefit = await createBenefit({
    patientId,
    bin: template.bin,
    // Covered fixture allows ""; PA fixture needs the PCMS member id.
    memberId: template.memberId,
    pcn: template.pcn,
    groupId: template.groupId,
  });
  return { benefit, created: true };
}

export async function setPreferredPharmacies(patientId: string, pharmacyIds: string[]) {
  const data = await photonApi<{
    updatePatient: { id: string; preferredPharmacies?: PhotonPharmacy[] | null };
  }>(
    `mutation SetPreferred($id: ID!, $pharmacies: [ID]) {
      updatePatient(id: $id, preferredPharmacies: $pharmacies) {
        id
        preferredPharmacies { id name address { street1 city state } }
      }
    }`,
    { id: patientId, pharmacies: pharmacyIds },
  );
  return data.updatePatient;
}

export async function createPatient(input: {
  first: string;
  last: string;
  dateOfBirth: string;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  phone?: string;
  email?: string;
  address?: {
    street1: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
}) {
  const data = await photonApi<{ createPatient: { id: string } }>(
    `mutation CreatePatient(
      $name: NameInput!
      $dateOfBirth: AWSDate!
      $sex: SexType!
      $phone: AWSPhone
      $email: AWSEmail
      $address: AddressInput
    ) {
      createPatient(
        name: $name
        dateOfBirth: $dateOfBirth
        sex: $sex
        phone: $phone
        email: $email
        address: $address
      ) { id }
    }`,
    {
      name: { first: input.first, last: input.last },
      dateOfBirth: input.dateOfBirth,
      sex: input.sex,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address
        ? { ...input.address, country: input.address.country || "US" }
        : null,
    },
  );
  return getPatient(data.createPatient.id);
}

export async function updatePatient(input: {
  id: string;
  first?: string;
  last?: string;
  dateOfBirth?: string;
  sex?: "MALE" | "FEMALE" | "UNKNOWN";
  phone?: string;
  email?: string;
}) {
  const data = await photonApi<{ updatePatient: { id: string } }>(
    `mutation UpdatePatient(
      $id: ID!
      $name: NameInput
      $dateOfBirth: AWSDate
      $sex: SexType
      $phone: AWSPhone
      $email: AWSEmail
    ) {
      updatePatient(
        id: $id
        name: $name
        dateOfBirth: $dateOfBirth
        sex: $sex
        phone: $phone
        email: $email
      ) { id }
    }`,
    {
      id: input.id,
      name:
        input.first || input.last
          ? { first: input.first || undefined, last: input.last || undefined }
          : null,
      dateOfBirth: input.dateOfBirth || null,
      sex: input.sex || null,
      phone: input.phone || null,
      email: input.email || null,
    },
  );
  return getPatient(data.updatePatient.id);
}

export async function searchTreatments(term: string): Promise<TreatmentHit[]> {
  const data = await photonClinical<{ treatments: TreatmentHit[] }>(
    `query Treatments($filter: TreatmentFilter!) {
      treatments(filter: $filter) { id name }
    }`,
    { filter: { term } },
  );
  return data.treatments || [];
}

export async function prescriptionScreen(
  patientId: string,
  treatmentIds: string[],
): Promise<ScreenAlert[]> {
  if (!treatmentIds.length) return [];
  const data = await photonClinical<{
    prescriptionScreen: { alerts: ScreenAlert[] };
  }>(
    `query Screen($draftedPrescriptions: [DraftedPrescriptionInput!]!, $patientId: ID!) {
      prescriptionScreen(draftedPrescriptions: $draftedPrescriptions, patientId: $patientId) {
        alerts {
          description
          severity
          type
          involvedEntities {
            ... on PrescriptionScreeningAlertInvolvedAllergen { id name }
            ... on PrescriptionScreeningAlertInvolvedDraftedPrescription { id name }
            ... on PrescriptionScreeningAlertInvolvedExistingPrescription { id name }
          }
        }
      }
    }`,
    {
      patientId,
      draftedPrescriptions: treatmentIds.map((treatmentId) => ({
        treatment: { id: treatmentId },
      })),
    },
  );
  return data.prescriptionScreen?.alerts || [];
}

export async function searchPharmacies(input: {
  latitude: number;
  longitude: number;
  radius?: number;
  type?: "PICK_UP" | "MAIL_ORDER";
}): Promise<PhotonPharmacy[]> {
  const data = await photonApi<{ pharmacies: PhotonPharmacy[] }>(
    `query Pharmacies($location: LatLongSearch!, $type: FulfillmentType) {
      pharmacies(location: $location, type: $type) {
        id
        name
        phone
        fulfillmentTypes
        address { street1 city state postalCode }
      }
    }`,
    {
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        radius: input.radius ?? 8,
      },
      type: input.type || "PICK_UP",
    },
  );
  return data.pharmacies || [];
}

export async function routeOrder(orderId: string, pharmacyId: string) {
  const data = await photonApi<{
    routeOrder: { id: string; state: string; pharmacy?: PhotonPharmacy | null };
  }>(
    `mutation RouteOrder($id: ID!, $pharmacyId: ID!) {
      routeOrder(id: $id, pharmacyId: $pharmacyId) {
        id
        state
        pharmacy { id name address { street1 city state } }
      }
    }`,
    { id: orderId, pharmacyId },
  );
  return data.routeOrder;
}

export type CreateRxInput = {
  patientId: string;
  treatmentId: string;
  dispenseQuantity: number;
  dispenseUnit: string;
  fillsAllowed: number;
  daysSupply: number;
  instructions: string;
  notes?: string;
};

export async function createPrescription(input: CreateRxInput) {
  const data = await photonApi<{
    createPrescription: {
      id: string;
      state: string;
      treatment?: { id: string; name: string } | null;
    };
  }>(
    `mutation CreateRx(
      $patientId: ID!
      $treatmentId: ID!
      $dispenseQuantity: Float!
      $dispenseUnit: String!
      $fillsAllowed: Int!
      $daysSupply: Int
      $instructions: String!
      $notes: String
    ) {
      createPrescription(
        patientId: $patientId
        treatmentId: $treatmentId
        dispenseQuantity: $dispenseQuantity
        dispenseUnit: $dispenseUnit
        fillsAllowed: $fillsAllowed
        daysSupply: $daysSupply
        instructions: $instructions
        notes: $notes
      ) {
        id
        state
        treatment { id name }
      }
    }`,
    {
      patientId: input.patientId,
      treatmentId: input.treatmentId,
      dispenseQuantity: input.dispenseQuantity,
      dispenseUnit: input.dispenseUnit,
      fillsAllowed: input.fillsAllowed,
      daysSupply: input.daysSupply,
      instructions: input.instructions,
      notes: input.notes || null,
    },
  );
  return data.createPrescription;
}

export async function createOrder(input: {
  patientId: string;
  prescriptionIds: string[];
  address: {
    street1: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  pharmacyId?: string | null;
}) {
  const data = await photonApi<{
    createOrder: {
      id: string;
      state: string;
      pharmacy?: PhotonPharmacy | null;
      fills?: { id: string; prescription?: { id: string; treatment?: { name: string } | null } | null }[];
    };
  }>(
    `mutation CreateOrder(
      $patientId: ID!
      $fills: [FillInput!]!
      $address: AddressInput!
      $pharmacyId: ID
    ) {
      createOrder(
        patientId: $patientId
        fills: $fills
        address: $address
        pharmacyId: $pharmacyId
      ) {
        id
        state
        pharmacy { id name }
        fills {
          id
          prescription { id treatment { name } }
        }
      }
    }`,
    {
      patientId: input.patientId,
      fills: input.prescriptionIds.map((prescriptionId) => ({ prescriptionId })),
      address: { ...input.address, country: input.address.country || "US" },
      pharmacyId: input.pharmacyId || null,
    },
  );
  return data.createOrder;
}

export type CoverageOption = {
  id: string;
  status: string;
  statusMessage: string;
  price: number | null;
  paRequired: boolean;
  isAlternative: boolean;
  treatment?: { name: string } | null;
  pharmacy?: { id: string; name: string } | null;
};

/** Real-time benefit check for one pharmacy + one or more prescription ids. */
export async function generateCoverageOptions(
  pharmacyId: string,
  prescriptionIds: string[],
): Promise<CoverageOption[]> {
  if (!prescriptionIds.length) return [];
  const data = await photonClinical<{ generateCoverageOptions: CoverageOption[] }>(
    `mutation Coverage($pharmacyId: ID!, $prescriptions: [CoverageRxInput!]!) {
      generateCoverageOptions(pharmacyId: $pharmacyId, prescriptions: $prescriptions) {
        id
        status
        statusMessage
        price
        paRequired
        isAlternative
        treatment { name }
        pharmacy { id name }
      }
    }`,
    {
      pharmacyId,
      prescriptions: prescriptionIds.map((id) => ({ id })),
    },
  );
  return data.generateCoverageOptions || [];
}

/**
 * Compare patient-pay across nearby pharmacies for the prescriptions on an open order.
 * Returns one row per pharmacy with the primary (non-alternative) coverage when available.
 */
export async function comparePharmacyCoverage(
  pharmacyIds: string[],
  prescriptionIds: string[],
) {
  const rows = await Promise.all(
    pharmacyIds.map(async (pharmacyId) => {
      try {
        const options = await generateCoverageOptions(pharmacyId, prescriptionIds);
        const primary =
          options.find((option) => !option.isAlternative) || options[0] || null;
        return { pharmacyId, options, primary, error: null as string | null };
      } catch (error) {
        return {
          pharmacyId,
          options: [] as CoverageOption[],
          primary: null,
          error: error instanceof Error ? error.message : "Coverage check failed",
        };
      }
    }),
  );
  return rows;
}

export async function getCatalogSummary() {
  const data = await photonApi<{
    catalogs: { id: string; name: string; treatments: { id: string }[] }[];
  }>(`query { catalogs { id name treatments { id } } }`);
  return data.catalogs;
}
