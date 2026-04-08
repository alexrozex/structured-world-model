import type { WorldModelType } from "../schema/index.js";

export interface CoverageResult {
  /** What percentage of A's entities appear in B (by name) */
  entityCoverage: number;
  /** What percentage of A's relations appear in B */
  relationCoverage: number;
  /** What percentage of A's processes appear in B */
  processCoverage: number;
  /** What percentage of A's constraints appear in B */
  constraintCoverage: number;
  /** Overall weighted coverage */
  overall: number;
  /** Entities in A missing from B */
  missingEntities: string[];
  /** Entities in B not in A (extra) */
  extraEntities: string[];
  /** Relations in A missing from B */
  missingRelations: string[];
  /** Processes in A missing from B */
  missingProcesses: string[];
  /** Constraints in A missing from B */
  missingConstraints: string[];
}

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

function pct(covered: number, total: number): number {
  if (total === 0) return 1; // empty set is fully covered
  return Math.round((covered / total) * 100) / 100;
}

/**
 * Measure how much of model A is covered by model B.
 * "Does B contain everything A specifies?"
 */
export function coverage(a: WorldModelType, b: WorldModelType): CoverageResult {
  // Entity coverage by normalized name
  const aEntityNames = new Set(a.entities.map((e) => normalize(e.name)));
  const bEntityNames = new Set(b.entities.map((e) => normalize(e.name)));

  const coveredEntities = [...aEntityNames].filter((n) => bEntityNames.has(n));
  const missingEntities = [...aEntityNames]
    .filter((n) => !bEntityNames.has(n))
    .map((n) => a.entities.find((e) => normalize(e.name) === n)?.name ?? n);
  const extraEntities = [...bEntityNames]
    .filter((n) => !aEntityNames.has(n))
    .map((n) => b.entities.find((e) => normalize(e.name) === n)?.name ?? n);

  // Relation coverage by (source name, type, target name)
  const relKey = (
    r: WorldModelType["relations"][number],
    model: WorldModelType,
  ) => {
    const src = normalize(
      model.entities.find((e) => e.id === r.source)?.name ?? r.source,
    );
    const tgt = normalize(
      model.entities.find((e) => e.id === r.target)?.name ?? r.target,
    );
    return `${src}::${r.type}::${tgt}`;
  };

  const aRelKeys = a.relations.map((r) => relKey(r, a));
  const bRelSet = new Set(b.relations.map((r) => relKey(r, b)));
  const coveredRels = aRelKeys.filter((k) => bRelSet.has(k));
  const missingRelations = aRelKeys.filter((k) => !bRelSet.has(k));

  // Process coverage by normalized name
  const aProcNames = new Set(a.processes.map((p) => normalize(p.name)));
  const bProcNames = new Set(b.processes.map((p) => normalize(p.name)));
  const coveredProcs = [...aProcNames].filter((n) => bProcNames.has(n));
  const missingProcesses = [...aProcNames]
    .filter((n) => !bProcNames.has(n))
    .map((n) => a.processes.find((p) => normalize(p.name) === n)?.name ?? n);

  // Constraint coverage by normalized name
  const aCstrNames = new Set(a.constraints.map((c) => normalize(c.name)));
  const bCstrNames = new Set(b.constraints.map((c) => normalize(c.name)));
  const coveredCstrs = [...aCstrNames].filter((n) => bCstrNames.has(n));
  const missingConstraints = [...aCstrNames]
    .filter((n) => !bCstrNames.has(n))
    .map((n) => a.constraints.find((c) => normalize(c.name) === n)?.name ?? n);

  const entityCoverage = pct(coveredEntities.length, aEntityNames.size);
  const relationCoverage = pct(coveredRels.length, aRelKeys.length);
  const processCoverage = pct(coveredProcs.length, aProcNames.size);
  const constraintCoverage = pct(coveredCstrs.length, aCstrNames.size);

  // Weighted overall: entities 40%, relations 30%, processes 15%, constraints 15%
  const overall =
    Math.round(
      (entityCoverage * 0.4 +
        relationCoverage * 0.3 +
        processCoverage * 0.15 +
        constraintCoverage * 0.15) *
        100,
    ) / 100;

  return {
    entityCoverage,
    relationCoverage,
    processCoverage,
    constraintCoverage,
    overall,
    missingEntities,
    extraEntities,
    missingRelations,
    missingProcesses,
    missingConstraints,
  };
}
