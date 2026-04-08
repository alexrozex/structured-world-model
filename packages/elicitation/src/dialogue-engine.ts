import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ElicitationStore } from "./store.js";
import type { GapAnalyzer } from "./gap-analyzer.js";
import type {
  DraftIntentGraph,
  Gap,
  ElicitationTurn,
  ClarificationRequestRecord,
  ClarificationAnswerRecord,
  AdaProposal,
  ProposalDispositionType,
  DraftTargetField,
  LLMProposalOutput,
  LLMRequestOutput,
  LevelAssessment,
  PreFillItem,
  PreFillResult,
} from "./types.js";

// Axiom-aligned question templates for each QuestionType (A9, A10).
// These are shown to the LLM as the question frame — it expands them with
// the raw intent context and option-framing per A10.
const QUESTION_HINT_FRAMES: Record<string, string> = {
  // scope_boundary intentionally omitted — Ada always proposes scope, never asks the user to define it.
  // Asking "what should this NOT include?" is unanswerable without knowing what Ada might include.
  // The PROPOSAL_HINT_FRAMES entry handles this via Ada's own scope derivation.
  primary_actor:
    "When someone opens this for the first time, who are they and what's the one thing they're trying to do?",
  failure_conditions:
    "What would make this system dangerous or useless? What should it absolutely never do or allow to happen?",
  workflow_disambiguation:
    "Walk me through what happens from the moment the primary user arrives. What do they do first, then what?",
  business_rule:
    "This domain usually has strict rules around this area. Does your system handle these the standard way, or is there something specific about your situation I should know?",
};

// Framing hints for proposals — used to tell the LLM what kind of structural
// decision it's proposing for and how to frame the proposal.
const PROPOSAL_HINT_FRAMES: Record<string, string> = {
  scope_boundary:
    "Frame this as: 'I'm modeling this system's scope as [specific scope]. It handles [X] but not [Y]. Standard scoping for this type of project. Does this match?'",
  primary_actor:
    "Frame this as: 'I'm modeling the primary user as [actor] who needs to [core goal]. Does this match how you're thinking about it?'",
  failure_conditions:
    "Frame this as: 'I'm adding this constraint: [constraint]. This captures a rule that's critical for this type of system based on [intent words or domain]. Does this apply?'",
  workflow_disambiguation:
    "Frame this as: 'I'm modeling the main workflow as: [sequence]. This is the standard flow for this type of system. Does this match your vision?'",
  business_rule:
    "Frame this as: 'I'm applying this rule: [rule]. Standard practice in this domain. Does this apply to your system or do you handle it differently?'",
};

const FIELD_LABELS: Record<DraftTargetField, string> = {
  goals: "goals (what the system should accomplish)",
  constraints: "constraints (what the system must/must not do)",
  unknowns: "open unknowns (things that need to be decided)",
  challenges: "challenges (risks or obstacles)",
};

const IMPACT_FOR_SEVERITY: Record<
  string,
  "blocking" | "scoping" | "implementation"
> = {
  blocking: "blocking",
  high: "scoping",
  low: "implementation",
};

// ─── LLM calling helpers ───

function extractJSON(text: string): string | null {
  const fenced = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) {
    const c = fenced[1].trim();
    if (c.startsWith("{")) return c;
  }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e > s) return text.slice(s, e + 1);
  return null;
}

async function callAPIText(prompt: string): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return "";
  const client = new Anthropic({ apiKey });
  let text = "";
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  stream.on("text", (t) => {
    text += t;
  });
  await stream.finalMessage();
  return text;
}

function callCLIText(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ada-eli-"));
    const promptFile = path.join(tmpDir, "prompt.txt");
    fs.writeFileSync(promptFile, prompt, "utf8");

    const input = fs.createReadStream(promptFile);
    const proc = spawn(
      "claude",
      [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        "claude-sonnet-4-6",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
      ],
      { cwd: tmpDir, stdio: ["pipe", "pipe", "pipe"] },
    );

    let accumulated = "";
    let lineBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const inner = (event["event"] ?? event) as Record<string, unknown>;
          if (inner["type"] === "assistant") {
            const msg = inner["message"] as Record<string, unknown> | undefined;
            const content = msg?.["content"] as
              | Array<Record<string, unknown>>
              | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block["type"] === "text") {
                  accumulated += String(block["text"] ?? "");
                }
              }
            }
          }
        } catch {
          /* skip unparseable lines */
        }
      }
    });

    proc.on("close", () => {
      try {
        fs.unlinkSync(promptFile);
        fs.rmdirSync(tmpDir);
      } catch {
        /* cleanup */
      }
      resolve(accumulated);
    });

    proc.on("error", () => {
      try {
        fs.unlinkSync(promptFile);
        fs.rmdirSync(tmpDir);
      } catch {
        /* cleanup */
      }
      resolve(accumulated || "");
    });

    input.pipe(proc.stdin);

    setTimeout(() => {
      proc.kill();
      resolve(accumulated || "");
    }, 60_000);
  });
}

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (apiKey?.startsWith("sk-ant-")) {
    return callAPIText(prompt);
  }
  return callCLIText(prompt);
}

