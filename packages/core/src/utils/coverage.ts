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

/** Compute word overlap between two names (0-1). Ignores stopwords. */
function wordOverlap(a: string, b: string): number {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "for",
    "in",
    "on",
    "to",
    "with",
    "by",
    "is",
  ]);
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !stopwords.has(w)),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

/**
 * Find the best fuzzy match for a name in a set.
 * Returns the matched name if overlap >= threshold, or null.
 */
function fuzzyMatch(
  name: string,
  candidates: Map<string, string>,
  threshold = 0.5,
): string | null {
  let bestMatch: string | null = null;
  let bestScore = 0;
  for (const [normalized, original] of candidates) {
    const score = wordOverlap(name, normalized);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = original;
    }
  }
  return bestMatch;
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
  // Entity coverage: exact match first, then fuzzy word-overlap fallback
  const aEntityNames = new Set(a.entities.map((e) => normalize(e.name)));
  const bEntityNames = new Set(b.entities.map((e) => normalize(e.name)));
  const bEntityMap = new Map(
    b.entities.map((e) => [normalize(e.name), e.name]),
  );

  const exactCovered = [...aEntityNames].filter((n) => bEntityNames.has(n));
  const exactMissing = [...aEntityNames].filter((n) => !bEntityNames.has(n));

  // Fuzzy match remaining missing entities against B's unmatched entities
  const bUnmatched = new Map(
    [...bEntityMap].filter(([n]) => !aEntityNames.has(n)),
  );
  const fuzzyCovered: string[] = [];
  const trulyMissing: string[] = [];
  for (const aN of exactMissing) {
    const match = fuzzyMatch(aN, bUnmatched);
    if (match) {
      fuzzyCovered.push(aN);
      // Remove matched B entity so it can't match twice
      for (const [k, v] of bUnmatched) {
        if (v === match) {
          bUnmatched.delete(k);
          break;
        }
      }
    } else {
      const original =
        a.entities.find((e) => normalize(e.name) === aN)?.name ?? aN;
      trulyMissing.push(original);
    }
  }

  const coveredEntities = [...exactCovered, ...fuzzyCovered];
  const missingEntities = trulyMissing;
  const extraEntities = [...bUnmatched.values()];

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

  // Process coverage: exact + fuzzy
  const aProcNames = new Set(a.processes.map((p) => normalize(p.name)));
  const bProcNames = new Set(b.processes.map((p) => normalize(p.name)));
  const bProcMap = new Map(b.processes.map((p) => [normalize(p.name), p.name]));
  const exactProcs = [...aProcNames].filter((n) => bProcNames.has(n));
  const bProcUnmatched = new Map(
    [...bProcMap].filter(([n]) => !aProcNames.has(n)),
  );
  const fuzzyProcs: string[] = [];
  const missingProcesses: string[] = [];
  for (const aN of [...aProcNames].filter((n) => !bProcNames.has(n))) {
    const match = fuzzyMatch(aN, bProcUnmatched);
    if (match) {
      fuzzyProcs.push(aN);
      for (const [k, v] of bProcUnmatched) {
        if (v === match) {
          bProcUnmatched.delete(k);
          break;
        }
      }
    } else {
      missingProcesses.push(
        a.processes.find((p) => normalize(p.name) === aN)?.name ?? aN,
      );
    }
  }
  const coveredProcs = [...exactProcs, ...fuzzyProcs];

  // Constraint coverage: exact + fuzzy
  const aCstrNames = new Set(a.constraints.map((c) => normalize(c.name)));
  const bCstrNames = new Set(b.constraints.map((c) => normalize(c.name)));
  const bCstrMap = new Map(
    b.constraints.map((c) => [normalize(c.name), c.name]),
  );
  const exactCstrs = [...aCstrNames].filter((n) => bCstrNames.has(n));
  const bCstrUnmatched = new Map(
    [...bCstrMap].filter(([n]) => !aCstrNames.has(n)),
  );
  const fuzzyCstrs: string[] = [];
  const missingConstraints: string[] = [];
  for (const aN of [...aCstrNames].filter((n) => !bCstrNames.has(n))) {
    const match = fuzzyMatch(aN, bCstrUnmatched);
    if (match) {
      fuzzyCstrs.push(aN);
      for (const [k, v] of bCstrUnmatched) {
        if (v === match) {
          bCstrUnmatched.delete(k);
          break;
        }
      }
    } else {
      missingConstraints.push(
        a.constraints.find((c) => normalize(c.name) === aN)?.name ?? aN,
      );
    }
  }
  const coveredCstrs = [...exactCstrs, ...fuzzyCstrs];

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
