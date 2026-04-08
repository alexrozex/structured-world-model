import type {
  RawIntent,
  ElicitationSession,
  DraftIntentGraph,
  Gap,
  ElicitationTurn,
  ClarificationRequestRecord,
  ClarificationAnswerRecord,
  AdaProposal,
  SchemaConformanceResult,
  CompilationReadinessAssessment,
  HandoffRecord,
} from "./types.js";

export class ElicitationStore {
  readonly rawIntents = new Map<string, RawIntent>();
  readonly sessions = new Map<string, ElicitationSession>();
  readonly drafts = new Map<string, DraftIntentGraph>();
  readonly gaps = new Map<string, Gap>();
  readonly turns = new Map<string, ElicitationTurn>();
  readonly clarificationRequests = new Map<
    string,
    ClarificationRequestRecord
  >();
  readonly clarificationAnswers = new Map<string, ClarificationAnswerRecord>();
  readonly proposals = new Map<string, AdaProposal>();
  readonly conformanceResults = new Map<string, SchemaConformanceResult>();
  readonly assessments = new Map<string, CompilationReadinessAssessment>();
  readonly handoffs = new Map<string, HandoffRecord>();

  // Turn index counter per session
  private readonly turnCounts = new Map<string, number>();

  nextTurnIndex(sessionId: string): number {
    const current = this.turnCounts.get(sessionId) ?? 0;
    this.turnCounts.set(sessionId, current + 1);
    return current;
  }

  getTurnCount(sessionId: string): number {
    return this.turnCounts.get(sessionId) ?? 0;
  }

  // Draft lookup by sessionId
  getDraftBySession(sessionId: string): DraftIntentGraph | undefined {
    for (const draft of this.drafts.values()) {
      if (draft.sessionId === sessionId) return draft;
    }
    return undefined;
  }

  // Open turns for a session (status = awaiting_answer or needs_clarification)
  getOpenTurns(sessionId: string): ElicitationTurn[] {
    const result: ElicitationTurn[] = [];
    for (const turn of this.turns.values()) {
      if (
        turn.sessionId === sessionId &&
        (turn.status === "awaiting_answer" ||
          turn.status === "needs_clarification")
      ) {
        result.push(turn);
      }
    }
    return result;
  }

  // Open turns for a specific gapId
  getOpenTurnForGap(gapId: string): ElicitationTurn | undefined {
    for (const turn of this.turns.values()) {
      if (
        turn.gapId === gapId &&
        (turn.status === "opened" ||
          turn.status === "awaiting_answer" ||
          turn.status === "needs_clarification")
      ) {
        return turn;
      }
    }
    return undefined;
  }
}
