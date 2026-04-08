import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { DEV_OPUS } from "../models.js";
import type {
  GovernorDecision,
  PipelineState,
  CompilerStageCode,
} from "../types.js";
import { governorDecisionSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";
import { computeGatePassRate } from "../gate.js";

export class GovernorAgent extends Agent<PipelineState, GovernorDecision> {
  readonly name = "Governor";
  readonly stageCode: CompilerStageCode = "GOV";
  readonly model = DEV_OPUS;
  readonly lens = "PROVENANCE — full pipeline state";

  protected override get useExtendedThinking(): boolean {
    return process.env["ADA_DEV_MODE"] !== "1";
  }

  protected getSchema(): ZodSchema {
    return governorDecisionSchema;
  }

  protected getDefaultOutput(input: PipelineState): GovernorDecision {
    return {
      decision: "REJECT",
      confidence: 0,
      coverageScore: 0,
      coherenceScore: 0,
      gatePassRate: computeGatePassRate(input.gates),
      provenanceIntact: false,
      rejectionReasons: ["Governor output failed validation"],
      violations: [],
      nextAction: null,
      challenges: [],
      postcode: generatePostcode("GOV", "default"),
    };
  }

  protected buildPrompt(input: PipelineState): string {
    const gatePassRate = computeGatePassRate(input.gates);
    const gateDetails = Object.entries(input.gates)
      .map(
        ([postcode, gate]) =>
          `${postcode}: entropy=${gate.entropyEstimate.toFixed(2)} passed=${gate.passed} blockers=${gate.challenges.filter((c) => c.severity === "blocking" && !c.resolved).length}`,
      )
      .join("\n  ");

    const coverageScore = input.verify?.coverageScore ?? 0;
    const coherenceScore = input.verify?.coherenceScore ?? 0;
    const gaps = input.verify?.gaps ?? [];
    const entityCount = input.entity?.entities.length ?? 0;
    const workflowCount = input.process?.workflows.length ?? 0;
    const componentCount = input.synthesis?.architecture.components.length ?? 0;

    // Check provenance — do all gates resolve?
    const provenanceIntact =
      Object.keys(input.gates).length > 0 &&
      !Object.values(input.gates).some((g) =>
        g.challenges.some(
          (c) => c.id.includes("parse-failure") && c.severity === "blocking",
        ),
      );

    return `You are the Governor. Your lens: PROVENANCE — full pipeline state.
Decide: ACCEPT, REJECT, or ITERATE.

PIPELINE SUMMARY:
  entities: ${entityCount}
  workflows: ${workflowCount}
  components: ${componentCount}
  coverage: ${coverageScore.toFixed(2)} (need ≥ 0.80)
  coherence: ${coherenceScore.toFixed(2)} (need ≥ 0.85)
  gate pass rate: ${gatePassRate.toFixed(2)} (need ≥ 0.80)
  provenance: ${provenanceIntact ? "intact" : "BROKEN"}
  entropy: ${input.cumulativeEntropy.toFixed(2)}

GATES:
  ${gateDetails || "no gates recorded"}

GAPS FROM VERIFY:
  ${gaps.join("\n  ") || "none"}

First, think out loud. Show your work on each criterion.
  coverage ${coverageScore.toFixed(2)} ≥ 0.80 ${coverageScore >= 0.8 ? "✓" : "✗"}
  coherence ${coherenceScore.toFixed(2)} ≥ 0.85 ${coherenceScore >= 0.85 ? "✓" : "✗"}
  gates ${gatePassRate.toFixed(2)} ≥ 0.80 ${gatePassRate >= 0.8 ? "✓" : "✗"}
  provenance ${provenanceIntact ? "intact ✓" : "BROKEN ✗"}
State your decision and why.
If ITERATE or REJECT: populate "violations" with per-stage breakdowns of what failed. Each violation has stageCode (INT/PER/ENT/PRO/SYN/VER/GOV), ruleViolated, description, severity (critical/major/minor).
If ITERATE: name the exact fix in nextAction. One bounded context. Testable. Max 500 chars.

Mark key insights with ◈
Mark things you derived that weren't stated with ∴
Mark risks or gaps with ✗
Mark things you're confident about with ✓

RULES:
  ACCEPT: coverage ≥ 0.80 AND coherence ≥ 0.85 AND gates ≥ 0.80 AND provenance intact AND no blocking challenges
  ACCEPT also when: coverage ≥ 0.70 AND coherence ≥ 0.80 AND gates ≥ 0.80 AND provenance intact — scores within tolerance, iteration risks degradation
  ITERATE: only when a SPECIFIC structural gap exists that iteration can fix. Do NOT iterate just because scores are slightly below threshold.
  REJECT: structurally impossible — contradictory constraints or broken provenance that can't be repaired.
  REJECT is rare. Most failures should ACCEPT with noted gaps, not ITERATE into worse scores.

The reasoning above is for the user to read. The JSON below is for the system.
Return the structured result in a \`\`\`json fence:
\`\`\`json
{
  "decision": "ACCEPT",
  "confidence": 0.91,
  "coverageScore": 0.85,
  "coherenceScore": 0.90,
  "gatePassRate": 0.83,
  "provenanceIntact": true,
  "rejectionReasons": [],
  "violations": [],
  "nextAction": null,
  "challenges": []
}
\`\`\`
Produce a REAL decision based on the pipeline state above. If ITERATE, nextAction must name the specific stage and fix needed.`;
  }
}