// ─── DialogueEngine ───

export class DialogueEngine {
  constructor(
    private readonly store: ElicitationStore,
    private readonly gapAnalyzer: GapAnalyzer,
  ) {}

  // ─── assessAbstractionLevel ───
  // Level-setting pass: run before first gap detection.
  // Determines whether the user's raw intent is at the right abstraction level.
  // Returns coaching advice if the intent is too technical or too vague.
  async assessAbstractionLevel(rawIntent: string): Promise<LevelAssessment> {
    const prompt = `You are Ada, a semantic intent elicitation assistant. Evaluate the abstraction level of this user intent:

"${rawIntent.slice(0, 600)}"

Assess whether this intent is:
- "too_technical": focuses on implementation details (specific libraries, frameworks, patterns, database choices, hosting, etc.) rather than what the system should do for users
- "too_vague": so abstract that key behaviors, users, or goals cannot be inferred (e.g., "build me an app", "make a website")
- "appropriate": describes what the system should do and for whom at a semantic level — concrete enough to compile, without prescribing implementation

If NOT appropriate, write 1-2 sentences of coaching to help the user reframe their intent at the right level.

Respond ONLY with a JSON object:
{
  "level": "too_technical" | "too_vague" | "appropriate",
  "coaching": "..." | null
}`;

    try {
      const raw = await callLLM(prompt);
      const jsonStr = extractJSON(raw);
      if (jsonStr) {
        const obj = JSON.parse(jsonStr) as Record<string, unknown>;
        const level = String(obj["level"] ?? "");
        if (
          level === "too_technical" ||
          level === "too_vague" ||
          level === "appropriate"
        ) {
          const coaching =
            obj["coaching"] != null ? String(obj["coaching"]).trim() : null;
          return { level, coaching: coaching || null };
        }
      }
    } catch {
      /* fall through to default */
    }

    return { level: "appropriate", coaching: null };
  }

  // ─── preFillDraft ───
  // Ada's structural read pass: one LLM call to derive everything that can be
  // inferred from the intent before asking the user anything.
  //
  // "high" confidence items are applied silently to the draft.
  // "medium" confidence items surface as proposals for user confirmation.
  //
  // This is the "read first, propose unresolvables" model — parallel to how
  // Claude Code reads the codebase before writing any code.
  async preFillDraft(
    rawIntentText: string,
    _draft: DraftIntentGraph,
  ): Promise<PreFillResult> {
    const prompt = `You are Ada, a semantic intent compiler. Read this raw intent and fill in everything you can confidently derive — before asking the user anything.

Think like a senior engineer reading a brief: understand the domain, fill in what any competent builder in this space would already know from the intent.

Raw intent: "${rawIntentText.slice(0, 800)}"

Derive items for: goals (what the system accomplishes), constraints (what it must/must not do), unknowns (genuinely unresolved decisions), challenges (real risks).

For each item assign confidence:
- "high": certain from the intent text itself or universal convention for this domain type (applied silently — user never sees)
- "medium": good inference, standard practice in this domain, but user may have different preferences (surfaced as a proposal for confirmation)

Rules:
- Be proportional. Simple intent → 2–4 items total. Do NOT over-extract.
- "high" confidence only for things clearly stated in the intent or universally true for this domain.
- Derive failure conditions from domain knowledge (e.g. payment system must never double-charge).
- Don't create items you're not at least "medium" confident about.
- Reference specific words from the intent in your rationale.

Return ONLY a JSON object:
{
  "items": [
    {
      "targetField": "goals" | "constraints" | "unknowns" | "challenges",
      "value": "concrete, specific, actionable statement",
      "rationale": "why Ada derived this — reference specific intent words or domain conventions",
      "confidence": "high" | "medium"
    }
  ]
}`;

    try {
      const raw = await callLLM(prompt);
      const jsonStr = extractJSON(raw);
      if (jsonStr) {
        const obj = JSON.parse(jsonStr) as Record<string, unknown>;
        const rawItems = Array.isArray(obj["items"]) ? obj["items"] : [];
        const validFields = new Set<string>([
          "goals",
          "constraints",
          "unknowns",
          "challenges",
        ]);
        const items: PreFillItem[] = [];
        for (const item of rawItems) {
          const r = item as Record<string, unknown>;
          const tf = String(r["targetField"] ?? "");
          const val = String(r["value"] ?? "").trim();
          const rat = String(r["rationale"] ?? "").trim();
          const conf = String(r["confidence"] ?? "");
          if (
            validFields.has(tf) &&
            val.length > 5 &&
            rat.length > 5 &&
            (conf === "high" || conf === "medium")
          ) {
            items.push({
              targetField: tf as PreFillItem["targetField"],
              value: val,
              rationale: rat,
              confidence: conf,
            });
          }
        }
        return { items, derivedAt: Date.now() };
      }
    } catch {
      /* fall through — pre-fill is best-effort, not required */
    }

    return { items: [], derivedAt: Date.now() };
  }

