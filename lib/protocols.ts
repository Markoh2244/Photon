export type DraftPrescription = {
  key: string;
  treatmentId: string;
  treatmentName: string;
  searchTerm: string;
  dispenseQuantity: number;
  dispenseUnit: string;
  fillsAllowed: number;
  daysSupply: number;
  instructions: string;
  notes?: string;
  role: "first-line" | "add-on" | "alternative";
  why: string;
  selected: boolean;
};

export type AssistantQuestion = {
  id: string;
  prompt: string;
  why: string;
};

export type AssistantHold = {
  title: string;
  detail: string;
};

export type DraftPlan = {
  protocolId: string;
  title: string;
  assessment: string;
  icd10?: { code: string; name: string };
  questions: AssistantQuestion[];
  holds: AssistantHold[];
  drafts: DraftPrescription[];
  counseling: string[];
  fulfillmentHint: "mail" | "pickup" | "patient-choice";
};

type Protocol = {
  id: string;
  title: string;
  icd10: { code: string; name: string };
  keywords: string[];
  assessment: (ctx: NoteContext) => string;
  questions: (ctx: NoteContext) => AssistantQuestion[];
  holds: (ctx: NoteContext) => AssistantHold[];
  proposals: (ctx: NoteContext) => Proposal[];
  counseling: string[];
};

type Proposal = {
  key: string;
  search: string;
  preferIncludes?: string[];
  avoidIncludes?: string[];
  dispenseQuantity: number;
  dispenseUnit: string;
  fillsAllowed: number;
  daysSupply: number;
  instructions: string;
  notes?: string;
  role: DraftPrescription["role"];
  why: string;
  skipIf?: (ctx: NoteContext) => boolean;
};

export type NoteContext = {
  note: string;
  pregnancyRisk: boolean;
  wantsMail: boolean;
  failedBp: boolean;
  failedTopical: boolean;
  nodular: boolean;
  asksIsotretinoin: boolean;
  pediatric: boolean;
};

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function parseNote(note: string): NoteContext {
  const text = note.toLowerCase();
  return {
    note,
    pregnancyRisk:
      includesAny(text, ["pregnan", "trying to conceive", "ttc", "breastfeed"]) &&
      !includesAny(text, ["not pregnant", "pregnancy test negative", "urine hcg negative"]),
    wantsMail: includesAny(text, ["mail", "delivery", "amazon", "cost plus", "ship"]),
    failedBp: includesAny(text, ["benzoyl", "bp wash", "otc bp"]),
    failedTopical: includesAny(text, ["failed topical", "failed otc", "not helping", "no improvement"]),
    nodular: includesAny(text, ["nodular", "cystic", "scarring"]),
    asksIsotretinoin: includesAny(text, ["accutane", "isotretinoin", "claravis", "absorica"]),
    pediatric: includesAny(text, ["year old", "yo ", "pediatric", "child", "teen"]),
  };
}

