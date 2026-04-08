import { randomUUID } from "node:crypto";
import { generatePostcode } from "@swm/provenance";
import { intentGraphSchema } from "@swm/compiler";
import type {
  IntentGraph,
  IntentGoal,
  IntentConstraint,
  IntentUnknown,
  Challenge,
} from "@swm/compiler";
import type { ElicitationStore } from "./store.js";
import type {
  DraftIntentGraph,
  DraftGoal,
  DraftConstraint,
  DraftUnknown,
  DraftChallenge,
  DraftTargetField,
  SchemaConformanceResult,
  PreFillItem,
} from "./types.js";

// ─── Surface extraction heuristics ───

function extractGoals(text: string): DraftGoal[] {
  const goals: DraftGoal[] = [];
  const patterns: RegExp[] = [
    /i want (?:to )?(.{5,120})/gi,
    /i need (?:to )?(.{5,120})/gi,
    /(?:the system|app|platform|tool|service) should (.{5,120})/gi,
    /(?:allow|enable|let) (?:users? (?:to )?)?(.{5,120})/gi,
    /(?:build|create|make) (?:a |an )?(.{5,120})/gi,
    /(?:users? can|users? will be able to) (.{5,120})/gi,
  ];

  const seen = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const raw = (m[1] ?? "").replace(/[.!?]+$/, "").trim();
      const key = raw.toLowerCase().slice(0, 60);
      if (raw.length >= 5 && !seen.has(key)) {
        seen.add(key);
        goals.push({
          id: randomUUID(),
          description: raw,
          type: "stated",
          confidence: "low",
          sourceTurnId: null,
        });
      }
    }
  }
  return goals.slice(0, 5); // cap at 5 surface-extracted goals
}

function extractConstraints(text: string): DraftConstraint[] {
  const constraints: DraftConstraint[] = [];
  const patterns: RegExp[] = [
    /(?:must not|should not|cannot|can't) (.{5,120})/gi,
    /(?:no |without )(.{5,120})/gi,
    /(?:it must be|it should be) (.{5,120})/gi,
    /(?:requires?|requirement:?) (.{5,120})/gi,
  ];

  const seen = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const raw = (m[1] ?? "").replace(/[.!?]+$/, "").trim();
      const key = raw.toLowerCase().slice(0, 60);
      if (raw.length >= 5 && !seen.has(key)) {
        seen.add(key);
        constraints.push({
          id: randomUUID(),
          description: raw,
          source: "explicit",
          confidence: "low",
          sourceTurnId: null,
        });
      }
    }
  }
  return constraints.slice(0, 5);
}

// ─── DraftIntentGraphManager ───

export class DraftIntentGraphManager {
  constructor(private readonly store: ElicitationStore) {}

  // ─── initializeDraft ───
  initializeDraft(sessionId: string, rawIntentText: string): DraftIntentGraph {
    // Idempotency guard
    const existing = this.store.getDraftBySession(sessionId);
    if (existing) return existing;

    const goals = extractGoals(rawIntentText);
    const constraints = extractConstraints(rawIntentText);
    const now = Date.now();

    const draft: DraftIntentGraph = {
      draftId: randomUUID(),
      sessionId,
      rawIntent: rawIntentText,
      goals,
      constraints,
      unknowns: [],
      challenges: [],
      revisionCount: 0,
      lastModifiedAt: now,
      status: goals.length > 0 || constraints.length > 0 ? "draft" : "shell",
      schemaConformanceResultId: null,
    };

    this.store.drafts.set(draft.draftId, draft);
    return draft;
  }

  // ─── applyPreFillItem ───
  // Applies a single pre-fill item derived by Ada's structural read pass.
  // Items with confidence "high" are applied silently (no turn tracking).
  // Creates items with type "derived" / source "derived" to distinguish
  // from user-stated content.
  applyPreFillItem(draftId: string, item: PreFillItem): void {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);

    const id = randomUUID();
    switch (item.targetField) {
      case "goals": {
        const goal: DraftGoal = {
          id,
          description: item.value,
          type: "derived",
          confidence: "high",
          sourceTurnId: null,
        };
        draft.goals = [...draft.goals, goal];
        break;
      }
      case "constraints": {
        const constraint: DraftConstraint = {
          id,
          description: item.value,
          source: "derived",
          confidence: "high",
          sourceTurnId: null,
        };
        draft.constraints = [...draft.constraints, constraint];
        break;
      }
      case "unknowns": {
        const unknown: DraftUnknown = {
          id,
          description: item.value,
          impact: "scoping",
          confidence: "high",
          sourceTurnId: null,
        };
        draft.unknowns = [...draft.unknowns, unknown];
        break;
      }
      case "challenges": {
        const challenge: DraftChallenge = {
          id,
          description: item.value,
          severity: "minor",
          resolved: false,
          sourceTurnId: null,
        };
        draft.challenges = [...draft.challenges, challenge];
        break;
      }
    }

