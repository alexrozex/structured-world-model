import { randomUUID } from "node:crypto";
import type { ElicitationStore } from "./store.js";
import type { GapAnalyzer } from "./gap-analyzer.js";
import type { DraftIntentGraphManager } from "./draft-manager.js";
import type { DialogueEngine } from "./dialogue-engine.js";
import type { ReadinessAssessor } from "./readiness-assessor.js";
import type { HandoffEmitter } from "./handoff-emitter.js";
import type {
  ElicitationSession,
  RawIntent,
  SessionState,
  ProposalDispositionType,
  SessionStartResult,
  TurnResult,
  Gap,
  ElicitationTurn,
  ClarificationRequestRecord,
  AdaProposal,
  LevelAssessment,
} from "./types.js";
import { classifyDepth } from "./depth-classifier.js";

const STALL_THRESHOLD = 5; // consecutive turns with no gap reduction triggers stall warning
const MAX_TURNS = 5; // axiom A5: hard cap on questions asked

export class ElicitationSessionManager {
  // Track previous open gap count per session to detect stall
  private readonly prevOpenGapCounts = new Map<string, number>();
  private readonly consecutiveNoProgress = new Map<string, number>();

  constructor(
    private readonly store: ElicitationStore,
    private readonly draftManager: DraftIntentGraphManager,
    private readonly gapAnalyzer: GapAnalyzer,
    private readonly dialogueEngine: DialogueEngine,
    private readonly readinessAssessor: ReadinessAssessor,
    private readonly handoffEmitter: HandoffEmitter,
  ) {}

  // ─── startSession ───
  // Full lifecycle init: classify depth → capture intent → init draft →
  // inject planned gaps → scan remaining gaps → open first turn.
  //
  // Fast path (0 questions): classifier determines intent is compilable as-is.
  // Skips all dialogue and emits a HandoffRecord immediately.
  // SessionStartResult.turn will be null and .handoff will be set.
  async startSession(rawIntentText: string): Promise<SessionStartResult> {
    const trimmed = rawIntentText.trim();
    if (!trimmed) {
      throw new Error(
        "Submitted text is empty or whitespace-only. Provide substantive intent.",
      );
    }

    const now = Date.now();
    const sessionId = randomUUID();

    // Step 1: capture-raw-intent
    const rawIntent: RawIntent = {
      rawIntentId: randomUUID(),
      sessionId,
      text: trimmed,
      characterCount: trimmed.length,
      capturedAt: now,
    };
    this.store.rawIntents.set(rawIntent.rawIntentId, rawIntent);

    const session: ElicitationSession = {
      sessionId,
      rawIntentId: rawIntent.rawIntentId,
      draftIntentGraphId: null,
      status: "active",
      startedAt: now,
      terminatedAt: null,
      assessmentId: null,
      handoffId: null,
    };
    this.store.sessions.set(sessionId, session);

    // Step 2: level-setting pass — assess abstraction level before gap detection
    const levelAssessment: LevelAssessment =
      await this.dialogueEngine.assessAbstractionLevel(trimmed);

    // Step 3: initialize-draft-intent-graph
    const draft = this.draftManager.initializeDraft(sessionId, trimmed);
    session.draftIntentGraphId = draft.draftId;

    // Step 4: adaptive depth classification (pure, no LLM)
    // Determines which of the axiom-derived questions are needed before compile.
    const plan = classifyDepth(trimmed);

    // ── Fast path: 0 questions ───────────────────────────────────────────────
    // Intent is compilable as-is. Skip dialogue, emit handoff immediately.
    if (plan.terminationReason === "ready") {
      const conformanceResult = this.draftManager.runSchemaConformance(
        draft.draftId,
      );
      const assessment = this.readinessAssessor.assess(
        sessionId,
        draft.draftId,
        conformanceResult.resultId,
        [],
      );
      const finalIntentGraph = this.draftManager.projectToIntentGraph(
        draft.draftId,
      );
      this.draftManager.finalizeDraft(draft.draftId);
      const handoff = this.handoffEmitter.emitHandoff(
        sessionId,
        assessment.assessmentId,
        finalIntentGraph,
      );
      return {
        session,
        draft,
        turn: null,
        clarificationRequest: null,
        proposal: null,
        levelAssessment,
        handoff,
        assessment,
      };
    }

    // Step 4.5: structural pre-fill — Ada reads intent and autonomously fills
    // everything she can derive before surfacing anything to the user.
    // High-confidence items are applied silently. Medium-confidence items
    // become proposals the user confirms or edits.
    // This is Ada's "read first" pass — parallel to Claude Code reading the
    // codebase before writing any code.
    try {
      const preFillResult = await this.dialogueEngine.preFillDraft(
        trimmed,
        draft,
      );
      for (const item of preFillResult.items) {
        if (item.confidence === "high") {
          this.draftManager.applyPreFillItem(draft.draftId, item);
        }
      }
    } catch {
      // Pre-fill is best-effort — failure must not block session start
    }

    // Step 5: inject classifier-planned gaps (axiom-aligned, ordered Q1→Q5)
    this.gapAnalyzer.injectPlannedGaps(draft.draftId, plan.questions);

    // Step 6: generic gap scan supplements planned gaps
    this.gapAnalyzer.scanForGaps(draft);
    const openGaps = this.gapAnalyzer.getOpenGaps(draft.draftId);
    const prioritized = this.gapAnalyzer.prioritizeGaps(openGaps);

    this.prevOpenGapCounts.set(sessionId, openGaps.length);

    const { turn, clarificationRequest, proposal } = await this._openNextTurn(
      session,
      prioritized,
    );

    return {
      session,
      draft,
      turn,
      clarificationRequest,
      proposal,
      levelAssessment,
    };
  }

