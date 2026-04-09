/**
 * Tests for model health assessment.
 */

import { assessHealth } from "../../src/utils/health.js";
import type {
  WorldModelType,
  ValidationResultType,
} from "../../src/schema/index.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

function makeModel(overrides: Partial<WorldModelType> = {}): WorldModelType {
  return {
    id: "wm_test",
    name: "Test",
    description: "Test",
    version: "0.1.0",
    created_at: "2026-01-01",
    entities: [
      {
        id: "ent_1",
        name: "User",
        type: "actor",
        description: "A user",
        confidence: 0.9,
        source_context: "Users register",
      },
      {
        id: "ent_2",
        name: "DB",
        type: "system",
        description: "Database",
        confidence: 0.85,
        source_context: "data stored in DB",
      },
      {
        id: "ent_3",
        name: "API",
        type: "system",
        description: "REST API",
        confidence: 0.95,
        source_context: "API handles requests",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "uses",
        source: "ent_1",
        target: "ent_3",
        label: "calls",
      },
      {
        id: "rel_2",
        type: "uses",
        source: "ent_3",
        target: "ent_2",
        label: "queries",
      },
      {
        id: "rel_3",
        type: "depends_on",
        source: "ent_1",
        target: "ent_2",
        label: "needs",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Login",
        description: "Auth",
        steps: [{ order: 1, action: "Auth", actor: "ent_1" }],
        participants: ["ent_1", "ent_3"],
        outcomes: ["Token"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Auth",
        type: "authorization",
        description: "Must auth",
        scope: ["ent_1"],
        severity: "hard",
      },
    ],
    ...overrides,
  } as WorldModelType;
}

const goodValidation: ValidationResultType = {
  valid: true,
  issues: [],
  stats: { entities: 3, relations: 3, processes: 1, constraints: 1 },
  score: 100,
} as ValidationResultType;

function run() {
  console.log("\n\u2500\u2500\u2500 Health Tests \u2500\u2500\u2500\n");

  // Healthy model gets grade A
  {
    const r = assessHealth(makeModel(), goodValidation);
    assert(r.grade === "A", "healthy model: grade A");
    assert(r.score === 100, "healthy model: score 100");
    assert(r.issues.length === 0, "healthy model: no issues");
  }

  // Grade mapping
  {
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 95 } as any)
        .grade === "A",
      "grade: 95 → A",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 80 } as any)
        .grade === "B",
      "grade: 80 → B",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 65 } as any)
        .grade === "C",
      "grade: 65 → C",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 45 } as any)
        .grade === "D",
      "grade: 45 → D",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 20 } as any)
        .grade === "F",
      "grade: 20 → F",
    );
  }

  // Low relation density flagged
  {
    const sparse = makeModel({ relations: [] });
    const r = assessHealth(sparse, { ...goodValidation, score: 50 } as any);
    assert(
      r.issues.some((i) => i.includes("relation density")),
      "sparse: flags low relation density",
    );
    assert(r.metrics.relationDensity === 0, "sparse: density is 0");
  }

  // Orphan rate
  {
    const orphans = makeModel({
      entities: [
        { id: "ent_1", name: "A", type: "actor", description: "a" },
        { id: "ent_2", name: "B", type: "actor", description: "b" },
        { id: "ent_3", name: "C", type: "actor", description: "c" },
        { id: "ent_4", name: "D", type: "actor", description: "d" },
      ],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "x",
        },
      ],
      processes: [],
      constraints: [],
    });
    const r = assessHealth(orphans, { ...goodValidation, score: 50 } as any);
    assert(r.metrics.orphanRate === 0.5, "orphans: 50% orphan rate");
    assert(
      r.issues.some((i) => i.includes("orphaned")),
      "orphans: flagged",
    );
  }

  // Low confidence flagged
  {
    const lowConf = makeModel({
      entities: [
        {
          id: "ent_1",
          name: "A",
          type: "actor",
          description: "a",
          confidence: 0.3,
        },
        {
          id: "ent_2",
          name: "B",
          type: "actor",
          description: "b",
          confidence: 0.2,
        },
        {
          id: "ent_3",
          name: "C",
          type: "actor",
          description: "c",
          confidence: 0.4,
        },
      ],
    });
    const r = assessHealth(lowConf, { ...goodValidation, score: 50 } as any);
    assert(r.metrics.highConfidenceRate === 0, "low conf: 0% high confidence");
    assert(
      r.issues.some((i) => i.includes("confidence")),
      "low conf: flagged",
    );
  }

  // Low provenance flagged
  {
    const noProv = makeModel({
      entities: [
        { id: "ent_1", name: "A", type: "actor", description: "a" },
        { id: "ent_2", name: "B", type: "system", description: "b" },
        { id: "ent_3", name: "C", type: "object", description: "c" },
      ],
    });
    const r = assessHealth(noProv, { ...goodValidation, score: 50 } as any);
    assert(r.metrics.provenanceRate === 0, "no prov: 0% provenance");
    assert(
      r.issues.some((i) => i.includes("provenance")),
      "no prov: flagged",
    );
  }

  // Type diversity
  {
    const monoType = makeModel({
      entities: [
        { id: "ent_1", name: "A", type: "object", description: "a" },
        { id: "ent_2", name: "B", type: "object", description: "b" },
        { id: "ent_3", name: "C", type: "object", description: "c" },
        { id: "ent_4", name: "D", type: "object", description: "d" },
      ],
    });
    const r = assessHealth(monoType, { ...goodValidation, score: 50 } as any);
    assert(r.metrics.typesDiversity === 1, "mono type: diversity 1");
    assert(
      r.issues.some((i) => i.includes("same type")),
      "mono type: flagged",
    );
  }

  // No processes flagged
  {
    const noProc = makeModel({
      entities: [
        ...makeModel().entities,
        { id: "ent_4", name: "Extra", type: "object", description: "extra" },
      ],
      processes: [],
    });
    const r = assessHealth(noProc, { ...goodValidation, score: 50 } as any);
    assert(
      r.issues.some((i) => i.includes("No processes")),
      "no processes: flagged",
    );
  }

  // No constraints flagged
  {
    const noCstr = makeModel({
      entities: [
        ...makeModel().entities,
        { id: "ent_4", name: "Extra", type: "object", description: "extra" },
      ],
      constraints: [],
    });
    const r = assessHealth(noCstr, { ...goodValidation, score: 50 } as any);
    assert(
      r.issues.some((i) => i.includes("No constraints")),
      "no constraints: flagged",
    );
  }

  // Summary includes key info
  {
    const r = assessHealth(makeModel(), goodValidation);
    assert(r.summary.includes("Grade A"), "summary: includes grade");
    assert(r.summary.includes("100"), "summary: includes score");
    assert(r.summary.includes("3 entities"), "summary: includes entity count");
  }

  // Metrics structure
  {
    const r = assessHealth(makeModel(), goodValidation);
    assert(
      typeof r.metrics.jsonBytes === "number",
      "metrics: jsonBytes is number",
    );
    assert(r.metrics.entities === 3, "metrics: correct entity count");
    assert(r.metrics.clusters >= 1, "metrics: at least 1 cluster");
  }

  // Empty model
  {
    const empty = makeModel({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const r = assessHealth(empty);
    assert(r.grade === "F", "empty: grade F (score 0)");
    assert(r.metrics.totalElements === 0, "empty: zero elements");
  }

  // Recommendations present when issues exist
  {
    const bad = makeModel({ relations: [], processes: [], constraints: [] });
    const r = assessHealth(bad, { ...goodValidation, score: 30 } as any);
    assert(r.recommendations.length > 0, "bad model: has recommendations");
    assert(
      r.recommendations.length >= r.issues.length,
      "recommendations >= issues",
    );
  }

  // Grade boundary tests
  {
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 90 } as any)
        .grade === "A",
      "boundary: 90 = A",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 89 } as any)
        .grade === "B",
      "boundary: 89 = B",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 75 } as any)
        .grade === "B",
      "boundary: 75 = B",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 74 } as any)
        .grade === "C",
      "boundary: 74 = C",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 60 } as any)
        .grade === "C",
      "boundary: 60 = C",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 59 } as any)
        .grade === "D",
      "boundary: 59 = D",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 40 } as any)
        .grade === "D",
      "boundary: 40 = D",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 39 } as any)
        .grade === "F",
      "boundary: 39 = F",
    );
    assert(
      assessHealth(makeModel(), { ...goodValidation, score: 0 } as any)
        .grade === "F",
      "boundary: 0 = F",
    );
  }

  // Multiple clusters detection
  {
    const multiCluster = makeModel({
      entities: [
        { id: "ent_1", name: "A", type: "actor", description: "a" },
        { id: "ent_2", name: "B", type: "actor", description: "b" },
        { id: "ent_3", name: "C", type: "system", description: "c" },
        { id: "ent_4", name: "D", type: "system", description: "d" },
        { id: "ent_5", name: "E", type: "object", description: "e" },
        { id: "ent_6", name: "F", type: "object", description: "f" },
      ],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "x",
        },
        {
          id: "rel_2",
          type: "uses",
          source: "ent_3",
          target: "ent_4",
          label: "y",
        },
      ],
      processes: [],
      constraints: [],
    });
    const r = assessHealth(multiCluster, {
      ...goodValidation,
      score: 50,
    } as any);
    assert(
      r.metrics.clusters >= 3,
      "multi-cluster: detects 3+ clusters (A-B, C-D, E, F)",
    );
    assert(
      r.issues.some((i) => i.includes("cluster")),
      "multi-cluster: flagged",
    );
  }

  // High provenance rate not flagged
  {
    const highProv = makeModel({
      entities: [
        {
          id: "ent_1",
          name: "A",
          type: "actor",
          description: "a",
          source_context: "from input",
        },
        {
          id: "ent_2",
          name: "B",
          type: "system",
          description: "b",
          source_context: "from input",
        },
        {
          id: "ent_3",
          name: "C",
          type: "object",
          description: "c",
          source_context: "from input",
        },
      ],
    });
    const r = assessHealth(highProv, goodValidation);
    assert(r.metrics.provenanceRate === 1, "full provenance: rate 1.0");
    assert(
      !r.issues.some((i) => i.includes("provenance")),
      "full provenance: not flagged",
    );
  }

  // Relation density exactly at threshold
  {
    const atThreshold = makeModel({
      entities: [
        { id: "ent_1", name: "A", type: "actor", description: "a" },
        { id: "ent_2", name: "B", type: "system", description: "b" },
      ],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "x",
        },
      ],
      processes: [],
      constraints: [],
    });
    const r = assessHealth(atThreshold, goodValidation);
    assert(r.metrics.relationDensity === 0.5, "density: exactly 0.5");
    assert(
      !r.issues.some((i) => i.includes("relation density")),
      "density: 0.5 not flagged (threshold is <0.5)",
    );
  }

  // Single entity model
  {
    const single = makeModel({
      entities: [
        { id: "ent_1", name: "Solo", type: "actor", description: "alone" },
      ],
      relations: [],
      processes: [],
      constraints: [],
    });
    const r = assessHealth(single);
    assert(r.metrics.entities === 1, "single: 1 entity");
    assert(r.metrics.clusters === 1, "single: 1 cluster");
    assert(
      !r.issues.some((i) => i.includes("orphan")),
      "single: no orphan warning for 1 entity",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
