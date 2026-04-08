import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { DEV_OPUS } from "../models.js";
import type {
  BlueprintArchitecture,
  BlueprintScope,
  NonFunctionalRequirement,
  ResolvedConflict,
  Challenge,
  IntentGraph,
  DomainContext,
  EntityMap,
  ProcessFlow,
  CompilerStageCode,
  SubGoalSpec,
} from "../types.js";
import { blueprintSchema } from "../schemas.js";

export interface SynthesisOutput {
  readonly summary: string;
  readonly scope: BlueprintScope;
  readonly architecture: BlueprintArchitecture;
  readonly nonFunctional: readonly NonFunctionalRequirement[];
  readonly openQuestions: readonly string[];
  readonly resolvedConflicts: readonly ResolvedConflict[];
  readonly challenges: readonly Challenge[];
  readonly subGoals: readonly SubGoalSpec[];
}

export interface SynthesisInput {
  readonly intentGraph: IntentGraph;
  readonly domainContext: DomainContext;
  readonly entityMap: EntityMap;
  readonly processFlow: ProcessFlow;
}

function compactEntities(entityMap: EntityMap): string {
  return entityMap.entities
    .map(
      (e) =>
        `${e.name} (${e.category}): ${e.invariants.map((i) => i.predicate).join(", ")}`,
    )
    .join("\n  ");
}

function compactWorkflows(processFlow: ProcessFlow): string {
  return processFlow.workflows
    .map(
      (w) =>
        `${w.name} [${w.trigger}]: ${w.steps.map((s) => s.name).join(" → ")}`,
    )
    .join("\n  ");
}

function compactBoundedContexts(entityMap: EntityMap): string {
  return entityMap.boundedContexts
    .map(
      (bc) =>
        `${bc.name} (root: ${bc.rootEntity}) → [${bc.entities.join(", ")}]`,
    )
    .join("\n  ");
}

export class SynthesisAgent extends Agent<SynthesisInput, SynthesisOutput> {
  readonly name = "Synthesis";
  readonly stageCode: CompilerStageCode = "SYN";
  readonly model = DEV_OPUS;
  readonly lens = "INTEGRATION — merges all upstream";

  protected getSchema(): ZodSchema {
    return blueprintSchema;
  }

  protected getDefaultOutput(input: SynthesisInput): SynthesisOutput {
    return {
      summary: input.intentGraph.rawIntent,
      scope: { inScope: [], outOfScope: [], assumptions: [] },
      architecture: { pattern: "unknown", rationale: "", components: [] },
      nonFunctional: [
        {
          category: "maintainability",
          requirement: "TypeScript strict mode",
          scope: "global",
          verification: "tsc --noEmit exits 0",
        },
      ],
      openQuestions: [],
      resolvedConflicts: [],
      challenges: [],
      subGoals: [],
    };
  }