  // ─── submitAnswer ───
  // Processes a user's answer to an open ClarificationRequest.
  // Resolves the gap, applies the mutation, rescans, and opens the next turn
  // (or runs conformance + readiness assessment if all gaps are closed).
  async submitAnswer(
    sessionId: string,
    turnId: string,
    answer: string,
  ): Promise<TurnResult> {
    const session = this._requireSession(sessionId);
    this._requireActiveSession(session);

    const turn = this.store.turns.get(turnId);
    if (!turn) throw new Error(`Turn not found: ${turnId}`);
    if (turn.status === "closed" || turn.status === "expired") {
      throw new Error(
        `Stale turn reference: turn ${turnId} is already ${turn.status}`,
      );
    }

    const draft = this._requireDraft(session);

    // Receive answer
    const answerRecord = this.dialogueEngine.receiveClarificationAnswer(
      turnId,
      answer,
    );

    // Apply mutation to draft
    const gap = this.store.gaps.get(turn.gapId);
    if (!gap) throw new Error(`Gap not found for turn: ${turn.gapId}`);

    this.draftManager.applyMutation(
      draft.draftId,
      gap.targetField,
      answerRecord.answer,
      turnId,
    );

    // Resolve gap and close turn
    this.gapAnalyzer.resolveGap(gap.gapId, turnId);
    this.dialogueEngine.closeTurn(turnId);

    // Cascade rescan
    this.gapAnalyzer.scanForGaps(draft);

    return this._advanceSession(session, turn);
  }

  // ─── submitProposalDisposition ───
  // Processes a user's disposition on an AdaProposal (accepted | modified | rejected).
  async submitProposalDisposition(
    sessionId: string,
    proposalId: string,
    disposition: ProposalDispositionType,
    modifiedText?: string,
  ): Promise<TurnResult> {
    const session = this._requireSession(sessionId);
    this._requireActiveSession(session);

    const proposal = this.store.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

    const turn = this.store.turns.get(proposal.turnId);
    if (!turn) throw new Error(`Turn not found for proposal: ${proposalId}`);

    const draft = this._requireDraft(session);
    const gap = this.store.gaps.get(proposal.gapId);
    if (!gap) throw new Error(`Gap not found: ${proposal.gapId}`);

    // Process the disposition
    this.dialogueEngine.processProposalDisposition(
      proposalId,
      disposition,
      modifiedText,
    );

    if (disposition === "accepted" || disposition === "modified") {
      const appliedText =
        disposition === "modified"
          ? (modifiedText ?? proposal.proposedText)
          : proposal.proposedText;

      // Apply the accepted/modified text as a mutation
      this.draftManager.applyMutation(
        draft.draftId,
        gap.targetField,
        appliedText,
        turn.turnId,
      );

      // Resolve gap
      this.gapAnalyzer.resolveGap(gap.gapId, turn.turnId);
      this.dialogueEngine.closeTurn(turn.turnId);

      // Cascade rescan
      this.gapAnalyzer.scanForGaps(draft);
    } else {
      // Rejected: gap remains unresolved. Escalate to ClarificationRequest.
      this.dialogueEngine.closeTurn(turn.turnId);
      gap.status = "open"; // revert to open so next prioritization picks it up
    }

    return this._advanceSession(session, turn);
  }

  // ─── getSessionState ───
  getSessionState(sessionId: string): ElicitationSession {
    return this._requireSession(sessionId);
  }

  // ─── transitionState ───
  transitionState(
    sessionId: string,
    targetState: SessionState,
  ): ElicitationSession {
    const session = this._requireSession(sessionId);
    session.status = targetState;
    if (targetState === "handed_off" || targetState === "abandoned") {
      session.terminatedAt = Date.now();
    }
    return session;
  }

