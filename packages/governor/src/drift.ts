import type { Blueprint, EntityInvariant } from "@swm/compiler";

export interface DriftResult {
  readonly hasDrift: boolean;
  readonly severity: "critical" | "major" | "minor";
  readonly location: string;
  readonly detail: string;
}

export function evaluateInvariants(
  blueprint: Blueprint,
  toolOutput: string
): DriftResult[] {
  const results: DriftResult[] = [];

  for (const entity of blueprint.dataModel.entities) {
    for (const invariant of entity.invariants) {
      if (violatesInvariant(toolOutput, invariant)) {
        results.push({
          hasDrift: true,
          severity: "major",
          location: `${entity.name}.${invariant.predicate}`,
          detail: `Tool output may violate: ${invariant.predicate}`,
        });
      }
    }
  }

  return results;
}

function violatesInvariant(output: string, invariant: EntityInvariant): boolean {
  // Heuristic: check if output contains values that contradict the predicate
  const predicate = invariant.predicate;

  // Check for null/undefined violations
  if (predicate.includes("!== null") || predicate.includes("!= null")) {
    const field = predicate.split(".").pop()?.split(" ")[0];
    if (field && output.includes(`"${field}": null`)) {
      return true;
    }
  }

  // Check for > 0 violations
  if (predicate.includes("> 0")) {
    const field = predicate.split(".").pop()?.split(" ")[0];
    if (field) {
      const match = output.match(new RegExp(`"${field}":\\s*(-?\\d+)`));
      if (match && parseInt(match[1]!, 10) <= 0) {
        return true;
      }
    }
  }

  return false;
}