    draft.revisionCount += 1;
    draft.lastModifiedAt = Date.now();
    if (draft.status === "shell") {
      draft.status = "draft";
    }
  }

  // ─── applyMutation ───
  // Applies a string answer to a specific target field, creating the
  // appropriate typed item. Increments revisionCount and marks draft dirty
  // (clears schemaConformanceResultId since the draft has changed).
  applyMutation(
    draftId: string,
    targetField: DraftTargetField,
    value: string,
    sourceTurnId: string,
  ): DraftIntentGraph {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);

    const trimmed = value.trim();
    if (!trimmed) throw new Error("Mutation value must be non-empty");

    switch (targetField) {
      case "goals": {
        const goal: DraftGoal = {
          id: randomUUID(),
          description: trimmed,
          type: "stated",
          confidence: "high",
          sourceTurnId,
        };
        draft.goals = [...draft.goals, goal];
        break;
      }
      case "constraints": {
        const constraint: DraftConstraint = {
          id: randomUUID(),
          description: trimmed,
          source: "explicit",
          confidence: "high",
          sourceTurnId,
        };
        draft.constraints = [...draft.constraints, constraint];
        break;
      }
      case "unknowns": {
        const unknown: DraftUnknown = {
          id: randomUUID(),
          description: trimmed,
          impact: "scoping",
          confidence: "high",
          sourceTurnId,
        };
        draft.unknowns = [...draft.unknowns, unknown];
        break;
      }
      case "challenges": {
        const challenge: DraftChallenge = {
          id: randomUUID(),
          description: trimmed,
          severity: "minor",
          resolved: false,
          sourceTurnId,
        };
        draft.challenges = [...draft.challenges, challenge];
        break;
      }
    }

    draft.revisionCount += 1;
    draft.lastModifiedAt = Date.now();
    // Dirty the conformance result — a new check is needed after mutations
    (
      draft as { schemaConformanceResultId: string | null }
    ).schemaConformanceResultId = null;

    if (draft.status === "shell") {
      draft.status = "draft";
    } else if (
      draft.status === "conformance_passed" ||
      draft.status === "conformance_failed"
    ) {
      draft.status = "draft"; // draft is dirty relative to last conformance
    }

    return draft;
  }

  // ─── runSchemaConformance ───
  // Validates that the current draft can produce a valid IntentGraph.
  // Uses intentGraphSchema.safeParse on the projected output.
  // This is DETERMINISTIC — no LLM involved.
  runSchemaConformance(draftId: string): SchemaConformanceResult {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);

    const failedPredicates: string[] = [];
    const missingRequiredFields: string[] = [];

    // Check rawIntent
    if (!draft.rawIntent || draft.rawIntent.trim().length === 0) {
      missingRequiredFields.push("rawIntent");
    }

    // Check arrays are non-null (always true in our impl, but enforce the contract)
    if (draft.goals === null || draft.goals === undefined) {
      missingRequiredFields.push("goals");
    }
    if (draft.constraints === null || draft.constraints === undefined) {
      missingRequiredFields.push("constraints");
    }
    if (draft.unknowns === null || draft.unknowns === undefined) {
      missingRequiredFields.push("unknowns");
    }
    if (draft.challenges === null || draft.challenges === undefined) {
      missingRequiredFields.push("challenges");
    }

    // Validate each DraftGoal has id and description
    draft.goals.forEach((g, i) => {
      if (!g.id || !g.description) {
        failedPredicates.push(`goals[${i}]: missing id or description`);
      }
    });
    draft.constraints.forEach((c, i) => {
      if (!c.id || !c.description) {
        failedPredicates.push(`constraints[${i}]: missing id or description`);
      }
    });
    draft.unknowns.forEach((u, i) => {
      if (!u.id || !u.description) {
        failedPredicates.push(`unknowns[${i}]: missing id or description`);
      }
    });
    draft.challenges.forEach((ch, i) => {
      if (!ch.id || !ch.description) {
        failedPredicates.push(`challenges[${i}]: missing id or description`);
      }
    });

    // Try projecting and running against intentGraphSchema
    if (missingRequiredFields.length === 0) {
      const projected = this._projectUnsafe(draft);
      const parseResult = intentGraphSchema.safeParse(projected);
      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          failedPredicates.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }
    }

    const passed =
      failedPredicates.length === 0 && missingRequiredFields.length === 0;

    const result: SchemaConformanceResult = {
      resultId: randomUUID(),
      draftId,
      revisionCount: draft.revisionCount,
      passed,
      failedPredicates,
      missingRequiredFields,
      evaluatedAt: Date.now(),
    };

    this.store.conformanceResults.set(result.resultId, result);

    // Link to draft
    (
      draft as { schemaConformanceResultId: string | null }
    ).schemaConformanceResultId = result.resultId;
    draft.status = passed ? "conformance_passed" : "conformance_failed";

    return result;
  }

  // ─── getDraftState ───
  getDraftState(draftId: string): DraftIntentGraph {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    return draft;
  }

  // ─── projectToIntentGraph ───
  // Maps DraftIntentGraph → canonical IntentGraph for handoff.
  projectToIntentGraph(draftId: string): IntentGraph {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    return this._projectUnsafe(draft);
  }

  // ─── finalizeDraft ───
  finalizeDraft(draftId: string): DraftIntentGraph {
    const draft = this.store.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    draft.status = "finalized";
    return draft;
  }

  // ─── private projection helper ───
  private _projectUnsafe(draft: DraftIntentGraph): IntentGraph {
    const goals: IntentGoal[] = draft.goals.map((g) => ({
      id: g.id,
      description: g.description,
      type: g.type,
    }));

    const constraints: IntentConstraint[] = draft.constraints.map((c) => ({
      id: c.id,
      description: c.description,
      source: c.source,
    }));

    const unknowns: IntentUnknown[] = draft.unknowns.map((u) => ({
      id: u.id,
      description: u.description,
      impact: u.impact,
    }));

    const challenges: Challenge[] = draft.challenges.map((ch) => ({
      id: ch.id,
      description: ch.description,
      severity: ch.severity,
      resolved: ch.resolved,
    }));

    const postcode = generatePostcode("INT", draft.rawIntent + draft.draftId);

    return {
      goals,
      constraints,
      unknowns,
      challenges,
      rawIntent: draft.rawIntent,
      postcode,
    };
  }
}