  // ─── abandonSession ───
  abandonSession(sessionId: string, reason: string): ElicitationSession {
    const session = this._requireSession(sessionId);
    session.status = "abandoned";
    session.terminatedAt = Date.now();
    // Suppress unused reason in output — it's captured in the return value context
    void reason;
    return session;
  }

  // ─── _advanceSession ───
  // After a turn closes: check for more open gaps, run conformance if none,
  // assess readiness, and potentially emit handoff.
  private async _advanceSession(
    session: ElicitationSession,
    closedTurn: ElicitationTurn,
  ): Promise<TurnResult> {
    const draft = this._requireDraft(session);
    const openGaps = this.gapAnalyzer.getOpenGaps(draft.draftId);
    const prioritized = this.gapAnalyzer.prioritizeGaps(openGaps);

    // Stall detection
    const stallWarning = this._checkStall(
      session.sessionId,
      openGaps.length,
      closedTurn,
    );

    if (prioritized.length > 0) {
      // More gaps to address — open next turn
      const { turn, clarificationRequest, proposal } = await this._openNextTurn(
        session,
        prioritized,
      );

      return {
        session,
        closedTurn,
        nextTurn: turn,
        clarificationRequest,
        proposal,
        assessment: null,
        handoff: null,
        ...(stallWarning ? { stallWarning } : {}),
      };
    }

    // No open gaps — run schema conformance
    session.status = "pending_conformance_check";
    const conformanceResult = this.draftManager.runSchemaConformance(
      draft.draftId,
    );

    if (!conformanceResult.passed) {
      // Conformance failed — reactivate and create gaps from failed predicates
      session.status = "active";
      this._createGapsFromConformanceFailure(
        draft.draftId,
        conformanceResult.missingRequiredFields,
      );
      const newGaps = this.gapAnalyzer.getOpenGaps(draft.draftId);
      const nextPrioritized = this.gapAnalyzer.prioritizeGaps(newGaps);

      if (nextPrioritized.length > 0) {
        const { turn, clarificationRequest, proposal } =
          await this._openNextTurn(session, nextPrioritized);

        return {
          session,
          closedTurn,
          nextTurn: turn,
          clarificationRequest,
          proposal,
          assessment: null,
          handoff: null,
        };
      }
    }

    // Assess readiness
    const assessment = this.readinessAssessor.assessSession(session);

    if (!assessment.compilationReady) {
      // Still not ready — reactivate and open next turn for remaining gaps
      session.status = "active";
      const remainingGaps = this.gapAnalyzer.getOpenGaps(draft.draftId);
      const nextPrioritized = this.gapAnalyzer.prioritizeGaps(remainingGaps);

      if (nextPrioritized.length > 0) {
        const { turn, clarificationRequest, proposal } =
          await this._openNextTurn(session, nextPrioritized);

        return {
          session,
          closedTurn,
          nextTurn: turn,
          clarificationRequest,
          proposal,
          assessment,
          handoff: null,
        };
      }

      return {
        session,
        closedTurn,
        nextTurn: null,
        clarificationRequest: null,
        proposal: null,
        assessment,
        handoff: null,
      };
    }

    // compilationReady — emit handoff
    const finalIntentGraph = this.draftManager.projectToIntentGraph(
      draft.draftId,
    );
    this.draftManager.finalizeDraft(draft.draftId);

    const handoff = this.handoffEmitter.emitHandoff(
      session.sessionId,
      assessment.assessmentId,
      finalIntentGraph,
    );

    return {
      session,
      closedTurn,
      nextTurn: null,
      clarificationRequest: null,
      proposal: null,
      assessment,
      handoff,
    };
  }

