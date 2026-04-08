import { loadBlueprint } from "../state.js";
import type { ConstraintQueryResult } from "../types.js";

export function queryConstraints(scope: string): {
  content: string;
  isError: boolean;
} {
  const blueprint = loadBlueprint();
  if (!blueprint) {
    return {
      content: "No active blueprint found. Run ada init first.",
      isError: true,
    };
  }

  const lower = scope.toLowerCase();

  const entities = blueprint.dataModel.entities
    .filter((e) => {
      const nameMatch = e.name.toLowerCase().includes(lower);
      const invariantMatch = e.invariants.some(
        (inv) =>
          inv.predicate.toLowerCase().includes(lower) ||
          inv.description.toLowerCase().includes(lower),
      );
      return nameMatch || invariantMatch;
    })
    .map((e) => ({
      name: e.name,
      invariants: e.invariants.map(
        (inv) => `${inv.predicate} — ${inv.description}`,
      ),
    }));

  const workflows = blueprint.processModel.workflows
    .filter((wf) => {
      const nameMatch = wf.name.toLowerCase().includes(lower);
      const stepMatch = wf.steps.some(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          s.hoareTriple.action.toLowerCase().includes(lower) ||
          s.hoareTriple.precondition.toLowerCase().includes(lower) ||
          s.hoareTriple.postcondition.toLowerCase().includes(lower),
      );
      return nameMatch || stepMatch;
    })
    .map((wf) => ({
      name: wf.name,
      steps: wf.steps.map((s) => s.name),
    }));

  const result: ConstraintQueryResult = {
    entities,
    workflows,
    postcodes: [blueprint.postcode.raw],
  };

  return { content: JSON.stringify(result, null, 2), isError: false };
}
