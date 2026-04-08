import type { IntentGraph } from "@swm/compiler";
import type { PostcodeAddress } from "@swm/provenance";
import type { QuestionType } from "./depth-classifier.js";
export type { QuestionType };

// ─── Session State Machine ───

export type SessionState =
  | "awaiting_intent"
  | "active"
  | "pending_conformance_check"
  | "ready_for_handoff"
  | "handed_off"
  | "abandoned";

export type DraftState =
  | "shell"
  | "draft"
  | "conformance_pending"
  | "conformance_passed"
  | "conformance_failed"
  | "finalized";

export type GapKind = "missing" | "ambiguous" | "contradictory";
export type GapSeverity = "blocking" | "high" | "low";
export type GapState = "open" | "active" | "resolved" | "suppressed";

export type TurnState =
  | "opened"
  | "awaiting_answer"
  | "needs_clarification"
  | "answered"
  | "closed"
  | "expired";

export type ProposalDispositionType =
  | "pending"
  | "accepted"
  | "modified"
  | "rejected";

export type SessionCommand = "abandon" | "force-handoff";

export type DraftTargetField =
  | "goals"
  | "constraints"
  | "unknowns"
  | "challenges";

// ─── RawIntent ───

export interface RawIntent {
  readonly rawIntentId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly characterCount: number;
  readonly capturedAt: number;
}

// ─── ElicitationSession ───

export interface ElicitationSession {
  readonly sessionId: string;
  rawIntentId: string | null;
  draftIntentGraphId: string | null;
  status: SessionState;
  readonly startedAt: number;
  terminatedAt: number | null;
  assessmentId: string | null;
  handoffId: string | null;
}

// ─── DraftIntentGraph field items ───

export interface DraftGoal {
  readonly id: string;
  readonly description: string;
  readonly type: "stated" | "derived" | "implied" | "unstated";
  readonly confidence: "low" | "high";
  readonly sourceTurnId: string | null;
}

export interface DraftConstraint {
  readonly id: string;
  readonly description: string;
  readonly source: "explicit" | "derived" | "domain";
  readonly confidence: "low" | "high";
  readonly sourceTurnId: string | null;
}

export interface DraftUnknown {
  readonly id: string;
  readonly description: string;
  readonly impact: "blocking" | "scoping" | "implementation";
  readonly confidence: "low" | "high";
  readonly sourceTurnId: string | null;
}

export interface DraftChallenge {
  readonly id: string;
  readonly description: string;
  readonly severity: "blocking" | "major" | "minor";
  readonly resolved: boolean;
  readonly sourceTurnId: string | null;
}

// ─── DraftIntentGraph ───

export interface DraftIntentGraph {
  readonly draftId: string;
  readonly sessionId: string;
  readonly rawIntent: string;
  goals: DraftGoal[];
  constraints: DraftConstraint[];
  unknowns: DraftUnknown[];
  challenges: DraftChallenge[];
  revisionCount: number;
  lastModifiedAt: number;
  status: DraftState;
  schemaConformanceResultId: string | null;
}

// ─── Gap ───

export interface Gap {
  readonly gapId: string;
  readonly draftId: string;
  readonly targetField: DraftTargetField;
  readonly gapKind: GapKind;
  readonly severity: GapSeverity;
  status: GapState;
  readonly detectedAt: number;
  resolved: boolean;
  resolvedByTurnId: string | null;
  suppressedReason: string | null;
  readonly conflictingFieldA?: string;
  readonly conflictingFieldB?: string;
  // Set by adaptive depth classifier — overrides generic question generation
  // with an axiom-aligned targeted prompt.
  readonly questionHint?: QuestionType;
}

// ─── ClarificationRequestRecord ───

export interface ClarificationRequestRecord {
  readonly clarificationRequestId: string;
  readonly unknownId: string; // = gapId — the "unknown" this request targets
  readonly gapId: string;
  readonly question: string;
  readonly impact: "blocking" | "scoping" | "implementation";
  readonly suggestedDefault: string | null;
  readonly createdAt: number;
}

// ─── ClarificationAnswerRecord ───

