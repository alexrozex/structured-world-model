import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// LLM OUTPUT SCHEMAS
// These schemas validate probabilistic output. They must be FORGIVING.
// Strict enums → accept any string with fallback.
// Required arrays → default to [].
// Nested objects → accept strings and coerce.
// ═══════════════════════════════════════════════════════════════════════════════

// Helpers for forgiving enums — accept the canonical values but don't reject others
function forgivingEnum<T extends string>(
  values: readonly [T, ...T[]],
  fallback: T,
) {
  return z.string().transform((val) => {
    const lower = val.toLowerCase();
    const match = values.find((v) => v.toLowerCase() === lower);
    return (match ?? fallback) as T;
  });
}

// Challenge: accept almost anything and coerce to {id, description, severity, resolved}
const challengeSchema = z.any().transform((val) => {
  if (typeof val === "string") {
    return {
      id: "CH0",
      description: val,
      severity: "minor" as const,
      resolved: false,
    };
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const desc = String(
      obj["description"] ??
        obj["message"] ??
        obj["text"] ??
        obj["name"] ??
        JSON.stringify(val),
    );
    const sev = String(obj["severity"] ?? "minor").toLowerCase();
    const severity = (
      ["blocking", "major", "minor"].includes(sev) ? sev : "minor"
    ) as "blocking" | "major" | "minor";
    const resolved = obj["resolved"] === true || obj["resolved"] === "true";
    return {
      id: String(obj["id"] ?? "CH0"),
      description: desc,
      severity,
      resolved,
    };
  }
  return {
    id: "CH0",
    description: String(val),
    severity: "minor" as const,
    resolved: false,
  };
});

// ─── Intent ───

const intentGoalSchema = z.object({
  id: z.string().default("G0"),
  description: z.string(),
  type: forgivingEnum(["stated", "derived", "implied", "unstated"], "derived"),
});

const intentConstraintSchema = z.object({
  id: z.string().default("C0"),
  description: z.string(),
  source: forgivingEnum(["explicit", "derived", "domain"], "derived"),
});

const intentUnknownSchema = z.object({
  id: z.string().default("U0"),
  description: z.string(),
  impact: forgivingEnum(["blocking", "scoping", "implementation"], "scoping"),
});

export const intentGraphSchema = z.object({
  goals: z.array(intentGoalSchema),
  constraints: z.array(intentConstraintSchema).default([]),
  unknowns: z.array(intentUnknownSchema).default([]),
  challenges: z.array(challengeSchema).default([]),
  rawIntent: z.string().default(""),
});

// ─── Persona ───

const stakeholderSchema = z.object({
  role: z.string(),
  knowledgeBase: z.array(z.string()).default([]),
  blindSpots: z.array(z.string()).default([]),
  vocabulary: z.record(z.string()).default({}),
  fearSet: z.array(z.string()).default([]),
});

export const domainContextSchema = z.object({
  domain: z.string(),
  stakeholders: z.array(stakeholderSchema).default([]),
  ubiquitousLanguage: z.record(z.string()).default({}),
  excludedConcerns: z.array(z.string()).default([]),
  challenges: z.array(challengeSchema).default([]),
});

// ─── Entity ───

const entityPropertySchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(true),
});

const entityInvariantSchema = z.union([
  z.object({
    predicate: z.string(),
    description: z.string(),
  }),
  z.string().transform((s) => ({
    predicate: s,
    description: s,
  })),
]);

const entitySchema = z.object({
  name: z.string(),
  category: forgivingEnum(
    ["substance", "quality", "relation", "event", "state"],
    "substance",
  ),
  properties: z.array(entityPropertySchema).default([]),
  invariants: z.array(entityInvariantSchema).default([]),
});

const boundedContextSchema = z.object({
  name: z.string(),
  rootEntity: z.string(),
  entities: z.array(z.string()),
  invariants: z.array(entityInvariantSchema).default([]),
});

export const entityMapSchema = z.object({
  entities: z.array(entitySchema),
  boundedContexts: z.array(boundedContextSchema).default([]),
  challenges: z.array(challengeSchema).default([]),
});

// ─── Process ───

const failureModeSchema = z.object({
  class: forgivingEnum(["precondition", "action", "postcondition"], "action"),
  description: z.string(),
  handler: z.string().default("throw"),
});

const hoareTripleSchema = z.object({
  precondition: z.string(),
  action: z.string(),
  postcondition: z.string(),
});

const workflowStepSchema = z.object({
  name: z.string(),
  hoareTriple: hoareTripleSchema,
  failureModes: z.array(failureModeSchema).default([]),
  temporalRelation: forgivingEnum(
    ["enables", "requires", "concurrent", "compensates", "guards"],
    "enables",
  ),
  /** Optional: set by SYN stage to enable direct context-based assignment. */
  boundedContext: z.string().optional(),
});

const stateTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  guard: z.string().default("true"),
});

const stateMachineSchema = z.object({
  entity: z.string(),
  states: z.array(z.string()),
  transitions: z.array(stateTransitionSchema).default([]),
});

const workflowSchema = z.object({
  name: z.string(),
  trigger: z.string(),
  steps: z.array(workflowStepSchema),
});

export const processFlowSchema = z.object({
  workflows: z.array(workflowSchema),
  stateMachines: z.array(stateMachineSchema).default([]),
  challenges: z.array(challengeSchema).default([]),
});

// ─── Synthesis (Blueprint) ───

const subGoalSchema = z.object({
  name: z.string(),
  derivedIntent: z.string(),
  entities: z.array(z.string()),
  workflows: z.array(z.string()),
  invariants: z.array(z.string()),
  dependsOn: z.array(z.string()).default([]),
  compilable: z.literal(true),
});

