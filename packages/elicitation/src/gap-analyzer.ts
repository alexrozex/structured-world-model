import { randomUUID } from "node:crypto";
import type { ElicitationStore } from "./store.js";
import type {
  DraftIntentGraph,
  DraftTargetField,
  Gap,
  GapKind,
  GapSeverity,
} from "./types.js";
import type { PlannedQuestion } from "./depth-classifier.js";

const SEVERITY_RANK: Record<GapSeverity, number> = {
  blocking: 3,
  high: 2,
  low: 1,
};

// Pairs of terms that suggest a contradiction between goals and constraints
const CONTRADICTION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["public", "private"],
  ["free", "paid"],
  ["real-time", "batch"],
  ["offline", "online only"],
  ["no authentication", "requires authentication"],
  ["anonymous", "authenticated"],
  ["open source", "proprietary"],
  ["no user data", "store user data"],
];

export class GapAnalyzer {
  constructor(private readonly store: ElicitationStore) {}

  // ─── scanForGaps ───
  // Scans draft fields and creates new Gap records for untracked issues.
  // Does NOT re-open resolved gaps. Enforces (draftId, targetField, gapKind, unresolved) uniqueness.
  scanForGaps(draft: DraftIntentGraph): Gap[] {
    const newGaps: Gap[] = [];
    const now = Date.now();

    const hasDuplicate = (field: DraftTargetField, kind: GapKind): boolean => {
      for (const g of this.store.gaps.values()) {
        if (
          g.draftId === draft.draftId &&
          g.targetField === field &&
          g.gapKind === kind &&
          !g.resolved &&
          g.status !== "suppressed"
        ) {
          return true;
        }
      }
      return false;
    };

    const add = (
      field: DraftTargetField,
      kind: GapKind,
      severity: GapSeverity,
      conflictingFieldA?: string,
      conflictingFieldB?: string,
    ): Gap => {
      const gapId = randomUUID();
      const base = {
        gapId,
        draftId: draft.draftId,
        targetField: field,
        gapKind: kind,
        severity,
        status: "open" as const,
        detectedAt: now,
        resolved: false,
        resolvedByTurnId: null,
        suppressedReason: null,
      };
      const gap: Gap =
        conflictingFieldA !== undefined
          ? {
              ...base,
              conflictingFieldA,
              ...(conflictingFieldB !== undefined ? { conflictingFieldB } : {}),
            }
          : base;
      this.store.gaps.set(gapId, gap);
      newGaps.push(gap);
      return gap;
    };

    // ── goals ──
    // No goals at all → blocking missing gap
    const unconfirmedGoals = draft.goals.filter((g) => g.confidence === "low");
    const confirmedGoals = draft.goals.filter((g) => g.confidence === "high");

    if (draft.goals.length === 0) {
      if (!hasDuplicate("goals", "missing")) {
        add("goals", "missing", "blocking");
      }
    } else if (confirmedGoals.length === 0 && unconfirmedGoals.length > 0) {
      // Goals exist but none confirmed — ambiguous
      if (!hasDuplicate("goals", "ambiguous")) {
        add("goals", "ambiguous", "high");
      }
    }

    // ── constraints ──
    if (draft.constraints.length === 0) {
      if (!hasDuplicate("constraints", "missing")) {
        add("constraints", "missing", "high");
      }
    }

    // ── cross-field contradiction check ──
    // Only run when we have confirmed content in both fields
    if (confirmedGoals.length > 0 && draft.constraints.length > 0) {
      for (const goal of confirmedGoals) {
        for (const constraint of draft.constraints) {
          const gLow = goal.description.toLowerCase();
          const cLow = constraint.description.toLowerCase();

          for (const [termA, termB] of CONTRADICTION_PAIRS) {
            const aInGoal = gLow.includes(termA);
            const bInConstraint = cLow.includes(termB);
            const bInGoal = gLow.includes(termB);
            const aInConstraint = cLow.includes(termA);

            if ((aInGoal && bInConstraint) || (bInGoal && aInConstraint)) {
              if (!hasDuplicate("goals", "contradictory")) {
                add(
                  "goals",
                  "contradictory",
                  "blocking",
                  goal.description,
                  constraint.description,
                );
              }
            }
          }
        }
      }
    }

    return newGaps;
  }

  // ─── injectPlannedGaps ───
  // Called by session manager after classifyDepth() to pre-seed the gap store
  // with axiom-derived questions before the generic scanner runs.
  // Each planned question becomes a Gap with a questionHint that overrides
  // the dialogue engine's generic question generation.
  injectPlannedGaps(
    draftId: string,
    questions: readonly PlannedQuestion[],
  ): Gap[] {
    const now = Date.now();
    const injected: Gap[] = [];

    for (const q of questions) {
      // De-duplicate: skip if an open gap with the same hint already exists.
      let exists = false;
      for (const g of this.store.gaps.values()) {
        if (
          g.draftId === draftId &&
          g.questionHint === q.type &&
          !g.resolved &&
          g.status !== "suppressed"
        ) {
          exists = true;
          break;
        }
      }
      if (exists) continue;

      const gap: Gap = {
        gapId: randomUUID(),
        draftId,
        targetField: q.targetField as DraftTargetField,
        gapKind: "missing",
        severity: q.priority === "mandatory" ? "blocking" : "high",
        status: "open",
        detectedAt: now,
        resolved: false,
        resolvedByTurnId: null,
        suppressedReason: null,
        questionHint: q.type,
      };
      this.store.gaps.set(gap.gapId, gap);
      injected.push(gap);
    }

    return injected;
  }

  // ─── prioritizeGaps ───
  // Sorts by severity desc, then detectedAt asc (oldest first within same severity).
  prioritizeGaps(gaps: Gap[]): Gap[] {
    return [...gaps].sort((a, b) => {
      const diff =
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
      if (diff !== 0) return diff;
      return a.detectedAt - b.detectedAt;
    });
  }

  // ─── resolveGap ───
  resolveGap(gapId: string, resolvedByTurnId: string): Gap {
    const gap = this.store.gaps.get(gapId);
    if (!gap) throw new Error(`Gap not found: ${gapId}`);
    gap.resolved = true;
    gap.resolvedByTurnId = resolvedByTurnId;
    gap.status = "resolved";
    return gap;
  }

  // ─── suppressGap ───
  suppressGap(gapId: string, reason: string): Gap {
    const gap = this.store.gaps.get(gapId);
    if (!gap) throw new Error(`Gap not found: ${gapId}`);
    if (gap.severity === "blocking") {
      throw new Error("Cannot suppress a blocking gap");
    }
    gap.status = "suppressed";
    gap.suppressedReason = reason;
    return gap;
  }

  // ─── getOpenGaps ───
  getOpenGaps(draftId: string): Gap[] {
    const result: Gap[] = [];
    for (const gap of this.store.gaps.values()) {
      if (
        gap.draftId === draftId &&
        !gap.resolved &&
        gap.status !== "suppressed"
      ) {
        result.push(gap);
      }
    }
    return result;
  }
}
