export type {
  SessionState,
  DraftState,
  GapKind,
  GapSeverity,
  GapState,
  TurnState,
  ProposalDispositionType,
  SessionCommand,
  DraftTargetField,
  RawIntent,
  ElicitationSession,
  DraftGoal,
  DraftConstraint,
  DraftUnknown,
  DraftChallenge,
  DraftIntentGraph,
  Gap,
  ClarificationRequestRecord,
  ClarificationAnswerRecord,
  AdaProposal,
  ElicitationTurn,
  SchemaConformanceResult,
  CompilationReadinessAssessment,
  HandoffRecord,
  ProposalDisposition,
  SessionStartResult,
  TurnResult,
  LLMProposalOutput,
  LLMRequestOutput,
  QuestionType,
} from "./types.js";

export type { PlannedQuestion, ElicitationPlan } from "./depth-classifier.js";
export { classifyDepth } from "./depth-classifier.js";

export { ElicitationStore } from "./store.js";
export { GapAnalyzer } from "./gap-analyzer.js";
export { DraftIntentGraphManager } from "./draft-manager.js";
export { DialogueEngine } from "./dialogue-engine.js";
export { ReadinessAssessor } from "./readiness-assessor.js";
export { HandoffEmitter } from "./handoff-emitter.js";
export { ElicitationSessionManager } from "./session-manager.js";
export { ElicitationTransportAdapter } from "./transport-adapter.js";

// ─── createElicitationSession ───
// Factory function — wires all components together and returns a ready
// ElicitationSessionManager. Callers use this instead of constructing
// components manually.

import { ElicitationStore } from "./store.js";
import { GapAnalyzer } from "./gap-analyzer.js";
import { DraftIntentGraphManager } from "./draft-manager.js";
import { DialogueEngine } from "./dialogue-engine.js";
import { ReadinessAssessor } from "./readiness-assessor.js";
import { HandoffEmitter } from "./handoff-emitter.js";
import { ElicitationSessionManager } from "./session-manager.js";

export function createElicitationSessionManager(): ElicitationSessionManager {
  const store = new ElicitationStore();
  const gapAnalyzer = new GapAnalyzer(store);
  const draftManager = new DraftIntentGraphManager(store);
  const dialogueEngine = new DialogueEngine(store, gapAnalyzer);
  const readinessAssessor = new ReadinessAssessor(store);
  const handoffEmitter = new HandoffEmitter(store);

  return new ElicitationSessionManager(
    store,
    draftManager,
    gapAnalyzer,
    dialogueEngine,
    readinessAssessor,
    handoffEmitter,
  );
}