const blueprintComponentSchema = z.object({
  name: z.string(),
  responsibility: z.string(),
  interfaces: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  boundedContext: z.string(),
});

const blueprintArchitectureSchema = z.object({
  pattern: z.string(),
  rationale: z.string(),
  components: z.array(blueprintComponentSchema),
});

// resolvedConflicts: accept objects OR strings
const resolvedConflictSchema = z.union([
  z.object({
    entity: z.string(),
    process: z.string(),
    resolution: z.string(),
    authoritative: z.string().default("entity"),
  }),
  z.string().transform((s) => ({
    entity: s,
    process: s,
    resolution: s,
    authoritative: "entity" as const,
  })),
]);

// openQuestions: accept strings OR objects
const openQuestionItem = z.union([
  z.string(),
  z
    .object({ id: z.string().optional(), description: z.string() })
    .transform((obj) => obj.description),
  z.object({ question: z.string() }).transform((obj) => obj.question),
  z.record(z.unknown()).transform((obj) => JSON.stringify(obj)),
]);

// scope: accept object or fall back to empty arrays
const blueprintScopeSchema = z
  .object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
  })
  .default({ inScope: [], outOfScope: [], assumptions: [] });

const nonFunctionalCategoryValues = [
  "performance",
  "security",
  "scalability",
  "reliability",
  "maintainability",
  "compliance",
  "observability",
] as const;

// nonFunctional: accept structured objects OR legacy strings, coerce to NonFunctionalRequirement
const nonFunctionalRequirementSchema = z.any().transform((val) => {
  if (typeof val === "string") {
    return {
      category: "maintainability" as const,
      requirement: val,
      predicate: undefined,
      scope: "global",
      verification: val,
    };
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const rawCat = String(obj["category"] ?? "maintainability").toLowerCase();
    const category = (
      nonFunctionalCategoryValues.includes(rawCat as never)
        ? rawCat
        : "maintainability"
    ) as (typeof nonFunctionalCategoryValues)[number];
    return {
      category,
      requirement: String(obj["requirement"] ?? obj["description"] ?? val),
      predicate:
        obj["predicate"] != null ? String(obj["predicate"]) : undefined,
      scope: String(obj["scope"] ?? "global"),
      verification: String(obj["verification"] ?? obj["requirement"] ?? val),
    };
  }
  return {
    category: "maintainability" as const,
    requirement: String(val),
    predicate: undefined,
    scope: "global",
    verification: String(val),
  };
});

export const blueprintSchema = z.object({
  summary: z.string(),
  scope: blueprintScopeSchema,
  architecture: blueprintArchitectureSchema,
  nonFunctional: z.array(nonFunctionalRequirementSchema).default([]),
  openQuestions: z.array(openQuestionItem).default([]),
  resolvedConflicts: z.array(resolvedConflictSchema).default([]),
  challenges: z.array(challengeSchema).default([]),
  subGoals: z.array(subGoalSchema).default([]),
});

// ─── Verify ───

// Drifts: accept anything, coerce to {location, original, actual, severity}
const semanticDriftSchema = z.any().transform((val) => {
  if (typeof val === "string") {
    return {
      location: "unknown",
      original: val,
      actual: val,
      severity: "minor" as const,
    };
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    return {
      location: String(obj["location"] ?? "unknown"),
      original: String(
        obj["original"] ?? obj["expected"] ?? obj["description"] ?? "",
      ),
      actual: String(obj["actual"] ?? obj["found"] ?? obj["description"] ?? ""),
      severity: (["critical", "major", "minor"].includes(
        String(obj["severity"] ?? "").toLowerCase(),
      )
        ? String(obj["severity"]).toLowerCase()
        : "minor") as "critical" | "major" | "minor",
    };
  }
  return {
    location: "unknown",
    original: String(val),
    actual: String(val),
    severity: "minor" as const,
  };
});

// Gaps: accept strings OR objects, coerce to strings
const gapItem = z.any().transform((val) => {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    return String(
      obj["description"] ?? obj["gap"] ?? obj["message"] ?? JSON.stringify(val),
    );
  }
  return String(val);
});

export const auditReportSchema = z.object({
  coverageScore: z.number().min(0).max(1),
  coherenceScore: z.number().min(0).max(1),
  drifts: z.array(semanticDriftSchema).default([]),
  gaps: z.array(gapItem).default([]),
  passed: z.boolean(),
  challenges: z.array(challengeSchema).default([]),
});

// ─── Governor ───

const nextActionField = z
  .union([
    z.string(),
    z.null(),
    z
      .object({})
      .passthrough()
      .transform((obj) => JSON.stringify(obj)),
  ])
  .nullable()
  .default(null);

const policyViolationSchema = z.object({
  stageCode: forgivingEnum(
    ["INT", "PER", "ENT", "PRO", "SYN", "VER", "GOV"],
    "GOV",
  ),
  ruleViolated: z.string(),
  description: z.string(),
  severity: forgivingEnum(["critical", "major", "minor"], "major"),
});

export const governorDecisionSchema = z.object({
  decision: forgivingEnum(["ACCEPT", "REJECT", "ITERATE"], "ITERATE"),
  confidence: z.number().min(0).max(1),
  coverageScore: z.number().min(0).max(1),
  coherenceScore: z.number().min(0).max(1),
  gatePassRate: z.number().min(0).max(1),
  provenanceIntact: z.boolean(),
  rejectionReasons: z.array(z.string()).default([]),
  violations: z.array(policyViolationSchema).default([]),
  nextAction: nextActionField,
  challenges: z.array(challengeSchema).default([]),
});
