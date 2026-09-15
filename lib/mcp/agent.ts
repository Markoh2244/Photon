/**
 * Clinician assistant that orchestrates Photon MCP tools.
 *
 * Without an LLM API key it runs a deterministic multi-tool workflow for the
 * main demo intents (lookup patient, check insurance, draft from note, search meds).
 * With OPENAI_API_KEY it can use free-form tool calling.
 */

import { callMcpTool, listMcpTools, type McpToolResult } from "@/lib/mcp/tools";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ToolTrace = {
  name: string;
  arguments: Record<string, unknown>;
  resultPreview: string;
  isError?: boolean;
  structured?: unknown;
};

export type AssistantReply = {
  reply: string;
  traces: ToolTrace[];
  drafts?: {
    patientId?: string;
    prescriptions: {
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
    }[];
  } | null;
  patientId?: string | null;
};

function preview(result: McpToolResult) {
  const text = result.content.map((c) => c.text).join("\n");
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

function isAuthFailure(result: McpToolResult) {
  const text = result.content.map((c) => c.text).join(" ").toLowerCase();
  return (
    result.isError === true &&
    (/unauthorized|jwt expired|invalid token|access denied|401/.test(text) ||
      /expired/.test(text))
  );
}

function authHelp(detail?: string) {
  return [
    "Photon rejected the API token (expired or invalid).",
    detail ? `Detail: ${detail}` : "",
    "",
    "Fix:",
    "1. Sign in at https://app.neutron.health",
    "2. Copy a fresh **user** access token",
    "3. Set `PHOTON_ACCESS_TOKEN` in `.env.local`",
    "4. Restart `npm run dev`",
    "",
    "Then ask me again — MCP tools will call Photon’s Clinical + Benefits APIs.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  traces: ToolTrace[],
): Promise<McpToolResult> {
  const result = await callMcpTool(name, args);
  traces.push({
    name,
    arguments: args,
    resultPreview: preview(result),
    isError: result.isError,
    structured: result.structured,
  });
  return result;
}

function lastUserMessage(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

function extractQuoted(text: string) {
  const match = text.match(/[“"]([^”"]+)[”"]/);
  return match?.[1]?.trim() || null;
}

function guessMedication(text: string) {
  const quoted = extractQuoted(text);
  if (quoted) return quoted;
  const stop = /^(for|with|and|the|a|an|to|on|in|of|from|patient|coverage|insurance)$/i;
  const patterns = [
    /(?:prescribe|prescribing|cover(?:age|ed)?(?:\s+for)?|check)\s+([A-Z][A-Za-z0-9-]{2,}(?:\s+[A-Za-z0-9%-]+)?)/i,
    /\b(Wegovy|Zepbound|Ozempic|Adapalene(?:-Benzoyl(?:\s+Peroxide)?)?|Doxycycline|Metronidazole|Triamcinolone|Amoxicillin|Isotretinoin|Accutane|Tretinoin|Clindamycin)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parts = match[1].trim().split(/\s+/).filter((part) => !stop.test(part));
    if (parts.length) return parts.join(" ");
  }
  return null;
}

function guessPatientQuery(text: string) {
  const byId = text.match(/\b(pat_[A-Z0-9]+)\b/i);
  if (byId?.[1]) return byId[1];
  const mention = text.match(
    /@([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)(?:\s*\([^)]*\))?/,
  );
  if (mention?.[1]) return mention[1];
  const forMatch = text.match(
    /\b(?:for|patient|pt\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  );
  if (forMatch?.[1]) return forMatch[1];
  const nameMatch = text.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  if (nameMatch?.[1] && !/Draft|Photon|Harbor|Moderate|Body/.test(nameMatch[1])) {
    return nameMatch[1];
  }
  return null;
}

function looksLikeVisitNote(text: string) {
  const lower = text.toLowerCase();
  return (
    text.length > 80 &&
    (lower.includes("acne") ||
      lower.includes("eczema") ||
      lower.includes("rosacea") ||
      lower.includes("follow-up") ||
      lower.includes("follow up") ||
      lower.includes("dermatitis"))
  );
}

type PatientHit = { id: string; name: string };

async function resolvePatient(
  text: string,
  preferredId: string | undefined,
  traces: ToolTrace[],
): Promise<PatientHit | null> {
  const embeddedId = text.match(/\b(pat_[A-Z0-9]+)\b/i)?.[1];
  const targetId = embeddedId || preferredId;
  if (targetId) {
    const got = await runTool("get_patient", { patient_id: targetId }, traces);
    if (!got.isError) {
      const structured = got.structured as { id?: string; name?: string } | undefined;
      if (structured?.id) return { id: structured.id, name: structured.name || targetId };
    }
  }

  const query = guessPatientQuery(text);
  if (query && /^pat_/i.test(query)) return null;

  const listed = await runTool(
    "list_patients",
    query && !/^pat_/i.test(query) ? { query } : {},
    traces,
  );
  const patients =
    ((listed.structured as { patients?: PatientHit[] } | undefined)?.patients as PatientHit[]) ||
    [];
  if (!patients.length) return null;
  if (query && !/^pat_/i.test(query)) {
    const exact = patients.find((p) => p.name.toLowerCase() === query.toLowerCase());
    if (exact) return exact;
    const partial = patients.find((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    if (partial) return partial;
  }
  return patients[0];
}

function draftsFromPlan(plan: {
  drafts?: {
    treatmentId: string;
    treatmentName: string;
    dispenseQuantity: number;
    dispenseUnit: string;
    fillsAllowed: number;
    daysSupply: number;
    instructions: string;
    notes?: string;
    selected?: boolean;
  }[];
}) {
  return (plan.drafts || [])
    .filter((d) => d.selected !== false)
    .map((d) => ({
      treatmentId: d.treatmentId,
      treatmentName: d.treatmentName,
      dispenseQuantity: d.dispenseQuantity,
      dispenseUnit: d.dispenseUnit,
      fillsAllowed: d.fillsAllowed,
      daysSupply: d.daysSupply,
      instructions: d.instructions,
      notes: d.notes,
    }));
}

async function runDeterministicAgent(
  messages: ChatMessage[],
  patientId?: string,
): Promise<AssistantReply> {
  const traces: ToolTrace[] = [];
  const text = lastUserMessage(messages).trim();
  if (!text) {
    return {
      reply: "Ask me about a patient, a medication’s coverage, or paste a visit note to draft a plan.",
      traces,
    };
  }

  const lower = text.toLowerCase();
  const wantsCoverage =
    /cover|insurance|benefit|copay|prior auth|pa\b|formulary|cheapest|afford/.test(lower);
  const wantsDraft = /draft|plan|protocol|visit note|prescribe/.test(lower) || looksLikeVisitNote(text);
  const wantsInsuranceOnly = /insurance|benefit|bin\b|eligibility/.test(lower) && !wantsDraft;
  const wantsList = /list patients|who are my patients|show patients/.test(lower);

  if (wantsList) {
    const listed = await runTool("list_patients", {}, traces);
    if (listed.isError || isAuthFailure(listed)) {
      return { reply: authHelp(listed.content[0]?.text), traces };
    }
    const rows =
      ((listed.structured as { patients?: PatientHit[] })?.patients as PatientHit[]) || [];
    return {
      reply: rows.length
        ? `I found ${rows.length} patients via \`list_patients\`:\n\n${rows
            .map((p) => `• **${p.name}** — \`${p.id}\``)
            .join("\n")}`
        : "No patients in this org yet. Create one with the `create_patient` tool or in app.neutron.health.",
      traces,
    };
  }

  const patient = await resolvePatient(text, patientId, traces);
  const lastTrace = traces.at(-1);
  if (lastTrace?.isError && /unauthorized|jwt expired|invalid token|401/i.test(lastTrace.resultPreview)) {
    return { reply: authHelp(lastTrace.resultPreview), traces };
  }
  if (!patient) {
    return {
      reply:
        "I could not resolve a patient. Create one in Photon or say something like “coverage for Maya Chen”.",
      traces,
    };
  }

  await runTool("get_patient", { patient_id: patient.id }, traces);
  const insurance = await runTool("get_insurance", { patient_id: patient.id }, traces);
  const benefits =
    ((insurance.structured as { benefits?: unknown[] } | undefined)?.benefits as unknown[]) || [];

  if (!benefits.length && (wantsCoverage || wantsDraft)) {
    await runTool(
      "ensure_sandbox_benefit",
      { patient_id: patient.id, fixture: "covered" },
      traces,
    );
  }

  if (wantsInsuranceOnly && !wantsCoverage && !wantsDraft) {
    return {
      reply: benefits.length
        ? `**${patient.name}** has insurance on file:\n\n${insurance.content[0]?.text}`
        : `**${patient.name}** has no benefits on file yet. I can attach a Neutron sandbox fixture if you ask me to check coverage.`,
      traces,
      patientId: patient.id,
    };
  }

  // Visit-note / protocol draft path
  if (wantsDraft || looksLikeVisitNote(text)) {
    const note = looksLikeVisitNote(text)
      ? text
      : extractQuoted(text) ||
        "24F follow-up for moderate inflammatory facial acne. Failed OTC benzoyl peroxide wash for 3 months. Not pregnant, urine hCG negative today.";
    const drafted = await runTool(
      "draft_visit_plan",
      { patient_id: patient.id, note },
      traces,
    );
    const plan = (drafted.structured as { plan?: Parameters<typeof draftsFromPlan>[0] })?.plan;
    const rx = plan ? draftsFromPlan(plan) : [];
    const holds =
      ((drafted.structured as { plan?: { holds?: { title: string; detail: string }[] } })?.plan
        ?.holds as { title: string; detail: string }[]) || [];

    // If patient has active Rxs, also sample coverage at nearby pharmacies
    const chart = traces.find((t) => t.name === "get_patient")?.structured as
      | {
          activePrescriptions?: { id: string; treatment?: string }[];
        }
      | undefined;
    const activeIds = (chart?.activePrescriptions || []).map((r) => r.id).slice(0, 2);
    let coverageExtra = "";
    if (rx[0] && (wantsCoverage || true)) {
      const suggestion = await runTool(
        "suggest_medication_coverage",
        {
          patient_id: patient.id,
          medication: rx[0].treatmentName,
          treatment_id: rx[0].treatmentId,
        },
        traces,
      );
      coverageExtra = suggestion.content[0]?.text
        ? `\n\nPre-order coverage (no order placed):\n${suggestion.content[0].text}`
        : "";
    } else if (activeIds.length && wantsCoverage) {
      await runTool("check_medication_coverage", { prescription_ids: activeIds }, traces);
    }

    const lines = [
      `For **${patient.name}**, I orchestrated Photon tools: \`get_patient\` → \`get_insurance\` → \`draft_visit_plan\` → \`suggest_medication_coverage\`.`,
      "",
      drafted.content[0]?.text || "Draft complete.",
      coverageExtra,
      "",
      holds.length
        ? "I did **not** auto-send anything that needs a clinician hold."
        : "Coverage was checked before any order. Review the proposed scripts, then sign in Photon Elements — the AI never sends the Rx.",
    ];

    return {
      reply: lines.join("\n"),
      traces,
      patientId: patient.id,
      drafts: rx.length ? { patientId: patient.id, prescriptions: rx } : null,
    };
  }

  // Medication / coverage path — suggest coverage BEFORE placing an order
  const med = guessMedication(text) || "Adapalene";
  const suggestion = await runTool(
    "suggest_medication_coverage",
    { patient_id: patient.id, medication: med },
    traces,
  );

  if (suggestion.isError) {
    return {
      reply: `Could not run a pre-order coverage check for **${med}**: ${suggestion.content[0]?.text}`,
      traces,
      patientId: patient.id,
    };
  }

  const structured = suggestion.structured as {
    treatment?: { id: string; name: string };
    draft?: {
      treatmentId: string;
      treatmentName: string;
      dispenseQuantity: number;
      dispenseUnit: string;
      fillsAllowed: number;
      daysSupply: number;
      instructions: string;
      notes?: string;
    };
    recommendation?: {
      treatment: string;
      status: string;
      patientPay: number | null;
      paRequired: boolean;
      pharmacy: string;
      statusMessage?: string;
    } | null;
    alternativeMedications?: {
      treatment?: string | null;
      status?: string;
      price?: number | null;
      paRequired?: boolean;
      pharmacy?: { name?: string } | null;
    }[];
    provisionalPrescriptionId?: string;
  };

  const treatment = structured.treatment;
  const recommendation = structured.recommendation;
  const alternatives = structured.alternativeMedications || [];

  const lines = [
    `**${patient.name}** · pre-order coverage for **${treatment?.name || med}**`,
    "",
    "Tool path: `get_patient` → `get_insurance` → `suggest_medication_coverage`",
    "(provisional Rx for benefit check only — **no order placed**)",
    "",
    benefits.length
      ? `Insurance on file:\n${insurance.content[0]?.text}`
      : "No benefits were on file; a sandbox covered fixture was attached for the demo.",
    "",
    suggestion.content[0]?.text || "Coverage suggestion complete.",
    "",
  ];

  if (recommendation) {
    lines.push(
      "**Recommendation**",
      recommendation.paRequired
        ? `⚠️ ${recommendation.treatment} looks covered with restrictions (PA) at ${recommendation.pharmacy} · est. pay ${recommendation.patientPay == null ? "n/a" : `$${Number(recommendation.patientPay).toFixed(2)}`}`
        : `✅ Prefer ${recommendation.treatment} at ${recommendation.pharmacy} · est. pay ${recommendation.patientPay == null ? "n/a" : `$${Number(recommendation.patientPay).toFixed(2)}`} · ${recommendation.status}`,
      "",
    );
  }

  if (alternatives.length) {
    lines.push(
      "Plan alternatives are listed below as optional drafts — pick which one(s) to take into Photon.",
      "",
    );
  }

  lines.push(
    "No pharmacy order was created. Select a draft below, then open Photon Elements to sign.",
  );

  type DraftOption = NonNullable<AssistantReply["drafts"]>["prescriptions"][number];
  const draftOptions = (structured as { draftOptions?: DraftOption[] }).draftOptions;
  const prescriptions: DraftOption[] =
    draftOptions && draftOptions.length
      ? draftOptions
      : structured.draft
        ? [
            {
              treatmentId: structured.draft.treatmentId,
              treatmentName: structured.draft.treatmentName,
              dispenseQuantity: structured.draft.dispenseQuantity,
              dispenseUnit: structured.draft.dispenseUnit,
              fillsAllowed: structured.draft.fillsAllowed,
              daysSupply: structured.draft.daysSupply,
              instructions: structured.draft.instructions,
              notes: structured.draft.notes,
              role: "requested",
              selected: true,
            },
          ]
        : treatment
          ? [
              {
                treatmentId: treatment.id,
                treatmentName: treatment.name,
                dispenseQuantity: 30,
                dispenseUnit: "Each",
                fillsAllowed: 1,
                daysSupply: 30,
                instructions: `Take/use as directed for ${treatment.name}. Confirm sig in Photon before sending.`,
                notes: "AI-proposed draft — clinician must review and sign.",
                role: "requested",
                selected: true,
              },
            ]
          : [];

  return {
    reply: lines.join("\n"),
    traces,
    patientId: patient.id,
    drafts: prescriptions.length ? { patientId: patient.id, prescriptions } : null,
  };
}

async function runOpenAIAgent(
  messages: ChatMessage[],
  patientId?: string,
): Promise<AssistantReply | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const traces: ToolTrace[] = [];
  const tools = listMcpTools().map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  const system = `You are DermClose, a prescribing assistant for Harbor Dermatology clinicians.
You ONLY help with Photon prescribing workflows: patients, insurance/benefits, catalog search, screening, coverage, and draft plans.
Never invent clinical facts. Prefer calling tools. For medication questions, call suggest_medication_coverage before placing any order so the clinician sees coverage/PA/alternatives first.
Never claim you sent a prescription or placed an order — a licensed clinician signs in Photon Elements.
When the user mentions a patient as @Name (age · pat_…), always use that exact patient_id.
${patientId ? `Preferred patient_id context: ${patientId}` : ""}
Keep answers concise and actionable for a busy clinician.`;

  type OAMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
  };

  const oaMessages: OAMessage[] = [
    { role: "system", content: system },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  let drafts: AssistantReply["drafts"] = null;
  let resolvedPatient = patientId || null;

  for (let round = 0; round < 6; round += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: oaMessages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI error: ${errText.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      choices: {
        message: OAMessage;
      }[];
    };
    const message = json.choices[0]?.message;
    if (!message) break;

    if (message.tool_calls?.length) {
      oaMessages.push(message);
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runTool(call.function.name, args, traces);
        if (call.function.name === "get_patient" || call.function.name === "create_patient") {
          const id = (result.structured as { id?: string } | undefined)?.id;
          if (id) resolvedPatient = id;
        }
        if (call.function.name === "draft_visit_plan" && result.structured) {
          const plan = (result.structured as { plan?: Parameters<typeof draftsFromPlan>[0] }).plan;
          if (plan) {
            drafts = {
              patientId: resolvedPatient || undefined,
              prescriptions: draftsFromPlan(plan),
            };
          }
        }
        oaMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: preview(result),
        });
      }
      continue;
    }

    return {
      reply: message.content || "Done.",
      traces,
      drafts,
      patientId: resolvedPatient,
    };
  }

  return {
    reply: "I hit the tool-call limit. Narrow the question and try again.",
    traces,
    drafts,
    patientId: resolvedPatient,
  };
}

export async function runAssistant(input: {
  messages: ChatMessage[];
  patientId?: string;
}): Promise<AssistantReply> {
  try {
    const openai = await runOpenAIAgent(input.messages, input.patientId);
    if (openai) return openai;
  } catch (error) {
    // Fall through to deterministic agent; surface the LLM failure in the reply prefix.
    const fallback = await runDeterministicAgent(input.messages, input.patientId);
    const reason = error instanceof Error ? error.message : "LLM unavailable";
    return {
      ...fallback,
      reply: `(LLM unavailable: ${reason})\n\n${fallback.reply}`,
    };
  }
  return runDeterministicAgent(input.messages, input.patientId);
}

export function toolsCatalogText() {
  return listMcpTools()
    .map((t) => `• ${t.name} — ${t.description}`)
    .join("\n");
}
