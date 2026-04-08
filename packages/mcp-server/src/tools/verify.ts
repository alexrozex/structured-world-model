import { loadBlueprint } from "../state.js";
import type { VerifyResult } from "../types.js";

export function verifyCode(code: string, entityName: string): { content: string; isError: boolean } {
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

  const violations: string[] = [];
  const postcodes: string[] = [blueprint.dataModel.postcode.raw];

  for (const inv of entity.invariants) {
    if (!code.includes(inv.predicate.split(".").pop()!.split(" ")[0]!)) {
      violations.push(`Invariant not addressed: ${inv.predicate} — ${inv.description}`);
    }
  }

  const result: VerifyResult = {
    pass: violations.length === 0,
    violations,
    postcodes,
  };

  return { content: JSON.stringify(result), isError: false };
}
