// ─── Adaptive Depth Classifier ───────────────────────────────────────────────
//
// Pure function: classifyDepth(rawIntent) → ElicitationPlan
// No LLM call, no I/O, no side effects.
//
// Governs which of the 5 axiom-derived questions to ask before compilation.
// Derived from first-principles research (project_elicitation_axioms.md).
//
// Core principle: Ada asks only what she genuinely cannot derive.
// Actor, scope, and failure conditions are usually derivable from domain
// knowledge and CTX output. Only genuine unknowns — things only the user
// knows — should ever reach the user.
//
// Priority stack:
//   Q1 scope_boundary      — conditional: broad scope vocab without limits
//   Q2 primary_actor       — conditional: only genuine multi-actor ambiguity
//   Q3 failure_conditions  — conditional: high-invariant regulated domains only
//   Q4 workflow_disambiguation — conditional: novel/complex domain only
//   Q5 business_rule       — conditional: high-invariant domain only
//
// Hard cap: 5 questions (axiom A5).
// Zero questions: trivial domain, self-referential, specific technical intent.

export type QuestionType =
  | "scope_boundary"
  | "primary_actor"
  | "failure_conditions"
  | "workflow_disambiguation"
  | "business_rule";

export type QuestionTargetField = "goals" | "constraints" | "unknowns";

export interface PlannedQuestion {
  readonly type: QuestionType;
  readonly rationale: string;
  readonly priority: "mandatory" | "conditional";
  readonly targetField: QuestionTargetField;
}

export interface ElicitationPlan {
  readonly questionCount: number;
  readonly questions: readonly PlannedQuestion[];
  readonly skipReason: string | null;
  readonly confidence: "high" | "low";
  readonly domainLabel: string;
  readonly terminationReason: "ready" | "needs_elicitation";
}

// ─── Signal tables ────────────────────────────────────────────────────────────

// Well-known trivial domains — scope, actor, and core workflow are all
// inferable from the intent alone. Zero questions needed if intent is short.
const KNOWN_TRIVIAL_DOMAINS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(todo|to-do|task list|task manager)\b/i, "todo"],
  [/\b(note[- ]?taking|notes app|personal notes)\b/i, "notes"],
  [/\bblog\b/i, "blog"],
  [/\bportfolio( site| website)?\b/i, "portfolio"],
  [/\blanding page\b/i, "landing-page"],
  [/\bcalculator\b/i, "calculator"],
  [/\b(timer|countdown( timer)?)\b/i, "timer"],
  [/\b(reminder app|reminders)\b/i, "reminder"],
  [/\bchecklist\b/i, "checklist"],
  [/\bshopping list\b/i, "shopping-list"],
  [/\bhabit tracker\b/i, "habit-tracker"],
  [/\blink (saver|collector)\b/i, "bookmarks"],
  [/\bpassword manager\b/i, "password-manager"],
  // Business management apps — scope and actor are well-understood
  [/\bcrm\b/i, "crm"],
  [
    /\b(tattoo|barbershop|salon|spa|studio)\s+(crm|management|booking|app|software)\b/i,
    "studio-management",
  ],
  [/\b(inventory|warehouse)\s+(management|tracker|system|app)\b/i, "inventory"],
  [
    /\b(restaurant|cafe|coffee shop)\s+(management|pos|ordering|app)\b/i,
    "restaurant",
  ],
  [/\b(project management|task management)\b/i, "project-management"],
  [/\bpos\b/i, "pos"],
  [/\b(e[- ]?commerce|online store|online shop)\b/i, "ecommerce"],
  [/\bdashboard\b/i, "dashboard"],
  [/\banalytics\b/i, "analytics"],
  [/\bchat( app)?\b/i, "chat"],
  [/\bauth(entication)?\b/i, "auth"],
];

// Multi-actor vocabulary — signals Q2 (primary actor) is needed.
// When multiple actors are implied, Ada cannot safely pick one.
const MULTI_ACTOR_KEYWORDS: readonly string[] = [
  "marketplace",
  "buyer",
  "seller",
  "provider",
  "consumer",
  "vendor",
  "host",
  "guest",
  "employer",
  "employee",
  "driver",
  "rider",
  "freelancer",
  "tutor",
  "student",
  "landlord",
  "tenant",
  "coach",
  "athlete",
  "recruiter",
  "candidate",
];

// Scope-ambiguous vocabulary — terms that genuinely admit multiple incompatible
// architectures (e.g. marketplace = two-sided vs one-sided, platform = SaaS vs
// API vs mobile). Generic app-noun words like "app", "tool", "service" are NOT
// scope-ambiguous — they are just qualifiers and should not trigger Q1.
const SCOPE_AMBIGUOUS_KEYWORDS: readonly string[] = [
  "platform",
  "marketplace",
  "ecosystem",
];

