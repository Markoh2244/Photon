import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Photon owns clinical state. These three features are patient-generated and
// clinic-local, so they live in a JSON file for the demo instead of Neutron.
const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "community.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

export const REVIEW_TAGS = [
  "Explained my medication",
  "Short wait",
  "Called my clinic",
  "Found me a lower price",
  "Bilingual staff",
  "Long wait",
  "Was out of stock",
] as const;

export type PharmacyReview = {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacistName: string | null;
  rating: number;
  tags: string[];
  comment: string;
  authorLabel: string;
  createdAt: string;
  demo?: boolean;
};

export type PreferredPharmacy = {
  patientId: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyAddress: string | null;
  reason: string;
  clinician: string;
  createdAt: string;
};

export type MedPhoto = {
  id: string;
  patientId: string;
  label: string;
  note: string;
  redactionCount: number;
  mimeType: string;
  createdAt: string;
};

type Database = {
  reviews: PharmacyReview[];
  preferred: PreferredPharmacy[];
  photos: MedPhoto[];
};

const EMPTY: Database = { reviews: [], preferred: [], photos: [] };

async function read(): Promise<Database> {
  try {
    const raw = await readFile(DB_FILE, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Database>) };
  } catch {
    return { ...EMPTY };
  }
}

async function write(db: Database) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

/**
 * Sandbox pharmacy IDs are assigned by Photon, so a static seed file would
 * never match. Instead every pharmacy gets a stable set of fake reviews derived
 * from its ID, and they stay flagged as demo data in the UI.
 */
const DEMO_REVIEWS = [
  {
    pharmacist: "Priya N., PharmD",
    rating: 5,
    tags: ["Explained my medication", "Called my clinic"],
    comment:
      "She walked me through how to layer the retinoid so I would not peel, then called the clinic when my insurance rejected the first quantity.",
    author: "Verified fill · 3 weeks ago",
  },
  {
    pharmacist: "Marcus D., RPh",
    rating: 4,
    tags: ["Short wait", "Found me a lower price"],
    comment: "In and out in ten minutes. He flagged a cash coupon that beat my copay.",
    author: "Verified fill · last month",
  },
  {
    pharmacist: null,
    rating: 3,
    tags: ["Long wait", "Was out of stock"],
    comment:
      "Staff were kind but the gel was backordered and nobody told me until I showed up the second time.",
    author: "Verified fill · 2 months ago",
  },
  {
    pharmacist: "Ana R., PharmD",
    rating: 5,
    tags: ["Bilingual staff", "Explained my medication"],
    comment: "Explained everything to my mom in Spanish. That mattered more than the price.",
    author: "Verified fill · 6 weeks ago",
  },
];

function hash(value: string) {
  let total = 0;
  for (const char of value) total = (total * 31 + char.charCodeAt(0)) % 100003;
  return total;
}

function demoReviewsFor(pharmacyId: string, pharmacyName: string): PharmacyReview[] {
  const seed = hash(pharmacyId);
  const count = 2 + (seed % 3);
  return Array.from({ length: count }, (_, index) => {
    const template = DEMO_REVIEWS[(seed + index * 3) % DEMO_REVIEWS.length];
    return {
      id: `demo-${pharmacyId}-${index}`,
      pharmacyId,
      pharmacyName,
      pharmacistName: template.pharmacist,
      rating: template.rating,
      tags: [...template.tags],
      comment: template.comment,
      authorLabel: template.author,
      createdAt: new Date(Date.UTC(2026, 6, 1 + ((seed + index) % 27))).toISOString(),
      demo: true,
    };
  });
}

export type ReviewSummary = {
  pharmacyId: string;
  average: number;
  count: number;
  topTags: string[];
  reviews: PharmacyReview[];
};

