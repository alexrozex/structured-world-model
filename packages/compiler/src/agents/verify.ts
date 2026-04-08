import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { DEV_OPUS } from "../models.js";
import type {
  AuditReport,
  Blueprint,
  IntentGraph,
  CompilerStageCode,
} from "../types.js";
import { auditReportSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";

export interface VerifyInput {
  readonly blueprint: Blueprint;
  readonly intentGraph: IntentGraph;
}

export class VerifyAgent extends Agent<VerifyInput, AuditReport> {
  readonly name = "Verify";
  readonly stageCode: CompilerStageCode = "VER";
  readonly model = DEV_OPUS;
  readonly lens = "VALIDATION — blueprint vs intent";

  protected override get useExtendedThinking(): boolean {
    return process.env["ADA_DEV_MODE"] !== "1";
  }

  protected getSchema(): ZodSchema {
    return auditReportSchema;
  }

  protected getDefaultOutput(_input: VerifyInput): AuditReport {
    return {
      coverageScore: 0,
      coherenceScore: 0,
      drifts: [],
      gaps: ["verify output failed"],
      passed: false,
      challenges: [],
      postcode: generatePostcode("VER", "default"),
    };
  }

  protected buildPrompt(input: VerifyInput): string {
    const goalList = input.intentGraph.goals
      .map((g) => `${g.id}: ${g.description} (${g.type})`)
      .join("\n  ");
    const constraintList = input.intentGraph.constraints
      .map((c) => `${c.id}: ${c.description}`)
      .join("\n  ");
    const componentList = input.blueprint.architecture.components
      .map((c) => `${c.name}: ${c.responsibility} [${c.interfaces.join(", ")}]`)
      .join("\n  ");
    const entityCount = input.blueprint.dataModel.entities.length;
    const invariantCount = input.blueprint.dataModel.entities.reduce(
      (s, e) => s + e.invariants.length,
      0,
    );
    const workflowCount = input.blueprint.processModel.workflows.length;

    return `You are the Verify agent. Your lens: VALIDATION — blueprint vs intent.

ORIGINAL GOALS (${input.intentGraph.goals.length} total):
  ${goalList}

CONSTRAINTS:
  ${constraintList}

BLUEPRINT SUMMARY: ${input.blueprint.summary}
PATTERN: ${input.blueprint.architecture.pattern}
COMPONENTS (${input.blueprint.architecture.components.length}):
  ${componentList || "NONE — critical gap"}
ENTITIES: ${entityCount} with ${invariantCount} invariants
WORKFLOWS: ${workflowCount}
OPEN QUESTIONS: ${input.blueprint.openQuestions.length}

YOUR TASK: Try to break this blueprint. You are adversarial — the burden of proof is on the Blueprint.

First, think out loud about each goal's coverage. Write as if you're auditing the design.

For each goal, ask:
  ◈ "Is there a component that addresses this goal?"
  ✓ "That component's postcondition is [X] — this goal is covered."
  ✗ "No component addresses this — gap found."
For each constraint: "How could this Blueprint violate this constraint?"
For each invariant: "Under what conditions could this be false?"

When in doubt, call it a gap. False positives (PASS when should FAIL) ship broken execution.
False negatives (FAIL when should PASS) just cost one ITERATE loop.

SCORING RULES (follow precisely):
- Coverage: goals addressed with traceable postconditions / total goals. Partial counts.
- Coherence: 1.0 minus (contradictions / total invariants). High (0.85+) unless actual contradictions exist.
- A gap is a goal with NO component, workflow, or entity addressing it at all.
- Drifts are cases where the blueprint addresses something NOT in the original goals.

The reasoning above is for the user to read. The JSON below is for the system.
Output ONLY a JSON object in a \`\`\`json fence. Do NOT write prose after the JSON.

\`\`\`json
{
  "coverageScore": 0.85,
  "coherenceScore": 0.95,
  "drifts": [],
  "gaps": [],
  "passed": true,
  "challenges": []
}
\`\`\`
Produce REAL scores. Be fair — generous on partial coverage, strict only on actual contradictions.`;
  }
}