// Scope-limiting patterns — if the intent already limits scope, Q1 is not needed.
const SCOPE_LIMITING_PATTERNS: readonly RegExp[] = [
  /\bonly\b/i,
  /\bjust\b/i,
  /\bspecifically\b/i,
  /\bexclusively\b/i,
  /\bsolely\b/i,
  /\bwithout\s+\w+/i,
  /\bno\s+(registration|login|auth|payment|subscription)\b/i,
  /\bnot including\b/i,
  /\bexcluding\b/i,
];

// Failure condition patterns — if present, Q3 (failure conditions) is not needed.
const FAILURE_CONDITION_PATTERNS: readonly RegExp[] = [
  /\bshould never\b/i,
  /\bmust not\b/i,
  /\bcannot\b/i,
  /\bcan't\b/i,
  /\bprevent\s+\w+/i,
  /\bno duplicate\b/i,
  /\bavoid\s+\w+/i,
  /\bprohibit\b/i,
  /\brestrict\b/i,
  /\bnot allowed\b/i,
  /\bforbidden\b/i,
  /\bnever\s+(store|expose|share|leak|allow|accept)\b/i,
];

// High-invariant domain keywords — trigger Q5 (business rule).
// These domains have known regulatory or correctness traps.
const HIGH_INVARIANT_KEYWORDS: readonly string[] = [
  "payment",
  "billing",
  "invoice",
  "charge",
  "subscription",
  "stripe",
  "checkout",
  "health",
  "medical",
  "doctor",
  "patient",
  "clinic",
  "hipaa",
  "prescription",
  "legal",
  "contract",
  "compliance",
  "gdpr",
  "regulatory",
  "insurance",
  "claim",
  "scheduling",
  "booking",
  "appointment",
  "reservation",
  "financial",
  "banking",
  "money",
  "wallet",
  "transaction",
  "tax",
];

// Self-referential / internal improvement patterns — fast path.
// These intents reference concrete technical components by name, so actor
// is always "the system" and scope is bounded by the component reference.
const SELF_REFERENTIAL_PATTERNS: readonly RegExp[] = [
  /\bada\b/i,
  /\b(per|ent|pro|syn|ver|gov|bld|ctx|int)\s+(stage|phase|step|agent)\b/i,
  /\bpipeline\s+stage\b/i,
  /\bcompiler\s+(stage|pipeline|agent|phase)\b/i,
  /\belicitation\b/i,
  /\bdepth.?classifier\b/i,
  /\bmcp\s+(server|tool)\b/i,
  /\bbluepri?nt\b/i,
  /\bpostcode\b/i,
  /\bprovenance\b/i,
  /\binvariant\b/i,
  /\bubiquitous.?language\b/i,
  /\bstakeholder\s+vocab\b/i,
];

