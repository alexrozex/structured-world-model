import type { PostcodeAddress } from "@swm/provenance";

export interface ProvenanceTrace {
  readonly intentGoalId: string | null;
  readonly intentPhrase: string | null;
  readonly blueprintEntity: string | null;
  readonly blueprintInvariant: string | null;
  readonly blueprintComponent: string | null;
  readonly blueprintWorkflow: string | null;
}

export type FindingCategory =
  | "missing-entity"
  | "missing-invariant"
  | "missing-process"
  | "semantic-drift"
  | "unimplemented-component"
  | "missing-state-machine";

export type FindingSeverity = "critical" | "major" | "minor";

export interface VerificationFinding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly confidence: number;
  readonly title: string;
  readonly description: string;
  readonly filePath: string | null;
  readonly lineRange: { start: number; end: number } | null;
  readonly provenance: ProvenanceTrace;
}

export interface BoundedContextResult {
  readonly contextName: string;
  readonly findings: readonly VerificationFinding[];
  readonly entitiesExpected: number;
  readonly entitiesFound: number;
  readonly invariantsExpected: number;
  readonly invariantsEnforced: number;
}

/** Three-tier invariant coverage breakdown (approach 3 from STATE.md). */
export interface InvariantTierBreakdown {
  /** Invariants where a full comparison expression is found in code. */
  readonly enforced: number;
  /** Invariants where a property name is found but not the full expression. */
  readonly mentioned: number;
  /** Invariants where only a description keyword is found. */
  readonly present: number;
  /** Invariants with no trace at all. */
  readonly absent: number;
  readonly total: number;
}

export interface VerificationReport {
  readonly findings: readonly VerificationFinding[];
  readonly contextResults: readonly BoundedContextResult[];
  readonly entityCoverage: number;
  readonly invariantCoverage: number;
  readonly componentCoverage: number;
  readonly overallScore: number;
  readonly passed: boolean;
  readonly blueprintPostcode: string;
  readonly postcode: PostcodeAddress;
  /** Honest three-tier breakdown. invariantCoverage counts only "enforced" tier. */
  readonly invariantTiers?: InvariantTierBreakdown;
}
