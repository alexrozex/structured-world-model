/**
 * EnrichedWorldModel: SWM's descriptive WorldModel + Ada's prescriptive types.
 *
 * This is what you get when you extract structure AND compile architecture.
 */

import type { WorldModelType } from "@swm/core";

import type {
  BoundedContext,
  EntityInvariant,
  HoareTriple,
  StateMachine,
  NonFunctionalRequirement,
  Stakeholder,
  BuildContract,
  GovernorDecision,
  CompilationAudit,
} from "@swm/compiler";

import type { PostcodeAddress } from "@swm/provenance";

export interface EnrichedWorldModel extends WorldModelType {
  // Ada-derived architectural enrichments
  readonly boundedContexts: readonly BoundedContext[];
  readonly invariants: Map<string, EntityInvariant[]>; // entityName → invariants
  readonly hoareTriples: Map<string, HoareTriple[]>; // processName → triples per step
  readonly stateMachines: readonly StateMachine[];
  readonly nonFunctionalRequirements: readonly NonFunctionalRequirement[];
  readonly stakeholders: readonly Stakeholder[];
  readonly buildContract?: BuildContract;

  // Governance
  readonly governorDecision?: GovernorDecision;
  readonly compilationAudit?: CompilationAudit;

  // Provenance
  readonly postcodes: Map<string, PostcodeAddress>;
}