  // ─── openTurn ───
  openTurn(sessionId: string, gap: Gap): ElicitationTurn {
    // Idempotency: don't open a second turn for the same gap
    const existing = this.store.getOpenTurnForGap(gap.gapId);
    if (existing) return existing;

    const turnIndex = this.store.nextTurnIndex(sessionId);
    const turn: ElicitationTurn = {
      turnId: randomUUID(),
      sessionId,
      gapId: gap.gapId,
      turnIndex,
      status: "opened",
      clarificationRequestId: null,
      proposalId: null,
      clarificationAnswerId: null,
      openedAt: Date.now(),
      closedAt: null,
    };
    this.store.turns.set(turn.turnId, turn);

    // Mark gap as active
    gap.status = "active";

    return turn;
  }

  // ─── generateClarificationRequest ───
  // Uses LLM to generate a targeted question about the gap.
  // When gap.questionHint is set, uses an axiom-aligned question frame
  // instead of the generic gap-type framing (A9, A10).
  async generateClarificationRequest(
    gap: Gap,
    draft: DraftIntentGraph,
  ): Promise<ClarificationRequestRecord> {
    const fieldLabel = FIELD_LABELS[gap.targetField];
    const impact = IMPACT_FOR_SEVERITY[gap.severity] ?? "scoping";

    let conflictContext = "";
    if (gap.gapKind === "contradictory" && gap.conflictingFieldA) {
      conflictContext = `\nConflicting values:\n- Goal: "${gap.conflictingFieldA}"\n- Constraint: "${gap.conflictingFieldB ?? ""}"\n`;
    }

    // If the gap was injected by the adaptive depth classifier, use the
    // targeted question frame directly — no LLM rewrite needed.
    // The hint frames are pre-calibrated (A9, A10); rewriting them degrades quality.
    const hintFrame = gap.questionHint
      ? (QUESTION_HINT_FRAMES[gap.questionHint] ?? null)
      : null;

    if (hintFrame) {
      // Use frame verbatim — it's already axiom-aligned and tested.
      const id = `crr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return {
        clarificationRequestId: id,
        unknownId: gap.gapId,
        gapId: gap.gapId,
        question: hintFrame,
        impact,
        suggestedDefault: null,
        createdAt: Date.now(),
      };
    }

    const hintInstruction = "";

    const prompt = `You are Ada, a semantic intent elicitation assistant. A user has described their project intent and you have identified a gap.

Raw intent: "${draft.rawIntent}"
Gap field: ${fieldLabel}
Gap kind: ${gap.gapKind}
Gap severity: ${gap.severity}${conflictContext}
Existing goals: ${draft.goals.map((g) => g.description).join("; ") || "none"}
Existing constraints: ${draft.constraints.map((c) => c.description).join("; ") || "none"}
${hintInstruction}
Generate a clear, specific question to ask the user to resolve this gap. The question should:
- Be direct and understandable to a non-technical user
- Explain why this information matters
- Reference their raw intent when helpful
- NOT ask about technical implementation choices (libraries, frameworks, etc.)
${gap.gapKind === "contradictory" ? "- Ask the user to resolve the contradiction between the two conflicting values above" : ""}
${gap.gapKind === "missing" && !hintFrame ? "- Offer a concrete example or suggestion if helpful" : ""}

Respond ONLY with a JSON object:
{
  "question": "...",
  "impact": "blocking" | "scoping" | "implementation",
  "suggestedDefault": "..." | null
}`;

    let parsed: LLMRequestOutput | null = null;

    try {
      const raw = await callLLM(prompt);
      const jsonStr = extractJSON(raw);
      if (jsonStr) {
        const obj = JSON.parse(jsonStr) as Record<string, unknown>;
        const q = String(obj["question"] ?? "").trim();
        const imp = String(obj["impact"] ?? impact);
        const sd =
          obj["suggestedDefault"] != null
            ? String(obj["suggestedDefault"])
            : null;

        if (q.length > 5) {
          parsed = {
            question: q,
            impact: (["blocking", "scoping", "implementation"].includes(imp)
              ? imp
              : impact) as "blocking" | "scoping" | "implementation",
            suggestedDefault: sd,
          };
        }
      }
    } catch {
      /* fall through to default */
    }

    if (!parsed) {
      parsed = this._defaultRequest(gap, draft, impact);
    }

    const record: ClarificationRequestRecord = {
      clarificationRequestId: randomUUID(),
      unknownId: gap.gapId,
      gapId: gap.gapId,
      question: parsed.question,
      impact: parsed.impact,
      suggestedDefault: parsed.suggestedDefault,
      createdAt: Date.now(),
    };

    this.store.clarificationRequests.set(record.clarificationRequestId, record);
    return record;
  }

  // ─── generateAdaProposal ───
  // Uses LLM to propose a concrete value for a gap field.
  // This is the primary path for ALL gaps — Ada proposes her best answer,
  // the user confirms, edits, or rejects. Questions are only a fallback.
  async generateAdaProposal(
    gap: Gap,
    draft: DraftIntentGraph,
  ): Promise<AdaProposal | null> {
    const fieldLabel = FIELD_LABELS[gap.targetField];
    const hintFrame = gap.questionHint
      ? (PROPOSAL_HINT_FRAMES[gap.questionHint] ?? null)
      : null;

    const contradictionContext =
      gap.gapKind === "contradictory" && gap.conflictingFieldA
        ? `\nConflict to resolve:\n- A: "${gap.conflictingFieldA}"\n- B: "${gap.conflictingFieldB ?? ""}"\n`
        : "";

    const prompt = `You are Ada, a semantic intent compiler. You've analyzed the user's intent and need to propose a concrete decision — not ask a question.

Raw intent: "${draft.rawIntent}"
Field: ${fieldLabel}
Gap kind: ${gap.gapKind}${contradictionContext}
Known goals: ${draft.goals.map((g) => g.description).join("; ") || "none"}
Known constraints: ${draft.constraints.map((c) => c.description).join("; ") || "none"}
${hintFrame ? `\nProposal framing guidance:\n${hintFrame}` : ""}

Your job: propose Ada's specific, concrete decision for this field.
- State the decision clearly (not a question)
- Reference specific words from the intent or domain conventions as rationale
- The rationale should end with "Does this match?" so the user knows they're confirming, not answering from scratch
- Be specific enough to be actionable — avoid vague generalities
- Avoid technical implementation choices (frameworks, libraries, hosting, etc.)
${gap.gapKind === "contradictory" ? "- Propose a resolution to the conflict above — pick one or propose a synthesis" : ""}

Respond ONLY with a JSON object:
{
  "proposedText": "the concrete proposed value — a specific, actionable statement",
  "rationale": "Ada's reasoning ending with 'Does this match?'"
}`;

    let parsed: LLMProposalOutput | null = null;

    try {
      const raw = await callLLM(prompt);
      const jsonStr = extractJSON(raw);
      if (jsonStr) {
        const obj = JSON.parse(jsonStr) as Record<string, unknown>;
        const pt = String(obj["proposedText"] ?? "").trim();
        const rt = String(obj["rationale"] ?? "").trim();
        if (pt.length > 5 && rt.length > 5) {
          parsed = { proposedText: pt, rationale: rt };
        }
      }
    } catch {
      /* fall through */
    }

    if (!parsed) {
      const fallback = this._defaultProposal(gap, draft);
      if (fallback.proposedText) {
        parsed = fallback;
      }
    }

    // If LLM failed and no fallback, skip proposal entirely
    if (!parsed) return null;

    // Need turnId — this should always be set by caller
    const turn = this.store.getOpenTurnForGap(gap.gapId);
    if (!turn) return null;

    const proposal: AdaProposal = {
      proposalId: randomUUID(),
      gapId: gap.gapId,
      turnId: turn.turnId,
      proposedText: parsed.proposedText,
      rationale: parsed.rationale,
      targetField: gap.targetField,
      disposition: "pending",
      modifiedText: null,
      createdAt: Date.now(),
    };

    this.store.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  // ─── linkRequestToTurn ───
  // Must be called after generateClarificationRequest to bind the request to the turn
  linkRequestToTurn(
    turnId: string,
    clarificationRequestId: string,
  ): ElicitationTurn {
    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    turn.clarificationRequestId = clarificationRequestId;
    turn.status = "awaiting_answer";
    return turn;
  }

  // ─── linkProposalToTurn ───
  linkProposalToTurn(turnId: string, proposalId: string): ElicitationTurn {
    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    turn.proposalId = proposalId;
    turn.status = "awaiting_answer";
    return turn;
  }

  // ─── receiveClarificationAnswer ───
  receiveClarificationAnswer(
    turnId: string,
    answer: string,
  ): ClarificationAnswerRecord {
    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    if (turn.status === "closed" || turn.status === "expired") {
      throw new Error(
        `Stale turn reference: turn ${turnId} is already ${turn.status}`,
      );
    }
    if (!answer.trim()) {
      throw new Error("Answer must be non-empty");
    }

    const request = turn.clarificationRequestId
      ? this.store.clarificationRequests.get(turn.clarificationRequestId)
      : undefined;

    const record: ClarificationAnswerRecord = {
      clarificationAnswerId: randomUUID(),
      unknownId: turn.gapId, // same gapId as the unknownId
      turnId,
      answer: answer.trim(),
      receivedAt: Date.now(),
    };

    this.store.clarificationAnswers.set(record.clarificationAnswerId, record);
    turn.clarificationAnswerId = record.clarificationAnswerId;
    turn.status = "answered";

    // Suppress unused variable warning
    void request;

    return record;
  }

  // ─── processProposalDisposition ───
  processProposalDisposition(
    proposalId: string,
    disposition: ProposalDispositionType,
    modifiedText?: string,
  ): AdaProposal {
    const proposal = this.store.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

    if (disposition === "modified" && (!modifiedText || !modifiedText.trim())) {
      throw new Error("A modified disposition requires non-empty modifiedText");
    }

    proposal.disposition = disposition;
    proposal.modifiedText =
      disposition === "modified" ? (modifiedText ?? null) : null;

    // Update linked turn status
    const turn = this.store.turns.get(proposal.turnId);
    if (turn) {
      turn.status = "answered";
    }

    return proposal;
  }

  // ─── closeTurn ───
  closeTurn(turnId: string): ElicitationTurn {
    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    turn.status = "closed";
    turn.closedAt = Date.now();
    return turn;
  }

  // ─── expireTurn ───
  expireTurn(turnId: string): ElicitationTurn {
    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    turn.status = "expired";
    turn.closedAt = Date.now();
    return turn;
  }

  // ─── defaults ───

  private _defaultRequest(
    gap: Gap,
    draft: DraftIntentGraph,
    impact: "blocking" | "scoping" | "implementation",
  ): LLMRequestOutput {
    const fieldLabels: Record<DraftTargetField, string> = {
      goals: "goals",
      constraints: "constraints",
      unknowns: "open questions",
      challenges: "challenges or risks",
    };

    let question: string;
    let suggestedDefault: string | null = null;

    if (gap.gapKind === "contradictory") {
      question =
        `Your intent mentions "${gap.conflictingFieldA}" but also has a constraint about "${gap.conflictingFieldB}". ` +
        `These seem to conflict — which should take priority, or can you clarify how they should work together?`;
    } else if (gap.gapKind === "missing") {
      question =
        `Based on your intent "${draft.rawIntent.slice(0, 100)}", what ${fieldLabels[gap.targetField]} ` +
        `should this system have? Please describe what it should ${gap.targetField === "goals" ? "accomplish" : gap.targetField === "constraints" ? "never do or always require" : "handle"}.`;
      if (gap.targetField === "goals") {
        suggestedDefault = `A system that ${draft.rawIntent.slice(0, 80)}`;
      }
    } else {
      question =
        `Can you confirm or refine the ${fieldLabels[gap.targetField]} for your project? ` +
        `Current extracted value is based on: "${draft.rawIntent.slice(0, 80)}".`;
    }

    return { question, impact, suggestedDefault };
  }

  private _defaultProposal(
    gap: Gap,
    draft: DraftIntentGraph,
  ): LLMProposalOutput {
    const rawShort = draft.rawIntent.slice(0, 100);

    // This fallback should rarely fire — only when callCLIText also fails.
    // Return empty strings so the caller can skip showing a broken proposal.
    return { proposedText: "", rationale: "" };
  }
}
