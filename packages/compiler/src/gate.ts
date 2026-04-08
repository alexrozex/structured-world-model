import type { Challenge, ProvenanceGate } from "./types.js";
import type { PostcodeAddress } from "@swm/provenance";

const GATE_PASS_THRESHOLD = 0.7;

export interface GateInput {
  readonly fromPostcode: PostcodeAddress;
  readonly toPostcode: PostcodeAddress;
  readonly challenges: readonly Challenge[];
  readonly invariantCount: number;
  readonly unresolvedUnknowns: number;
  readonly previousEntropy: number;
  readonly parseFailure: boolean;
}

export function buildGate(input: GateInput): ProvenanceGate {
  let entropy = input.previousEntropy;

  // Successful parse = structured output = meaningful entropy drop
  if (!input.parseFailure) {
    entropy -= entropy * 0.3;
  }

  // Content produced reduces entropy further — scaled proportionally
  if (input.invariantCount > 0) {
    const reductionFactor = Math.min(0.35, input.invariantCount * 0.025);
    entropy -= entropy * reductionFactor;
  }

  // Unresolved unknowns increase entropy
  if (input.unresolvedUnknowns > 0) {
    entropy += Math.min(0.15, input.unresolvedUnknowns * 0.03);
  }

  // Resolved challenges decrease entropy slightly
  const resolvedCount = input.challenges.filter((c) => c.resolved).length;
  if (resolvedCount > 0) {
    entropy -= Math.min(0.1, resolvedCount * 0.02);
  }

  // Empty challenge penalty on vague intent
  if (input.challenges.length === 0 && input.unresolvedUnknowns > 2) {
    entropy += 0.1;
  }

  // Parse failure — significant penalty
  if (input.parseFailure) {
    entropy = Math.min(1.0, entropy + 0.25);
  }

  // Clamp to [0.05, 1.0] — entropy never reaches true zero
  entropy = Math.max(0.05, Math.min(1.0, entropy));

  // Gate PASS requires:
  //   entropyEstimate < 0.7
  //   no unresolved blocking challenges
  // Monotonicity is tracked but not a hard gate condition —
  // integration stages (SYN) legitimately increase entropy by
  // surfacing open questions. The Governor sees the full trajectory
  // and decides whether violations are acceptable.
  // (arxiv 2603.18940: shape matters, but their measurement was
  // per-step reasoning chains, not multi-concern pipelines)
  const hasUnresolvedBlockers = input.challenges.some(
    (c) => c.severity === "blocking" && !c.resolved,
  );
  const passed = entropy < GATE_PASS_THRESHOLD && !hasUnresolvedBlockers;

  return {
    fromPostcode: input.fromPostcode.raw,
    toPostcode: input.toPostcode.raw,
    entropyEstimate: entropy,
    passed,
    challenges: input.challenges,
    timestamp: Date.now(),
  };
}

export function computeGatePassRate(
  gates: Record<string, ProvenanceGate>,
): number {
  const gateValues = Object.values(gates);
  if (gateValues.length === 0) return 0;
  const passedCount = gateValues.filter((g) => g.passed).length;
  return passedCount / gateValues.length;
}
