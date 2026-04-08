import { ManifoldState, SemanticNode } from "@swm/provenance";
import { writeConfigGraph, WriteConfigOptions } from "./writer.js";
import type {
  Blueprint,
  GovernorDecision,
  DomainContext,
  GovernorDecisionType,
} from "@swm/compiler";

/**
 * ManifoldProjector: Transforms the abstract manifold world model into
 * concrete filesystem artifacts (CLAUDE.md, agents, hooks).
 */
export class ManifoldProjector {
  /**
   * Projects the current manifold state onto the local filesystem.
   */
  project(
    state: ManifoldState,
    targetDir: string,
    options?: WriteConfigOptions,
  ): void {
    // 1. Locate the Synthesis (Blueprint) node
    const blueprintNode = this.findNodeByCoordinate(
      state,
      "L2I",
      "REL",
      "GLO",
      "WHT",
      "SFT",
    );
    if (!blueprintNode) {
      // Check if we have a partial state that can still be projected
      if (options?.partial) {
        console.warn("Synthesis node missing; projection will be incomplete.");
      } else {
        throw new Error(
          "Cannot project manifold: Synthesis (Blueprint) node missing.",
        );
      }
    }

    const blueprint = (blueprintNode?.content as Blueprint) || null;

    // 2. Locate Governor Decision
    const govNode = this.findNodeByCoordinate(
      state,
      "L3E",
      "POL",
      "GLO",
      "IFS",
      "SFT",
    );
    const governorDecision: GovernorDecision = (govNode?.content as GovernorDecision) || {
      decision: "ITERATE" as GovernorDecisionType,
      confidence: 0,
      coverageScore: 0,
      coherenceScore: 0,
      gatePassRate: 0,
      provenanceIntact: false,
      rejectionReasons: [],
      violations: [],
      nextAction: null,
      challenges: [],
      postcode: { raw: "ML.GOV.MISSING" } as any,
    };

    // 3. Locate Persona (Domain Context)
    const perNode = this.findNodeByCoordinate(
      state,
      "L2I",
      "ENT",
      "GLO",
      "WHO",
      "SFT",
    );
    const domainContext =
      (perNode?.content as DomainContext) || options?.domainContext;

    if (!blueprint) {
      if (options?.partial) return;
      throw new Error("Blueprint data missing from manifold synthesis node.");
    }

    // 4. Delegate to the core writer
    writeConfigGraph(blueprint, governorDecision, targetDir, {
      ...options,
      domainContext,
    });
  }

  private findNodeByCoordinate(
    state: ManifoldState,
    layer: string,
    concern: string,
    scope: string,
    dimension: string,
    domain: string,
  ): SemanticNode | null {
    // Return the node that matches the coordinate axes
    // In case of multiple versions, the ManifoldState should ideally only contain the active ones
    return (
      Object.values(state.nodes).find(
        (n) =>
          n.coordinate.layer === layer &&
          n.coordinate.concern === concern &&
          n.coordinate.scope === scope &&
          n.coordinate.dimension === dimension &&
          n.coordinate.domain === domain,
      ) || null
    );
  }
}