export interface ClarificationAnswerRecord {
  readonly clarificationAnswerId: string;
  readonly unknownId: string;
  readonly turnId: string;
  readonly answer: string;
  readonly receivedAt: number;
}

// ─── AdaProposal ───

export interface AdaProposal {
  readonly proposalId: string;
  readonly gapId: string;
  readonly turnId: string;
  readonly proposedText: string;
  readonly rationale: string;
  readonly targetField: DraftTargetField;
  disposition: ProposalDispositionType;
  modifiedText: string | null;
  readonly createdAt: number;
}

// ─── ElicitationTurn ───

export interface ElicitationTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly gapId: string;
  readonly turnIndex: number;
  status: TurnState;
  clarificationRequestId: string | null;
  proposalId: string | null;
  clarificationAnswerId: string | null;
  readonly openedAt: number;
  closedAt: number | null;
}

// ─── SchemaConformanceResult ───

export interface SchemaConformanceResult {
  readonly resultId: string;
  readonly draftId: string;
  readonly revisionCount: number;
  readonly passed: boolean;
  readonly failedPredicates: string[];
  readonly missingRequiredFields: string[];
  readonly evaluatedAt: number;
}

// ─── CompilationReadinessAssessment ───

export interface CompilationReadinessAssessment {
  readonly assessmentId: string;
  readonly sessionId: string;
  readonly draftId: string;
  readonly schemaConformanceResultId: string;
  readonly openGapCount: number;
  readonly blockingGapCount: number;
  readonly contradictionCount: number;
  readonly compilationReady: boolean;
  readonly terminationSignalEmitted: boolean;
  readonly assessedAt: number;
}

// ─── HandoffRecord ───

export interface HandoffRecord {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly assessmentId: string;
  readonly finalIntentGraph: IntentGraph;
  readonly postcode: PostcodeAddress;
  readonly targetPipelineStage: "INT\u2192GOV";
  readonly emittedAt: number;
  readonly turnCount: number;
}

// ─── ProposalDisposition (user input) ───

export interface ProposalDisposition {
  readonly proposalId: string;
  readonly disposition: ProposalDispositionType;
  readonly modifiedText?: string;
}

// ─── Session orchestration results ───

export interface LevelAssessment {
  readonly level: "too_technical" | "too_vague" | "appropriate";
  readonly coaching: string | null;
}

export interface SessionStartResult {
  readonly session: ElicitationSession;
  readonly draft: DraftIntentGraph;
  // null when the adaptive depth classifier determines 0 questions are needed
  // and the session fast-paths directly to handoff.
  readonly turn: ElicitationTurn | null;
  readonly clarificationRequest: ClarificationRequestRecord | null;
  readonly proposal: AdaProposal | null;
  readonly levelAssessment: LevelAssessment;
  // Set on 0-question fast path — session is already complete at start.
  readonly handoff?: HandoffRecord | null;
  readonly assessment?: CompilationReadinessAssessment | null;
}

export interface TurnResult {
  readonly session: ElicitationSession;
  readonly closedTurn: ElicitationTurn;
  readonly nextTurn: ElicitationTurn | null;
  readonly clarificationRequest: ClarificationRequestRecord | null;
  readonly proposal: AdaProposal | null;
  readonly assessment: CompilationReadinessAssessment | null;
  readonly handoff: HandoffRecord | null;
  readonly stallWarning?: string;
}

export interface LLMProposalOutput {
  readonly proposedText: string;
  readonly rationale: string;
}

export interface LLMRequestOutput {
  readonly question: string;
  readonly impact: "blocking" | "scoping" | "implementation";
  readonly suggestedDefault: string | null;
}

// ─── PreFill ───

export interface PreFillItem {
  readonly targetField: DraftTargetField;
  readonly value: string;
  readonly rationale: string;
  // "high" → applied silently to the draft; "medium" → surfaces as proposal for user confirmation
  readonly confidence: "high" | "medium";
}

export interface PreFillResult {
  readonly items: readonly PreFillItem[];
  readonly derivedAt: number;
}
