import { loadBlueprint } from "../state.js";

export function getInvariants(entityName: string): { content: string; isError: boolean } {
  const blueprint = loadBlueprint();
  if (!blueprint) {
    return { content: "No active blueprint found.", isError: true };
  }

  const entity = blueprint.dataModel.entities.find(
    (e) => e.name.toLowerCase() === entityName.toLowerCase()
  );
  if (!entity) {
    return { content: `Entity "${entityName}" not found in blueprint.`, isError: true };
  }

  const predicates = entity.invariants.map((inv) => inv.predicate);
  return { content: JSON.stringify(predicates), isError: false };
}