  protected buildPrompt(input: SynthesisInput): string {
    const goals = input.intentGraph.goals
      .map((g) => `${g.id}: ${g.description} (${g.type})`)
      .join("\n  ");
    const constraints = input.intentGraph.constraints
      .map((c) => `${c.id}: ${c.description}`)
      .join("\n  ");
    const unknowns = input.intentGraph.unknowns
      .map((u) => `${u.id}: ${u.description} (${u.impact})`)
      .join("\n  ");

    return `You are the Synthesis agent. Your lens: INTEGRATION — merges all upstream.

GROUNDING: ARCHITECTURE THEORY + CONFLICT RESOLUTION

Traceability rule:
  Before proposing any component, state WHY it exists.
  Every component must trace to an entity or workflow from upstream.
  If you cannot trace it, add to openQuestions. Never invent.

Conflict resolution: when Entity and Process disagree, name the conflict,
resolve it, and record in resolvedConflicts.

Dependency direction: infrastructure → application → domain.
Interface segregation: >7 methods = split into two components.

---

First, think out loud. Compose the integration.
Derive each component from upstream — trace it explicitly.
  "PaymentService exists because Entity found Payment and Process found createPayment workflow"
When Entity and Process disagree, name the conflict and resolve it out loud.
Show the dependency direction. What depends on what?

Mark key insights with ◈
Mark things you derived that weren't stated with ∴
Mark risks or gaps with ✗
Mark things you're confident about with ✓

TASK: Produce the INTEGRATION artifact — architecture, components, non-functional requirements.
You do NOT reproduce entities or workflows. Those are locked upstream.
You derive components FROM them.

GOALS:
  ${goals}

CONSTRAINTS:
  ${constraints}

UNKNOWNS:
  ${unknowns}

DOMAIN: ${input.domainContext.domain}
EXCLUDED: ${input.domainContext.excludedConcerns.join(", ") || "none stated"}

ENTITIES (${input.entityMap.entities.length} total):
  ${compactEntities(input.entityMap)}

BOUNDED CONTEXTS:
  ${compactBoundedContexts(input.entityMap)}

WORKFLOWS (${input.processFlow.workflows.length} total):
  ${compactWorkflows(input.processFlow)}

STATE MACHINES: ${input.processFlow.stateMachines.map((sm) => `${sm.entity} [${sm.states.join(", ")}]`).join("; ") || "none"}

---

Derive one component per bounded context minimum.
Each component needs: name, responsibility, interfaces (method names), dependencies, boundedContext.

COMPONENT NAMING RULE (enforced):
When the codebase vocabulary section above lists existing component names, you MUST use those exact names.
A component that maps to an existing class gets that class's exact name — no synonyms, no renames.
Only invent a new name when no existing class covers that responsibility.

CRITICAL RULES:
- "components" must be POPULATED with actual component objects — not empty, not type definitions
- "openQuestions" must be an array of STRINGS like ["What handles session resume?"] — NOT objects
- "resolvedConflicts[].authoritative" must be either "entity" or "process" — NOT a description
- "summary" must describe what the system DOES — NOT repeat the raw intent
- "scope.inScope" must list what this system explicitly builds (1 item per goal, plain language)
- "scope.outOfScope" must copy from EXCLUDED above — everything this system does NOT do
- "scope.assumptions" must list things assumed true that were not explicitly stated (from resolved unknowns)
- "nonFunctional" must be an array of OBJECTS with: category (one of: performance, security, scalability, reliability, maintainability, compliance, observability), requirement (what must hold), predicate (optional formal predicate — omit if not formalizable), scope (bounded context name or "global"), verification (how to confirm)
- DO NOT leave any array empty if upstream data exists to populate it

SUB-GOAL DERIVATION:
For each bounded context above, derive one SubGoalSpec.
A SubGoalSpec is the minimal compilable intent for that context alone.

Each subGoal must have:
- name: the bounded context name (exact match)
- derivedIntent: a single sentence that, if given to a fresh Ada compilation, would produce ONLY this context's components. Start with an imperative verb. Example: "Build the governance subsystem that evaluates pipeline state and issues ACCEPT/REJECT/ITERATE decisions with policy violation detection."
- entities: array of entity names from ENTITIES above that belong to this context
- workflows: array of workflow names from WORKFLOWS above that belong to this context
- invariants: array of invariant PREDICATE STRINGS from the entities in this context — plain strings only, e.g. ["payment.amount > 0", "order.items.length > 0"]. Do NOT use objects. Do NOT include description fields.
- dependsOn: array of subGoal NAMES that this subGoal depends on. Derive this by checking: if this subGoal B uses entities or workflows that are DEFINED in another subGoal A's bounded context, then B dependsOn A. If this subGoal has no upstream dependencies, use [] (empty array).
- compilable: true (always)

DEPENDENCY DERIVATION RULE:
  For each pair of subGoals (A, B):
    If B's entities or workflows reference any entity/workflow that is the root entity or a primary workflow of A → B.dependsOn includes A.name
    "Reference" means: B needs A's output to function correctly (e.g., an order subGoal depends on user/identity subGoal if Order has a userId field)
  Start with subGoals that have no dependencies (dependsOn: []).
  Chain dependencies level by level.

Add "subGoals" as a top-level array in the JSON output.

The reasoning above is for the user to read. The JSON below is for the system.
Return the structured result in a \`\`\`json code fence:
\`\`\`json
{
  "summary": "A CLI tool that compiles human intent into governed Claude Code execution through an 8-stage sequential pipeline with provenance tracking and governor authority.",
  "scope": {
    "inScope": ["8-stage compilation pipeline", "intent elicitation via CLI", "CLAUDE.md + agent + hook output"],
    "outOfScope": ["GUI or web interface", "code execution", "cloud deployment", "project scaffolding"],
    "assumptions": ["Users have Node.js >= 18 installed", "Projects use TypeScript or JavaScript"]
  },
  "architecture": {
    "pattern": "gated-sequential-pipeline",
    "rationale": "The 8 compilation stages require sequential execution because each stage depends on the previous stage output. Provenance gates between stages enforce entropy reduction.",
    "components": [
      {
        "name": "IntentParser",
        "responsibility": "Parses raw human intent into structured goals, constraints, and unknowns",
        "interfaces": ["parse(intent)"],
        "dependencies": [],
        "boundedContext": "compilation"
      },
      {
        "name": "GovernorGate",
        "responsibility": "Evaluates full pipeline state and issues ACCEPT/REJECT/ITERATE decision",
        "interfaces": ["evaluate(pipelineState)"],
        "dependencies": ["IntentParser"],
        "boundedContext": "governance"
      }
    ]
  },
  "nonFunctional": [
    {"category": "maintainability", "requirement": "TypeScript strict mode with noImplicitAny", "scope": "global", "verification": "tsc --noEmit exits 0"},
    {"category": "reliability", "requirement": "Node.js >= 18 runtime", "scope": "global", "verification": "engines field in package.json"},
    {"category": "security", "requirement": "Anthropic API models only — no third-party model calls", "predicate": "api.baseURL.startsWith('https://api.anthropic.com')", "scope": "global", "verification": "grep for non-Anthropic API endpoints"}
  ],
  "openQuestions": ["How does session resume work after a crash?", "What is the retry policy for failed stages?"],
  "resolvedConflicts": [{"entity": "Pipeline has status field", "process": "Workflow defines status transitions", "resolution": "Process owns transitions, Entity owns valid states", "authoritative": "process"}],
  "challenges": [{"id": "CH1", "description": "Provenance chain integrity across iterations", "severity": "major", "resolved": false}],
  "subGoals": [
    {
      "name": "identity",
      "derivedIntent": "Build the identity subsystem that manages user authentication, credentials, and session lifecycle.",
      "entities": ["User", "Session", "Credential"],
      "workflows": ["register-user", "authenticate-user"],
      "invariants": ["user.email.includes('@')", "session.expiresAt > session.createdAt"],
      "dependsOn": [],
      "compilable": true
    },
    {
      "name": "compilation-pipeline",
      "derivedIntent": "Build the semantic compilation pipeline that transforms raw intent through 9 sequential stages into a governed blueprint artifact.",
      "entities": ["IntentGraph", "Blueprint", "CompilationRun"],
      "workflows": ["compile-intent", "iterate-on-rejection"],
      "invariants": ["intentGraph.goals.length > 0", "blueprint.audit.gatePassRate >= 0"],
      "dependsOn": ["identity"],
      "compilable": true
    }
  ]
}
\`\`\`

The example above shows the STRUCTURE and LEVEL OF DETAIL expected. Your output must have real components derived from the upstream entities and workflows — not the example values.`;
  }
}