const PROTOCOLS: Protocol[] = [
  {
    id: "acne-inflammatory",
    title: "Inflammatory acne",
    icd10: { code: "L70.0", name: "Acne vulgaris" },
    keywords: ["acne", "pimple", "breakout", "comedone"],
    assessment: (ctx) =>
      ctx.nodular
        ? "Visit note suggests nodular/cystic acne. Start a conventional combination while keeping isotretinoin as a clinician-led decision."
        : "Visit note maps to inflammatory acne. Propose a topical retinoid + benzoyl peroxide backbone, adding an oral only if topicals already failed.",
    questions: (ctx) => {
      const questions: AssistantQuestion[] = [];
      if (!includesAny(ctx.note.toLowerCase(), ["pregnan", "hcg", "conceive"])) {
        questions.push({
          id: "pregnancy",
          prompt: "Is pregnancy reliably excluded if an oral tetracycline or topical retinoid is used?",
          why: "Doxycycline and retinoids should not be started when pregnancy is possible without an explicit clinician decision.",
        });
      }
      return questions;
    },
    holds: (ctx) => {
      const holds: AssistantHold[] = [];
      if (ctx.asksIsotretinoin || ctx.nodular) {
        holds.push({
          title: "Isotretinoin stays with the clinician",
          detail:
            "DermClose will not draft isotretinoin. iPLEDGE, labs, and counseling need a named prescriber. Use Photon after that decision is made.",
        });
      }
      if (ctx.pregnancyRisk) {
        holds.push({
          title: "Pregnancy risk in the note",
          detail: "Oral doxycycline was omitted. Confirm a pregnancy-safe plan before signing.",
        });
      }
      return holds;
    },
    proposals: (ctx) => [
      {
        key: "adapalene-bp",
        search: "Adapalene-Benzoyl Peroxide Topical Gel 0.1-2.5",
        preferIncludes: ["0.1-2.5", "Gel"],
        avoidIncludes: ["Pad"],
        dispenseQuantity: 45,
        dispenseUnit: "Gram",
        fillsAllowed: 6,
        daysSupply: 30,
        instructions: "Apply a thin layer to affected areas of the face once daily at night.",
        role: "first-line",
        why: "Fixed-dose adapalene/BPO is a first-line combination and avoids a second copay when the patient already failed OTC BPO alone.",
      },
      {
        key: "doxycycline",
        search: "Doxycycline Hyclate Oral Capsule 100 MG",
        preferIncludes: ["Oral Capsule 100"],
        avoidIncludes: ["Intravenous", "Delayed"],
        dispenseQuantity: 60,
        dispenseUnit: "Capsule",
        fillsAllowed: 1,
        daysSupply: 30,
        instructions: "Take 1 capsule by mouth twice daily with a full glass of water. Do not lie down for 30 minutes.",
        notes: "Limit duration. Reassess at 8-12 weeks. Sun protection.",
        role: "add-on",
        why: "Short course oral tetracycline for inflammatory disease after topical failure — not a chronic maintenance drug.",
        skipIf: (context) => context.pregnancyRisk || !context.failedTopical,
      },
    ],
    counseling: [
      "Expect 8–12 weeks before judging response.",
      "Apply retinoid to dry skin; hold if peeling is severe.",
      "Doxycycline is time-limited if used.",
    ],
  },
  {
    id: "rosacea",
    title: "Papulopustular rosacea",
    icd10: { code: "L71.9", name: "Rosacea, unspecified" },
    keywords: ["rosacea", "flushing", "papulopustular"],
    assessment: () =>
      "Note suggests rosacea. Prefer metronidazole or similar topical anti-inflammatory therapy before oral tetracyclines.",
    questions: () => [],
    holds: () => [],
    proposals: () => [
      {
        key: "metro",
        search: "Metronidazole Topical Gel 0.75 %",
        preferIncludes: ["Topical Gel 0.75"],
        dispenseQuantity: 45,
        dispenseUnit: "Gram",
        fillsAllowed: 5,
        daysSupply: 30,
        instructions: "Apply a thin layer to affected areas of the face twice daily.",
        role: "first-line",
        why: "Topical metronidazole is a common first-line option for papulopustular rosacea and is usually well tolerated.",
      },
    ],
    counseling: ["Trigger avoidance (heat, alcohol, spicy food) matters as much as the prescription."],
  },
  {
    id: "eczema",
    title: "Atopic / eczematous dermatitis",
    icd10: { code: "L20.9", name: "Atopic dermatitis, unspecified" },
    keywords: ["eczema", "atopic", "dermatitis", "itch"],
    assessment: () =>
      "Note maps to eczematous dermatitis. Draft a medium-potency steroid for flares plus counseling on bland emollients — do not auto-escalate to oral steroids.",
    questions: () => [
      {
        id: "location",
        prompt: "Is this face/skin-fold disease? If yes, drop potency before signing.",
        why: "Body-site changes which steroid belongs on the script.",
      },
    ],
    holds: () => [
      {
        title: "No oral steroid auto-draft",
        detail: "Systemic steroids for dermatitis stay a human decision because rebound and infection risk are easy to miss in a short note.",
      },
    ],
    proposals: () => [
      {
        key: "tac",
        search: "Triamcinolone Acetonide Topical Cream 0.1 %",
        preferIncludes: ["Topical Cream 0.1"],
        avoidIncludes: ["0.5", "0.025", "Ointment"],
        dispenseQuantity: 80,
        dispenseUnit: "Gram",
        fillsAllowed: 2,
        daysSupply: 14,
        instructions:
          "Apply a thin layer to affected body areas twice daily for up to 14 days. Do not use on the face or groin unless instructed.",
        role: "first-line",
        why: "Triamcinolone 0.1% is a familiar medium-potency choice for body flares in clinic protocols.",
      },
    ],
    counseling: ["Moisturize immediately after bathing.", "Stop topical steroid when the flare clears."],
  },
];

