/**
 * Unit tests for graph operations.
 */

import {
  findEntity,
  findDependents,
  pathsBetween,
  toMermaid,
  toDot,
  getStats,
  summarize,
  subgraph,
} from "../../src/utils/graph.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(): WorldModelType {
  return {
    id: "wm_test",
    name: "Graph Test",
    description: "Test model for graph ops",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [
      { id: "ent_1", name: "User", type: "actor", description: "A user" },
      { id: "ent_2", name: "API", type: "system", description: "API server" },
      { id: "ent_3", name: "Database", type: "system", description: "DB" },
      {
        id: "ent_4",
        name: "Cache",
        type: "resource",
        description: "Redis cache",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "uses",
        source: "ent_1",
        target: "ent_2",
        label: "calls",
      },
      {
        id: "rel_2",
        type: "depends_on",
        source: "ent_2",
        target: "ent_3",
        label: "queries",
      },
      {
        id: "rel_3",
        type: "uses",
        source: "ent_2",
        target: "ent_4",
        label: "caches",
      },
      {
        id: "rel_4",
        type: "depends_on",
        source: "ent_4",
        target: "ent_3",
        label: "backs",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Request",
        description: "API request",
        steps: [{ order: 1, action: "handle", actor: "ent_2" }],
        participants: ["ent_1", "ent_2"],
        outcomes: ["response"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Uptime",
        type: "invariant",
        description: "99.9%",
        scope: ["ent_2"],
        severity: "hard",
      },
      {
        id: "cstr_2",
        name: "TTL",
        type: "temporal",
        description: "Cache 5min",
        scope: ["ent_4"],
        severity: "soft",
      },
    ],
    metadata: { source_type: "text", source_summary: "test", confidence: 0.9 },
  };
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function run() {
  console.log("═══ Graph Operations Unit Tests ═══\n");

  const model = makeModel();

  // ─── findEntity ──────────────────────────────────────

  assert(findEntity(model, "User")?.id === "ent_1", "findEntity: exact match");
  assert(
    findEntity(model, "user")?.id === "ent_1",
    "findEntity: case-insensitive",
  );
  assert(
    findEntity(model, "Data")?.id === "ent_3",
    "findEntity: partial match",
  );
  assert(
    findEntity(model, "nonexistent") === undefined,
    "findEntity: returns undefined for no match",
  );

  // ─── findDependents ──────────────────────────────────

  {
    const deps = findDependents(model, "ent_2"); // API
    assert(
      deps.incoming.length === 1,
      "findDependents: correct incoming count for API",
    );
    assert(
      deps.incoming[0].entity.name === "User",
      "findDependents: User → API",
    );
    assert(
      deps.outgoing.length === 2,
      "findDependents: correct outgoing count for API",
    );
  }

  {
    const deps = findDependents(model, "ent_3"); // Database
    assert(
      deps.incoming.length === 2,
      "findDependents: Database has 2 incoming (API + Cache)",
    );
    assert(
      deps.outgoing.length === 0,
      "findDependents: Database has 0 outgoing",
    );
  }

  // ─── pathsBetween ────────────────────────────────────

  {
    const paths = pathsBetween(model, "ent_1", "ent_3");
    assert(
      paths.length >= 1,
      "pathsBetween: finds at least 1 path from User to Database",
    );
    assert(paths[0].length >= 2, "pathsBetween: path has at least 2 hops");
  }

  {
    const paths = pathsBetween(model, "ent_3", "ent_1"); // reverse — no path (directed)
    // May find 0 paths since relations are directed
    assert(
      paths.length === 0,
      "pathsBetween: no path in reverse direction (directed graph)",
    );
  }

  // ─── toMermaid ───────────────────────────────────────

  {
    const mermaid = toMermaid(model);
    assert(mermaid.startsWith("graph TD"), "toMermaid: starts with graph TD");
    assert(mermaid.includes("ent_1"), "toMermaid: includes entity IDs");
    assert(mermaid.includes("uses"), "toMermaid: includes relation types");
    assert(mermaid.includes("-->"), "toMermaid: includes arrows");
  }

  // ─── toDot ───────────────────────────────────────────

  {
    const dot = toDot(model);
    assert(dot.startsWith("digraph WorldModel"), "toDot: starts with digraph");
    assert(dot.includes("ent_1"), "toDot: includes entity IDs");
    assert(dot.includes("->"), "toDot: includes directed edges");
    assert(dot.includes("}"), "toDot: properly closed");
  }

  // ─── getStats ────────────────────────────────────────

  {
    const stats = getStats(model);
    assert(stats.entities.total === 4, "getStats: correct entity total");
    assert(stats.relations.total === 4, "getStats: correct relation total");
    assert(stats.processes.total === 1, "getStats: correct process total");
    assert(stats.processes.totalSteps === 1, "getStats: correct total steps");
    assert(stats.constraints.total === 2, "getStats: correct constraint total");
    assert(
      stats.constraints.hard === 1,
      "getStats: correct hard constraint count",
    );
    assert(
      stats.constraints.soft === 1,
      "getStats: correct soft constraint count",
    );
    assert(
      stats.mostConnected.length > 0,
      "getStats: identifies most connected entities",
    );
    assert(
      stats.mostConnected[0].entity === "API",
      "getStats: API is most connected",
    );
    assert(stats.confidence === 0.9, "getStats: correct confidence");
  }

  // ─── summarize ───────────────────────────────────────

  {
    const s = summarize(model);
    assert(s.includes("4 entities"), "summarize: includes entity count");
    assert(s.includes("4 relations"), "summarize: includes relation count");
    assert(s.includes("API"), "summarize: includes most connected entity");
    assert(s.includes("Request"), "summarize: includes process name");
    assert(s.includes("2 constraints"), "summarize: includes constraint count");
    assert(s.includes("90%"), "summarize: includes confidence percentage");
  }

  // ─── subgraph ────────────────────────────────────────

  // 1 hop from API: should get User (incoming), Database, Cache (outgoing)
  {
    const sub = subgraph(model, "ent_2", 1);
    assert(
      sub.entities.length === 4,
      "subgraph 1-hop: 4 entities (API + 3 neighbors)",
    );
    assert(
      sub.relations.length === 4,
      "subgraph 1-hop: 4 relations (all endpoints within subgraph)",
    );
    assert(
      sub.entities.some((e) => e.name === "User"),
      "subgraph 1-hop: includes User",
    );
    assert(
      sub.entities.some((e) => e.name === "Database"),
      "subgraph 1-hop: includes Database",
    );
    assert(
      sub.entities.some((e) => e.name === "Cache"),
      "subgraph 1-hop: includes Cache",
    );
  }

  // 0 hops: just the center entity, no relations
  {
    const sub = subgraph(model, "ent_2", 0);
    assert(sub.entities.length === 1, "subgraph 0-hop: just center entity");
    assert(sub.entities[0].name === "API", "subgraph 0-hop: correct entity");
    assert(
      sub.relations.length === 0,
      "subgraph 0-hop: no relations (both endpoints must be in set)",
    );
  }

  // Leaf entity: Database has incoming but no outgoing
  {
    const sub = subgraph(model, "ent_3", 1);
    assert(
      sub.entities.some((e) => e.name === "Database"),
      "subgraph leaf: includes center",
    );
    assert(
      sub.entities.some((e) => e.name === "API"),
      "subgraph leaf: includes API (incoming)",
    );
    assert(
      sub.entities.some((e) => e.name === "Cache"),
      "subgraph leaf: includes Cache (incoming)",
    );
  }

  // Subgraph includes relevant processes
  {
    const sub = subgraph(model, "ent_2", 1);
    assert(
      sub.processes.length >= 1,
      "subgraph: includes processes with participants in subgraph",
    );
  }

  // Subgraph includes relevant constraints
  {
    const sub = subgraph(model, "ent_2", 1);
    assert(
      sub.constraints.length >= 1,
      "subgraph: includes constraints scoped to subgraph entities",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
