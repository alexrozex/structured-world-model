export { MotherCompiler, type CompileOptions } from "./engine.js";
export { SONNET, OPUS, type ModelId } from "./models.js";
export { buildGate, computeGatePassRate, type GateInput } from "./gate.js";

export {
  intentGraphSchema,
  domainContextSchema,
  entityMapSchema,
  processFlowSchema,
  blueprintSchema,
  auditReportSchema,
  governorDecisionSchema,
} from "./schemas.js";

export type {
  CompilerStageCode,
  Challenge,
  IntentGoal,
  IntentConstraint,
  IntentUnknown,
  IntentGraph,
  Stakeholder,
  DomainContext,
  EntityInvariant,
  Entity,
  EntityProperty,
  BoundedContext,
  EntityMap,
  HoareTriple,
  WorkflowStep,
  FailureMode,
  StateMachine,
  StateTransition,
  Workflow,
  ProcessFlow,
  BlueprintComponent,
  BlueprintArchitecture,
  BlueprintScope,
  NonFunctionalCategory,
  NonFunctionalRequirement,
  ResolvedConflict,
  CompilationAudit,
  Blueprint,
  SemanticDrift,
  AuditReport,
  GovernorDecisionType,
  GovernorDecision,
  PolicyViolation,
  ProvenanceGate,
  PipelineState,
  DeterminismMetadata,
  StageExecutionRecord,
  CompilationRun,
  ClarificationRequest,
  ClarificationAnswer,
  UncertaintyMarker,
  IterationRecord,
  FallbackBlueprintResult,
  CompileStatus,
  CompileResult,
  StageCompleteEvent,
  ContractScope,
  DelegationContract,
  DelegationFrame,
  FileTreeNode,
  DependencySpec,
  AcceptanceCriterion,
  BuildContract,
  SubGoalSpec,
} from "./types.js";

export { IntentAgent } from "./agents/intent.js";
export { PersonaAgent } from "./agents/persona.js";
export { EntityAgent, type EntityInput } from "./agents/entity.js";
export { ProcessAgent, type ProcessInput } from "./agents/process.js";
export {
  SynthesisAgent,
  type SynthesisInput,
  type SynthesisOutput,
} from "./agents/synthesis.js";
export { VerifyAgent, type VerifyInput } from "./agents/verify.js";
export { GovernorAgent } from "./agents/governor.js";
export { deriveBuildContract } from "./agents/bld.js";

export { analyzeCodebase, decorateWithContext } from "./context/index.js";
export type {
  CodebaseContext,
  PriorBlueprintContext,
  TypeRegistryEntry,
  TypeField,
  ConstantEntry,
  PackageBoundary,
} from "./context/index.js";

export {
  scheduleSubGoals,
  validateDependencyGraph,
} from "./subgoal-scheduler.js";

export {
  verify,
  loadBlueprintState,
  scanCodebase,
  findSymbolByName,
  searchInFiles,
  diffBlueprintAgainstCode,
  formatTerminal,
  formatMarkdown,
} from "./verify/index.js";
export type {
  VerifyOptions,
  VerificationReport,
  VerificationFinding,
  BoundedContextResult,
  ProvenanceTrace,
  FindingCategory,
  FindingSeverity,
  CodebaseSnapshot,
  CodeSymbol,
  DiffResult,
} from "./verify/index.js";