export function matchProtocol(ctx: NoteContext): Protocol | null {
  const text = ctx.note.toLowerCase();
  return (
    PROTOCOLS.find((protocol) => protocol.keywords.some((keyword) => text.includes(keyword))) || null
  );
}

function pickTreatment(
  hits: { id: string; name: string }[],
  proposal: Proposal,
) {
  const ranked = hits.filter((hit) => {
    const name = hit.name.toLowerCase();
    if (proposal.avoidIncludes?.some((part) => name.includes(part.toLowerCase()))) return false;
    return true;
  });
  const preferred = ranked.find((hit) =>
    proposal.preferIncludes?.every((part) => hit.name.toLowerCase().includes(part.toLowerCase())),
  );
  return preferred || ranked[0] || hits[0];
}

export async function buildPlan(
  ctx: NoteContext,
  search: (term: string) => Promise<{ id: string; name: string }[]>,
): Promise<DraftPlan> {
  const protocol = matchProtocol(ctx);
  if (!protocol) {
    return {
      protocolId: "unmatched",
      title: "Needs clinician direction",
      assessment:
        "The note does not match the clinic’s acne, rosacea, or eczema protocols. Ask a clarifying question instead of guessing a medication.",
      questions: [
        {
          id: "diagnosis",
          prompt: "What diagnosis are you treating today?",
          why: "DermClose only drafts from a small, reviewed protocol set.",
        },
      ],
      holds: [
        {
          title: "No medication drafted",
          detail: "Refusing to invent a regimen is the safety feature.",
        },
      ],
      drafts: [],
      counseling: [],
      fulfillmentHint: ctx.wantsMail ? "mail" : "patient-choice",
    };
  }

  const drafts: DraftPrescription[] = [];
  for (const proposal of protocol.proposals(ctx)) {
    if (proposal.skipIf?.(ctx)) continue;
    const hits = await search(proposal.search);
    const treatment = pickTreatment(hits, proposal);
    if (!treatment) continue;
    drafts.push({
      key: proposal.key,
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      searchTerm: proposal.search,
      dispenseQuantity: proposal.dispenseQuantity,
      dispenseUnit: proposal.dispenseUnit,
      fillsAllowed: proposal.fillsAllowed,
      daysSupply: proposal.daysSupply,
      instructions: proposal.instructions,
      notes: proposal.notes,
      role: proposal.role,
      why: proposal.why,
      selected: proposal.role === "first-line" || proposal.role === "add-on",
    });
  }

  return {
    protocolId: protocol.id,
    title: protocol.title,
    assessment: protocol.assessment(ctx),
    icd10: protocol.icd10,
    questions: protocol.questions(ctx),
    holds: protocol.holds(ctx),
    drafts,
    counseling: protocol.counseling,
    fulfillmentHint: ctx.wantsMail ? "mail" : "patient-choice",
  };
}

export const SAMPLE_NOTES = [
  {
    label: "Moderate acne, failed OTC BPO",
    text: "24F follow-up for moderate inflammatory facial acne. Failed OTC benzoyl peroxide wash for 3 months. Not pregnant, urine hCG negative today. Interested in something that can be mailed if cheaper. No nodular lesions. Discussed sunscreen.",
  },
  {
    label: "Cystic acne asking Accutane",
    text: "19M with scarring nodular acne. Asking about Accutane. Previous topicals not helping. No depression history documented in this note.",
  },
  {
    label: "Body eczema flare",
    text: "41F with atopic dermatitis flare on arms and trunk. Itch waking her at night. No facial involvement mentioned. Wants local pickup today.",
  },
];