export async function getReviewSummary(
  pharmacies: { id: string; name: string }[],
): Promise<Record<string, ReviewSummary>> {
  const db = await read();
  const summary: Record<string, ReviewSummary> = {};

  for (const pharmacy of pharmacies) {
    const stored = db.reviews.filter((review) => review.pharmacyId === pharmacy.id);
    const reviews = [...stored, ...demoReviewsFor(pharmacy.id, pharmacy.name)].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const counts = new Map<string, number>();
    for (const review of reviews) {
      for (const tag of review.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    summary[pharmacy.id] = {
      pharmacyId: pharmacy.id,
      average: reviews.reduce((total, review) => total + review.rating, 0) / reviews.length,
      count: reviews.length,
      topTags: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tag]) => tag),
      reviews,
    };
  }

  return summary;
}

export async function addReview(input: {
  pharmacyId: string;
  pharmacyName: string;
  pharmacistName?: string | null;
  rating: number;
  tags?: string[];
  comment: string;
  authorLabel?: string;
}): Promise<PharmacyReview> {
  const db = await read();
  const review: PharmacyReview = {
    id: randomUUID(),
    pharmacyId: input.pharmacyId,
    pharmacyName: input.pharmacyName,
    pharmacistName: input.pharmacistName?.trim() || null,
    rating: Math.min(5, Math.max(1, Math.round(input.rating))),
    tags: (input.tags || []).filter((tag) => REVIEW_TAGS.includes(tag as never)),
    comment: input.comment.trim().slice(0, 800),
    authorLabel: input.authorLabel || "You · just now",
    createdAt: new Date().toISOString(),
  };
  db.reviews.unshift(review);
  await write(db);
  return review;
}

export async function getPreferredPharmacy(patientId: string) {
  const db = await read();
  return db.preferred.find((entry) => entry.patientId === patientId) || null;
}

export async function setPreferredPharmacy(input: {
  patientId: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyAddress?: string | null;
  reason: string;
  clinician: string;
}): Promise<PreferredPharmacy> {
  const db = await read();
  const entry: PreferredPharmacy = {
    patientId: input.patientId,
    pharmacyId: input.pharmacyId,
    pharmacyName: input.pharmacyName,
    pharmacyAddress: input.pharmacyAddress || null,
    reason: input.reason.trim().slice(0, 600),
    clinician: input.clinician,
    createdAt: new Date().toISOString(),
  };
  db.preferred = [entry, ...db.preferred.filter((item) => item.patientId !== input.patientId)];
  await write(db);
  return entry;
}

export async function clearPreferredPharmacy(patientId: string) {
  const db = await read();
  db.preferred = db.preferred.filter((entry) => entry.patientId !== patientId);
  await write(db);
}

export async function listMedPhotos(patientId: string) {
  const db = await read();
  return db.photos
    .filter((photo) => photo.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addMedPhoto(input: {
  patientId: string;
  label: string;
  note?: string;
  redactionCount: number;
  dataUrl: string;
}): Promise<MedPhoto> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!match) throw new Error("Expected a base64 PNG, JPEG, or WebP data URL");

  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > 6_000_000) throw new Error("Image is larger than 6 MB after flattening");

  const photo: MedPhoto = {
    id: randomUUID(),
    patientId: input.patientId,
    label: input.label.trim().slice(0, 120) || "Medication photo",
    note: (input.note || "").trim().slice(0, 400),
    redactionCount: input.redactionCount,
    mimeType,
    createdAt: new Date().toISOString(),
  };

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, photo.id), bytes);

  const db = await read();
  db.photos.unshift(photo);
  await write(db);
  return photo;
}

export async function readMedPhotoFile(id: string) {
  const db = await read();
  const photo = db.photos.find((item) => item.id === id);
  if (!photo) return null;
  const bytes = await readFile(path.join(UPLOAD_DIR, photo.id));
  return { photo, bytes };
}

export async function deleteMedPhoto(id: string) {
  const db = await read();
  db.photos = db.photos.filter((photo) => photo.id !== id);
  await write(db);
}