  // ─── _openNextTurn ───
  // Selects the top gap and opens a turn with either a ClarificationRequest
  // or an AdaProposal, depending on gapKind.
  // Enforces the 5-turn hard cap (axiom A5).
  private async _openNextTurn(
    session: ElicitationSession,
    prioritizedGaps: Gap[],
  ): Promise<{
    turn: ElicitationTurn;
    clarificationRequest: ClarificationRequestRecord | null;
    proposal: AdaProposal | null;
  }> {
    // Hard cap: if we've already asked MAX_TURNS questions, force handoff.
    const turnCount = this.store.nextTurnIndex(session.sessionId);
    if (turnCount >= MAX_TURNS) {
      // Synthesize a sentinel turn so callers always get a turn object.
      // The transport adapter should detect stallWarning and surface it.
      const sentinelGap = prioritizedGaps[0];
      if (sentinelGap) {
        const turn = this.dialogueEngine.openTurn(
          session.sessionId,
          sentinelGap,
        );
        return { turn, clarificationRequest: null, proposal: null };
      }
    }

    const draft = this._requireDraft(session);

    const activeGap = prioritizedGaps[0];
    if (!activeGap) {
      throw new Error("_openNextTurn called with empty gap list");
    }

    // Idempotency: check if a turn already exists for this gap
    const existingTurn = this.store.getOpenTurnForGap(activeGap.gapId);
    if (existingTurn) {
      const req = existingTurn.clarificationRequestId
        ? (this.store.clarificationRequests.get(
            existingTurn.clarificationRequestId,
          ) ?? null)
        : null;
      const prop = existingTurn.proposalId
        ? (this.store.proposals.get(existingTurn.proposalId) ?? null)
        : null;
      return { turn: existingTurn, clarificationRequest: req, proposal: prop };
    }

    const turn = this.dialogueEngine.openTurn(session.sessionId, activeGap);

    // Ada proposes for ALL gaps — proposals are the primary path.
    // The user confirms, edits, or rejects. Questions are only a fallback
    // for when proposal generation itself fails (should be rare).
    // This is the "recognition not generation" model: Ada does the first-draft
    // work, the user is editorial.
    if (activeGap.status !== "resolved") {
      const proposal = await this.dialogueEngine.generateAdaProposal(
        activeGap,
        draft,
      );
      if (proposal) {
        this.dialogueEngine.linkProposalToTurn(
          turn.turnId,
          proposal.proposalId,
        );
        return { turn, clarificationRequest: null, proposal };
      }
    }

    // Fallback: emit a ClarificationRequest (when proposal generation failed)
    const request = await this.dialogueEngine.generateClarificationRequest(
      activeGap,
      draft,
    );
    this.dialogueEngine.linkRequestToTurn(
      turn.turnId,
      request.clarificationRequestId,
    );

    return { turn, clarificationRequest: request, proposal: null };
  }

  // ─── _checkStall ───
  // Returns a stall warning message if N consecutive turns produced no gap reduction.
  private _checkStall(
    sessionId: string,
    currentOpenCount: number,
    _closedTurn: ElicitationTurn,
  ): string | undefined {
    const prev = this.prevOpenGapCounts.get(sessionId);
    const noProgress = prev !== undefined && currentOpenCount >= prev;

    if (noProgress) {
      const consecutive = (this.consecutiveNoProgress.get(sessionId) ?? 0) + 1;
      this.consecutiveNoProgress.set(sessionId, consecutive);
      this.prevOpenGapCounts.set(sessionId, currentOpenCount);

      if (consecutive >= STALL_THRESHOLD) {
        return (
          `Stall detected: ${consecutive} consecutive turns with no gap reduction. ` +
          `${currentOpenCount} gap(s) remain open. ` +
          `You may force a handoff using signalSessionCommand('force-handoff') — ` +
          `open gaps will be documented in the HandoffRecord.`
        );
      }
    } else {
      this.consecutiveNoProgress.set(sessionId, 0);
      this.prevOpenGapCounts.set(sessionId, currentOpenCount);
    }

    return undefined;
  }

  // ─── _createGapsFromConformanceFailure ───
  // Creates blocking gaps for fields listed as missing in a failed conformance result.
  private _createGapsFromConformanceFailure(
    draftId: string,
    missingFields: string[],
  ): void {
    const now = Date.now();
    const knownFields = [
      "goals",
      "constraints",
      "unknowns",
      "challenges",
    ] as const;

    for (const field of missingFields) {
      const targetField = knownFields.find((f) => field.includes(f));
      if (!targetField) continue;

      // Check for existing open gap
      let exists = false;
      for (const g of this.store.gaps.values()) {
        if (
          g.draftId === draftId &&
          g.targetField === targetField &&
          g.gapKind === "missing" &&
          !g.resolved &&
          g.status !== "suppressed"
        ) {
          exists = true;
          break;
        }
      }

      if (!exists) {
        const gap = {
          gapId: randomUUID(),
          draftId,
          targetField,
          gapKind: "missing" as const,
          severity: "blocking" as const,
          status: "open" as const,
          detectedAt: now,
          resolved: false,
          resolvedByTurnId: null,
          suppressedReason: null,
        };
        this.store.gaps.set(gap.gapId, gap);
      }
    }
  }

  // ─── helpers ───

  private _requireSession(sessionId: string): ElicitationSession {
    const session = this.store.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private _requireActiveSession(session: ElicitationSession): void {
    if (session.status === "handed_off" || session.status === "abandoned") {
      throw new Error(
        `Session ${session.sessionId} is in terminal state: ${session.status}`,
      );
    }
  }

  private _requireDraft(session: ElicitationSession) {
    if (!session.draftIntentGraphId) {
      throw new Error(`Session ${session.sessionId} has no draftIntentGraphId`);
    }
    const draft = this.store.drafts.get(session.draftIntentGraphId);
    if (!draft) {
      throw new Error(`Draft not found: ${session.draftIntentGraphId}`);
    }
    return draft;
  }
}