// Workflow complexity patterns — trigger Q4 (workflow disambiguation).
// Signals non-obvious multi-step coordination between actors or systems.
const WORKFLOW_COMPLEXITY_PATTERNS: readonly RegExp[] = [
  /\bcoordinat\w*\b/i,
  /\bbetween\s+\w+\s+and\s+\w+/i,
  /\bacross\s+(multiple|different|several)\b/i,
  /\bmulti[- ]step\b/i,
  /\bworkflow\b/i,
  /\bpipeline\b/i,
  /\bintegrat\w*\b/i,
  /\borchestrat\w*\b/i,
  /\bhandoff\b/i,
  /\bapproval\s+(process|flow|chain)\b/i,
  /\breview\s+and\s+(approve|reject)\b/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function matchesAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function detectDomain(text: string): string {
  for (const [pattern, label] of KNOWN_TRIVIAL_DOMAINS) {
    if (pattern.test(text)) return label;
  }
  if (text.toLowerCase().includes("marketplace")) return "marketplace";
  if (text.toLowerCase().includes("platform")) return "platform";
  if (matchesAnyKeyword(text, HIGH_INVARIANT_KEYWORDS)) return "high-invariant";
  return "unknown";
}

// ─── classifyDepth ────────────────────────────────────────────────────────────

/**
 * Pure function. Analyzes raw intent text and returns an ElicitationPlan
 * specifying which questions (0–5) to ask before compilation.
 *
 * No LLM call. No side effects.
 */
export function classifyDepth(rawIntent: string): ElicitationPlan {
  const text = rawIntent.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const domainLabel = detectDomain(text);
  const isTrivialDomain = KNOWN_TRIVIAL_DOMAINS.some(([p]) => p.test(text));
  const isSelfReferential = matchesAnyPattern(text, SELF_REFERENTIAL_PATTERNS);
  const hasScopeAmbiguity = matchesAnyKeyword(text, SCOPE_AMBIGUOUS_KEYWORDS);
  const hasMultiActor = matchesAnyKeyword(text, MULTI_ACTOR_KEYWORDS);
  const isHighInvariant = matchesAnyKeyword(text, HIGH_INVARIANT_KEYWORDS);

  // ── Fast path 1: trivial well-known domain with concise intent ────────────
  if (isTrivialDomain && wordCount <= 15) {
    return {
      questionCount: 0,
      questions: [],
      skipReason: `Domain "${domainLabel}" is well-understood. Scope, actor, and workflow are all inferable.`,
      confidence: "high",
      domainLabel,
      terminationReason: "ready",
    };
  }

  // ── Fast path 2: self-referential / internal system improvement ───────────
  // Intent names concrete technical components → actor is the system,
  // scope is bounded by the component name, failures are standard (don't break tests).
  if (isSelfReferential) {
    return {
      questionCount: 0,
      questions: [],
      skipReason:
        "Intent references concrete technical components — actor, scope, and standard failure conditions are all derivable.",
      confidence: "high",
      domainLabel,
      terminationReason: "ready",
    };
  }

  // ── Fast path 3: specific technical intent (high word count, no ambiguity) ─
  // Long intents with concrete vocabulary and no multi-actor confusion are
  // self-defining — Ada has enough signal to derive everything.
  if (
    wordCount >= 20 &&
    !hasScopeAmbiguity &&
    !hasMultiActor &&
    !isHighInvariant
  ) {
    return {
      questionCount: 0,
      questions: [],
      skipReason:
        "Intent is sufficiently specific — scope, actor, and constraints are all derivable from the description.",
      confidence: "low",
      domainLabel,
      terminationReason: "ready",
    };
  }

  const questions: PlannedQuestion[] = [];

  // ── Q1: Scope boundary ───────────────────────────────────────────────────
  // Only when intent uses broad scope vocabulary AND hasn't limited it.
  const hasScopeLimiting = matchesAnyPattern(text, SCOPE_LIMITING_PATTERNS);

  if (!hasScopeLimiting && hasScopeAmbiguity) {
    questions.push({
      type: "scope_boundary",
      rationale: `Intent uses broad scope vocabulary without explicit boundaries — Ada will propose scope definition`,
      priority: "mandatory",
      targetField: "constraints",
    });
  }

  // ── Q2: Primary actor + core need ────────────────────────────────────────
  // ONLY fire for genuine multi-actor domains where Ada cannot determine which
  // side is primary (marketplace, two-sided platforms, etc.).
  // Removed: "!hasExplicitActor && wordCount >= 4" — this fired on almost
  // everything. For single-product intents, Ada derives the actor from context.
  if (hasMultiActor) {
    questions.push({
      type: "primary_actor",
      rationale:
        "Multi-actor domain — which side is primary determines the entire entity model and architecture",
      priority: "mandatory",
      targetField: "goals",
    });
  }

  // ── Q3: Failure conditions ────────────────────────────────────────────────
  // ONLY fire for high-invariant regulated domains where standard failure
  // conditions are insufficient (payment, medical, legal).
  // Removed: "always ask unless present" — non-technical users cannot answer
  // this. Ada derives standard failure conditions from domain knowledge.
  const hasFailureConditions = matchesAnyPattern(
    text,
    FAILURE_CONDITION_PATTERNS,
  );

  if (!hasFailureConditions && isHighInvariant) {
    questions.push({
      type: "failure_conditions",
      rationale:
        "Regulated domain — domain-specific failure conditions and invariants must be explicit before compilation",
      priority: "mandatory",
      targetField: "constraints",
    });
  }

  // ── Q4: Workflow disambiguation ───────────────────────────────────────────
  // Conditional: only for complex/novel domains with coordination patterns.
  const hasWorkflowComplexity = matchesAnyPattern(
    text,
    WORKFLOW_COMPLEXITY_PATTERNS,
  );

  if (hasWorkflowComplexity && !isTrivialDomain) {
    questions.push({
      type: "workflow_disambiguation",
      rationale:
        "Intent describes multi-step coordination — workflow sequence must be explicit before entity and process stages can compile correctly",
      priority: "conditional",
      targetField: "unknowns",
    });
  }

  // ── Q5: Business rule ─────────────────────────────────────────────────────
  // Conditional: only for high-invariant domains (money, health, legal, scheduling).
  if (isHighInvariant) {
    questions.push({
      type: "business_rule",
      rationale:
        "Domain has known regulatory or correctness constraints that must be made explicit before invariants can be compiled",
      priority: "conditional",
      targetField: "constraints",
    });
  }

  // Hard cap at 5 (axiom A5: ~5 question tolerance)
  const capped = questions.slice(0, 5);

  // ── Zero questions via signal analysis ───────────────────────────────────
  // Intent has enough clarity that all mandatory signals are satisfied.
  if (capped.length === 0) {
    return {
      questionCount: 0,
      questions: [],
      skipReason:
        "Intent contains sufficient scope, actor, and constraint signal for direct compilation",
      confidence: "low", // signal-based, not domain-knowledge-based
      domainLabel,
      terminationReason: "ready",
    };
  }

  return {
    questionCount: capped.length,
    questions: capped,
    skipReason: null,
    confidence: isTrivialDomain || hasScopeLimiting ? "high" : "low",
    domainLabel,
    terminationReason: "needs_elicitation",
  };
}
