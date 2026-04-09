/**
 * Model health assessment.
 * Produces a comprehensive report suitable for CI gates and dashboards.
 */

import type { WorldModelType, ValidationResultType } from "../schema/index.js";
import { modelSize } from "./serialize.js";

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export interface HealthReport {
  /** Overall grade: A (excellent) through F (failing) */
  grade: HealthGrade;
  /** Validation score 0-100 */
  score: number;
  /** Human-readable one-line summary */
  summary: string;
  /** Detailed metrics */
  metrics: {
    entities: number;
    relations: number;
    processes: number;
    constraints: number;
    totalElements: number;
    jsonBytes: number;
    /** Ratio of relations to entities (healthy is >= 1.0) */
    relationDensity: number;
    /** % of entities with confidence >= 0.8 */
    highConfidenceRate: number;
    /** % of entities with source_context */
    provenanceRate: number;
    /** Number of entity types used */
    typesDiversity: number;
    /** Number of connected components */
    clusters: number;
    /** % of entities that are orphans (no relations) */
    orphanRate: number;
  };
  /** Specific issues to address */
  issues: string[];
  /** What would improve the grade */
  recommendations: string[];
}

function gradeFromScore(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Assess the health of a world model.
 * Returns a comprehensive report with grade, metrics, issues, and recommendations.
 */
export function assessHealth(
  model: WorldModelType,
  validation?: ValidationResultType,
): HealthReport {
  const size = modelSize(model);
  const score = validation?.score ?? 0;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Relation density
  const relationDensity =
    model.entities.length > 0
      ? model.relations.length / model.entities.length
      : 0;
  if (relationDensity < 0.5 && model.entities.length > 1) {
    issues.push(
      `Low relation density (${relationDensity.toFixed(2)} — healthy is >= 1.0)`,
    );
    recommendations.push(
      "Re-extract with --passes 2 to find implicit relations",
    );
  }

  // Confidence
  const withConfidence = model.entities.filter(
    (e) => e.confidence !== undefined,
  );
  const highConf = withConfidence.filter((e) => e.confidence! >= 0.8);
  const highConfidenceRate =
    withConfidence.length > 0 ? highConf.length / withConfidence.length : 1;
  if (highConfidenceRate < 0.7) {
    issues.push(
      `Only ${Math.round(highConfidenceRate * 100)}% of entities have high confidence`,
    );
    recommendations.push(
      "Review low-confidence entities and verify against source",
    );
  }

  // Provenance
  const withProvenance = model.entities.filter((e) => e.source_context);
  const provenanceRate =
    model.entities.length > 0
      ? withProvenance.length / model.entities.length
      : 0;
  if (provenanceRate < 0.5 && model.entities.length > 0) {
    issues.push(
      `Only ${Math.round(provenanceRate * 100)}% of entities have source provenance`,
    );
    recommendations.push(
      "Re-extract to populate source_context for audit trails",
    );
  }

  // Type diversity
  const typesDiversity = new Set(model.entities.map((e) => e.type)).size;
  if (typesDiversity <= 1 && model.entities.length > 3) {
    issues.push("All entities are the same type — poor type classification");
    recommendations.push(
      "Check extraction prompts or manually reclassify entities",
    );
  }

  // Orphans
  const referencedIds = new Set<string>();
  for (const r of model.relations) {
    referencedIds.add(r.source);
    referencedIds.add(r.target);
  }
  for (const p of model.processes) {
    for (const pid of p.participants) referencedIds.add(pid);
  }
  const orphans = model.entities.filter((e) => !referencedIds.has(e.id));
  const orphanRate =
    model.entities.length > 0 ? orphans.length / model.entities.length : 0;
  if (orphanRate > 0.3 && model.entities.length > 2) {
    issues.push(
      `${Math.round(orphanRate * 100)}% of entities are orphaned (no relations)`,
    );
    recommendations.push(
      "Run swm fix to remove orphans, or extract with multi-pass",
    );
  }

  // Clusters (simple connected components)
  const adj = new Map<string, Set<string>>();
  for (const e of model.entities) adj.set(e.id, new Set());
  for (const r of model.relations) {
    adj.get(r.source)?.add(r.target);
    adj.get(r.target)?.add(r.source);
  }
  const visited = new Set<string>();
  let clusters = 0;
  for (const e of model.entities) {
    if (visited.has(e.id)) continue;
    clusters++;
    const queue = [e.id];
    while (queue.length) {
      const curr = queue.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const n of adj.get(curr) ?? []) {
        if (!visited.has(n)) queue.push(n);
      }
    }
  }
  if (clusters > 3 && model.entities.length > 5) {
    issues.push(`${clusters} disconnected clusters — model may be fragmented`);
    recommendations.push("Check for missing relations between components");
  }

  // Processes
  if (model.processes.length === 0 && model.entities.length > 3) {
    issues.push("No processes extracted");
    recommendations.push(
      "Input may need more detail about workflows and procedures",
    );
  }

  // Constraints
  if (model.constraints.length === 0 && model.entities.length > 3) {
    issues.push("No constraints extracted");
    recommendations.push(
      "Add business rules, invariants, or boundaries to the input",
    );
  }

  const grade = gradeFromScore(score);
  const summary = `Grade ${grade} (${score}/100): ${model.entities.length} entities, ${model.relations.length} relations, ${issues.length} issues`;

  return {
    grade,
    score,
    summary,
    metrics: {
      ...size,
      relationDensity: Math.round(relationDensity * 100) / 100,
      highConfidenceRate: Math.round(highConfidenceRate * 100) / 100,
      provenanceRate: Math.round(provenanceRate * 100) / 100,
      typesDiversity,
      clusters,
      orphanRate: Math.round(orphanRate * 100) / 100,
    },
    issues,
    recommendations,
  };
}
