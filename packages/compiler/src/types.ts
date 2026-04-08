import type { PostcodeAddress, ManifoldState } from "@swm/provenance";

// ─── Stage Codes ───

export type CompilerStageCode =
  | "CTX"
  | "INT"
  | "PER"
  | "ENT"
  | "PRO"
  | "SYN"
  | "VER"
  | "GOV"
  | "BLD";

// ─── Challenge ───

export interface Challenge {
  readonly id: string;
  readonly description: string;
  readonly severity: "blocking" | "major" | "minor";
  readonly resolved: boolean;
}

// ─── Token Usage ───

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

// ─── Intent Agent Output ───

export interface IntentGoal {
  readonly id: string;
  readonly description: string;
  readonly type: "stated" | "derived" | "implied" | "unstated";
}

export interface IntentConstraint {
  readonly id: string;
  readonly description: string;
  readonly source: "explicit" | "derived" | "domain";
}

export interface IntentUnknown {
  readonly id: string;
  readonly description: string;
  readonly impact: "blocking" | "scoping" | "implementation";
}

export interface IntentGraph {
  readonly goals: readonly IntentGoal[];
  readonly constraints: readonly IntentConstraint[];
  readonly unknowns: readonly IntentUnknown[];
  readonly challenges: readonly Challenge[];
  readonly rawIntent: string;
  readonly postcode: PostcodeAddress;
}

// ─── Persona Agent Output ───

export interface Stakeholder {
  readonly role: string;
  readonly knowledgeBase: readonly string[];
  readonly blindSpots: readonly string[];
  readonly vocabulary: Record<string, string>;
  readonly fearSet: readonly string[];
}

export interface DomainContext {
  readonly domain: string;
  readonly stakeholders: readonly Stakeholder[];
  readonly ubiquitousLanguage: Record<string, string>;
  readonly excludedConcerns: readonly string[];
  readonly challenges: readonly Challenge[];
  readonly postcode: PostcodeAddress;
}

// ─── Entity Agent Output ───

export interface EntityInvariant {
  readonly predicate: string;
  readonly description: string;
}

export interface Entity {
  readonly name: string;
  readonly category: "substance" | "quality" | "relation" | "event" | "state";
  readonly properties: readonly EntityProperty[];
  readonly invariants: readonly EntityInvariant[];
}

