import { randomUUID } from "node:crypto";
import type { ElicitationStore } from "./store.js";
import type {
  CompilationReadinessAssessment,
  Gap,
  ElicitationSession,
} from "./types.js";

export class ReadinessAssessor {
  constructor(private readonly store: ElicitationStore) {}

  // ─── assess ───
  // Evaluates whether the draft is ready for handoff.
  // compilationReady = schema conformance passed AND blockingGapCount === 0 AND contradictionCount === 0.
  // When compilationReady: session transitions to ready_for_handoff and terminationSignalEmitted = true.
  assess(
    sessionId: string,
    draftId: string,
    schemaConformanceResultId: string,
    gaps: Gap[],
  ): CompilationReadinessAssessment {
    const conformanceResult = this.store.conformanceResults.get(
      schemaConformanceResultId,
    );
    if (!conformanceResult) {
      throw new Error(
        `SchemaConformanceResult not found: ${schemaConformanceResultId}`,
      );
    }

    // Count open (unresolved, non-suppressed) gaps
    const openGaps = gaps.filter(
      (g) => !g.resolved && g.status !== "suppressed",
    );

    const openGapCount = openGaps.length;

    // Cross-validate against the store — guard against count bugs
    let storeOpenCount = 0;
    for (const gap of this.store.gaps.values()) {
      if (
        gap.draftId === draftId &&
        !gap.resolved &&
        gap.status !== "suppressed"
      ) {
        storeOpenCount++;
      }
    }

    if (storeOpenCount !== openGapCount) {
      // Mismatch — abort and trust the store count
      throw new Error(
        `Gap count mismatch: argument has ${openGapCount}, store has ${storeOpenCount}. ` +
          `Assessment aborted to prevent invalid termination.`,
      );
    }

    const blockingGapCount = openGaps.filter(
      (g) => g.severity === "blocking",
    ).length;

    const contradictionCount = openGaps.filter(
      (g) => g.gapKind === "contradictory",
    ).length;

    const compilationReady =
      conformanceResult.passed &&
      blockingGapCount === 0 &&
      contradictionCount === 0;

    // Invariant: terminationSignalEmitted requires compilationReady
    const terminationSignalEmitted = compilationReady;

    const assessment: CompilationReadinessAssessment = {
      assessmentId: randomUUID(),
      sessionId,
      draftId,
      schemaConformanceResultId,
      openGapCount,
      blockingGapCount,
      contradictionCount,
      compilationReady,
      terminationSignalEmitted,
      assessedAt: Date.now(),
    };

    this.store.assessments.set(assessment.assessmentId, assessment);

    // Transition session state
    const session = this.store.sessions.get(sessionId);
    if (session && compilationReady) {
      session.status = "ready_for_handoff";
      session.assessmentId = assessment.assessmentId;
    } else if (session) {
      // Keep active — unresolved blocking gaps drive next turn cycle
      session.assessmentId = assessment.assessmentId;
    }

    return assessment;
  }

  // ─── checkTerminationCondition ───
  checkTerminationCondition(assessmentId: string): boolean {
    const assessment = this.store.assessments.get(assessmentId);
    if (!assessment) throw new Error(`Assessment not found: ${assessmentId}`);
    return assessment.terminationSignalEmitted;
  }

  // ─── getAssessment ───
  getAssessment(assessmentId: string): CompilationReadinessAssessment {
    const assessment = this.store.assessments.get(assessmentId);
    if (!assessment) throw new Error(`Assessment not found: ${assessmentId}`);
    return assessment;
  }

  // ─── assessSession ───
  // Convenience: run conformance + assess in one step.
  // Used by session manager after all turns are closed.
  assessSession(session: ElicitationSession): CompilationReadinessAssessment {
    if (!session.draftIntentGraphId) {
      throw new Error(`Session ${session.sessionId} has no draftIntentGraphId`);
    }

    const draft = this.store.drafts.get(session.draftIntentGraphId);
    if (!draft) {
      throw new Error(`Draft not found: ${session.draftIntentGraphId}`);
    }

    if (!draft.schemaConformanceResultId) {
      throw new Error(
        "Schema conformance has not been run. Run runSchemaConformance first.",
      );
    }

    const openGaps: Gap[] = [];
    for (const gap of this.store.gaps.values()) {
      if (
        gap.draftId === draft.draftId &&
        !gap.resolved &&
        gap.status !== "suppressed"
      ) {
        openGaps.push(gap);
      }
    }

    return this.assess(
      session.sessionId,
      draft.draftId,
      draft.schemaConformanceResultId,
      openGaps,
    );
  }
}