export interface EntityProperty {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface BoundedContext {
  readonly name: string;
  readonly rootEntity: string;
  readonly entities: readonly string[];
  readonly invariants: readonly EntityInvariant[];
}

export interface EntityMap {
  readonly entities: readonly Entity[];
  readonly boundedContexts: readonly BoundedContext[];
  readonly challenges: readonly Challenge[];
  readonly postcode: PostcodeAddress;
}

// ─── Process Agent Output ───

export interface HoareTriple {
  readonly precondition: string;
  readonly action: string;
  readonly postcondition: string;
}

export interface WorkflowStep {
  readonly name: string;
  readonly hoareTriple: HoareTriple;
  readonly failureModes: readonly FailureMode[];
  /** Set by SYN stage when the step can be attributed to a specific context. */
  readonly boundedContext?: string;
  readonly temporalRelation:
    | "enables"
    | "requires"
    | "concurrent"
    | "compensates"
    | "guards";
}

export interface FailureMode {
  readonly class: "precondition" | "action" | "postcondition";
  readonly description: string;
  readonly handler: string;
}

export interface StateMachine {
  readonly entity: string;
  readonly states: readonly string[];
  readonly transitions: readonly StateTransition[];
}

export interface StateTransition {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
  readonly guard: string;
}

export interface Workflow {
  readonly name: string;
  readonly trigger: string;
  readonly steps: readonly WorkflowStep[];
}

export interface ProcessFlow {
  readonly workflows: readonly Workflow[];
  readonly stateMachines: readonly StateMachine[];
  readonly challenges: readonly Challenge[];
  readonly postcode: PostcodeAddress;
}

// ─── Synthesis Agent Output ───

export interface BlueprintComponent {
  readonly name: string;
  readonly responsibility: string;
  readonly interfaces: readonly string[];
  readonly dependencies: readonly string[];
  readonly boundedContext: string;
}

// A bounded context promoted to a compilable sub-goal unit.
// Each SubGoalSpec can be passed as intent to a fresh MotherCompiler run.
export interface SubGoalSpec {
  readonly name: string; // bounded context name, e.g. "compilation-pipeline"
  readonly derivedIntent: string; // synthesized intent for this context only
  readonly entities: readonly string[]; // entity names belonging to this context
  readonly workflows: readonly string[]; // workflow names belonging to this context
  readonly invariants: readonly string[]; // predicate strings only, e.g. "payment.amount > 0"
  readonly dependsOn: readonly string[]; // names of subGoals that must complete before this one
  readonly compilable: true; // discriminant — always true
}

export interface BlueprintArchitecture {
  readonly pattern: string;
  readonly rationale: string;
  readonly components: readonly BlueprintComponent[];
}

export interface ResolvedConflict {
  readonly entity: string;
  readonly process: string;
  readonly resolution: string;
  readonly authoritative: "entity" | "process";
}

export interface BlueprintScope {
  readonly inScope: readonly string[];
  readonly outOfScope: readonly string[];
  readonly assumptions: readonly string[];
}

export type NonFunctionalCategory =
  | "performance"
  | "security"
  | "scalability"
  | "reliability"
  | "maintainability"
  | "compliance"
  | "observability";

export interface NonFunctionalRequirement {
  readonly category: NonFunctionalCategory;
  readonly requirement: string;
  readonly predicate?: string; // formal predicate — generates a hook if present
  readonly scope: string; // bounded context name, or "global"
  readonly verification: string; // how to confirm this is met
}

// ─── Compilation Audit ───

export interface CompilationAudit {
  readonly coverageScore: number;
  readonly coherenceScore: number;
  readonly gatePassRate: number;
  readonly iterationCount: number;
  readonly governorDecision: GovernorDecisionType;
  readonly confidence: number;
  readonly driftCount: number;
  readonly gapCount: number;
  readonly violationCount: number;
}

export interface Blueprint {
  readonly summary: string;
  readonly scope: BlueprintScope;
  readonly architecture: BlueprintArchitecture;
  readonly dataModel: EntityMap;
  readonly processModel: ProcessFlow;
  readonly nonFunctional: readonly NonFunctionalRequirement[];
  readonly openQuestions: readonly string[];
  readonly resolvedConflicts: readonly ResolvedConflict[];
  readonly challenges: readonly Challenge[];
  readonly subGoals?: readonly SubGoalSpec[]; // set by SYN stage, absent if no bounded contexts
  readonly audit?: CompilationAudit; // set post-GOV, absent during pipeline
  readonly build?: BuildContract; // set post-BLD, absent during pipeline
  readonly postcode: PostcodeAddress;
}

// ─── BLD Stage — Build Contract ───

export interface FileTreeNode {
  readonly path: string; // relative to project root, e.g. "src/identity/password-hasher.ts"
  readonly type: "file" | "directory";
  readonly purpose: string; // one-line description of what this path contains
  readonly componentName?: string; // which BlueprintComponent owns this file
  readonly boundedContext?: string; // which bounded context it belongs to
}

export interface DependencySpec {
  readonly componentName: string;
  readonly packages: readonly string[]; // npm package names, no versions
  readonly devPackages: readonly string[]; // dev-only npm packages
}

export interface AcceptanceCriterion {
  readonly boundedContext: string;
  readonly criterion: string; // "Done when [actor] can [action]"
  readonly sourceWorkflow: string; // which workflow this was derived from
}

export interface BuildContract {
  readonly stack: string; // e.g. "nextjs-prisma-postgres"
  readonly stackLabel: string; // e.g. "Next.js + Prisma + PostgreSQL"
  readonly fileTree: readonly FileTreeNode[];
  readonly dependencies: readonly DependencySpec[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly gatePass: boolean; // true only when all fields are total (non-empty)
  readonly postcode: PostcodeAddress;
}

// ─── Verify Agent Output ───

export interface SemanticDrift {
  readonly location: string;
  readonly original: string;
  readonly actual: string;
  readonly severity: "critical" | "major" | "minor";
}

export interface AuditReport {
  readonly coverageScore: number;
  readonly coherenceScore: number;
  readonly drifts: readonly SemanticDrift[];
  readonly gaps: readonly string[];
  readonly passed: boolean;
  readonly challenges: readonly Challenge[];
  readonly postcode: PostcodeAddress;
}

// ─── Governor Agent Output ───

export type GovernorDecisionType = "ACCEPT" | "REJECT" | "ITERATE";

export interface PolicyViolation {
  readonly stageCode: CompilerStageCode;
  readonly ruleViolated: string;
  readonly description: string;
  readonly severity: "critical" | "major" | "minor";
}

export interface GovernorDecision {
  readonly decision: GovernorDecisionType;
  readonly confidence: number;
  readonly coverageScore: number;
  readonly coherenceScore: number;
  readonly gatePassRate: number;
  readonly provenanceIntact: boolean;
  readonly rejectionReasons: readonly string[];
  readonly violations: readonly PolicyViolation[];
  readonly nextAction: string | null;
  readonly challenges: readonly Challenge[];
  readonly postcode: PostcodeAddress;
}

// ─── Determinism & Compilation Run ───

export interface DeterminismMetadata {
  readonly modelId: string;
  readonly temperature: number;
  readonly extendedThinking: boolean;
  readonly maxTokens: number;
  readonly retryCount: number;
  readonly callDurationMs: number;
  readonly tokensUsed?: TokenUsage;
}

export interface StageExecutionRecord {
  readonly stageCode: CompilerStageCode;
  readonly metadata: DeterminismMetadata;
  readonly postcode: PostcodeAddress;
}

export interface CompilationRun {
  readonly runId: string;
  readonly sourceIntent: string;
  readonly stages: readonly StageExecutionRecord[];
  readonly startedAt: number;
  readonly completedAt: number;
  readonly totalDurationMs: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
}

// ─── Pipeline State ───

export interface ProvenanceGate {
  readonly fromPostcode: string;
  readonly toPostcode: string;
  readonly entropyEstimate: number;
  readonly passed: boolean;
  readonly challenges: readonly Challenge[];
  readonly timestamp: number;
}

export interface PipelineState {
  readonly intent: IntentGraph | null;
  readonly persona: DomainContext | null;
  readonly entity: EntityMap | null;
  readonly process: ProcessFlow | null;
  readonly synthesis: Blueprint | null;
  readonly verify: AuditReport | null;
  readonly governor: GovernorDecision | null;
  readonly gates: Record<string, ProvenanceGate>;
  readonly cumulativeEntropy: number;
  readonly manifoldState?: ManifoldState;
}

// ─── Clarification ───

export interface ClarificationRequest {
  readonly unknownId: string;
  readonly question: string;
  readonly impact: "blocking" | "scoping" | "implementation";
  readonly suggestedDefault: string | null;
}

export interface ClarificationAnswer {
  readonly unknownId: string;
  readonly answer: string;
}

// ─── Fallback Blueprint ───

export interface UncertaintyMarker {
  readonly stageCode: CompilerStageCode;
  readonly description: string;
  readonly confidence: number;
}

export interface IterationRecord {
  readonly iterationNumber: number;
  readonly governorDecision: GovernorDecision;
  readonly coverageScore: number;
  readonly coherenceScore: number;
  readonly gatePassRate: number;
  readonly blueprint: Blueprint;
}

export interface FallbackBlueprintResult {
  readonly partialBlueprint: Blueprint;
  readonly uncertaintyMarkers: readonly UncertaintyMarker[];
  readonly iterationHistory: readonly IterationRecord[];
  readonly bestIterationIndex: number;
}

// ─── Compile Result ───

export type CompileStatus = "accepted" | "rejected" | "iterating" | "halted";

export interface CompileResult {
  readonly blueprint: Blueprint;
  readonly governorDecision: GovernorDecision;
  readonly pipelineState: PipelineState;
  readonly manifoldState: ManifoldState;
  readonly status: CompileStatus;
  readonly iterationCount: number;
  readonly compilationRun: CompilationRun;
  readonly fallback: FallbackBlueprintResult | null;
}

// ─── Delegation Contracts ───

export interface ContractScope {
  readonly boundedContext: string;
  readonly allowedPathGlobs: readonly string[]; // e.g. ["src/payments/**", "packages/payments/**"]
  readonly forbiddenPathGlobs: readonly string[]; // explicit exclusions
  readonly allowedTools: readonly string[]; // tool names permitted
}

export interface DelegationContract {
  readonly context: string; // bounded context name — unique key
  readonly componentName: string; // blueprint component this covers
  readonly scope: ContractScope;
  readonly stopConditions: readonly string[]; // when agent MUST report up, not continue
  readonly requiredEvidence: readonly string[]; // what the agent must produce before returning
  readonly reportingCadence: "on-completion" | "after-each-step" | "on-failure";
  readonly maxRecursionDepth: number; // 0 = leaf, cannot spawn child agents
  readonly inheritedPermissions: readonly string[]; // Ada permission tokens allowed
  readonly compiledAt: number;
  readonly blueprintPostcode: string;
}

// ─── Delegation Stack (runtime) ───

export interface DelegationFrame {
  readonly agentId: string;
  readonly context: string;
  readonly enteredAt: number;
  readonly depth: number; // 0-indexed: root orchestrator is depth 0
}

// ─── Stage Complete Callback ───

export interface StageCompleteEvent {
  readonly stage: CompilerStageCode;
  readonly postcode: PostcodeAddress;
  readonly entropyEstimate: number;
  readonly challenges: readonly Challenge[];
}
