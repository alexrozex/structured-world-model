/**
 * Unit tests for deterministic graph queries in the query engine.
 * No LLM calls — only tests pattern-matched graph queries.
 */

import { queryWorldModel } from "../../src/agents/query.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(): WorldModelType {
  return {
    id: "wm_test",
    name: "Test System",
    description: "A test system",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [
      {
        id: "ent_1",
        name: "User",
        type: "actor",
        description: "End user of the system",
      },
      {
        id: "ent_2",
        name: "API Server",
        type: "system",
        description: "REST API backend",
      },
      {
        id: "ent_3",
        name: "Database",
        type: "system",
        description: "PostgreSQL database",
      },
      {
        id: "ent_4",
        name: "Cache",
        type: "resource",
        description: "Redis cache layer",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "uses",
        source: "ent_1",
        target: "ent_2",
        label: "sends requests to",
      },
      {
        id: "rel_2",
        type: "depends_on",
        source: "ent_2",
        target: "ent_3",
        label: "queries data from",
      },
      {
        id: "rel_3",
        type: "uses",
        source: "ent_2",
        target: "ent_4",
        label: "caches responses in",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Request Flow",
        description: "API request handling",
        steps: [
          { order: 1, action: "Receive request", actor: "ent_2" },
          { order: 2, action: "Check cache", actor: "ent_4" },
          { order: 3, action: "Query database", actor: "ent_3" },
        ],
        participants: ["ent_1", "ent_2", "ent_3", "ent_4"],
        outcomes: ["Response sent to user"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Rate Limit",
        type: "capacity",
        description: "Max 1000 requests per minute",
        scope: ["ent_2"],
        severity: "hard",
      },
      {
        id: "cstr_2",
        name: "Data Retention",
        type: "temporal",
        description: "Data must be retained for 90 days",
        scope: ["ent_3"],
        severity: "hard",
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

async function run() {
  console.log("═══ Query Engine Unit Tests ═══\n");
  const model = makeModel();

  // "what depends on X"
  {
    const r = await queryWorldModel(model, "what depends on the API Server?");
    assert(r.method === "graph", "what depends on: uses graph method");
    assert(
      r.answer.includes("User"),
      "what depends on: finds User → API Server",
    );
    assert(r.confidence === 1, "what depends on: full confidence");
  }

  // "what does X depend on"
  {
    const r = await queryWorldModel(model, "what does API Server depend on?");
    assert(r.method === "graph", "what does X depend on: uses graph method");
    assert(
      r.answer.includes("Database"),
      "what does X depend on: finds Database",
    );
    assert(r.answer.includes("Cache"), "what does X depend on: finds Cache");
  }

  // "how is X connected to Y"
  {
    const r = await queryWorldModel(
      model,
      "how is User connected to Database?",
    );
    assert(r.method === "graph", "path query: uses graph method");
    assert(
      r.answer.includes("path") || r.answer.includes("Path"),
      "path query: mentions path",
    );
  }

  // "what constraints apply to X"
  {
    const r = await queryWorldModel(
      model,
      "what constraints apply to API Server?",
    );
    assert(r.method === "graph", "constraints: uses graph method");
    assert(r.answer.includes("Rate Limit"), "constraints: finds Rate Limit");
  }

  // "what constraints apply to Database"
  {
    const r = await queryWorldModel(model, "rules for Database?");
    assert(
      r.answer.includes("Data Retention"),
      "rules for: finds Data Retention",
    );
  }

  // "what is X"
  {
    const r = await queryWorldModel(model, "what is the API Server?");
    assert(r.method === "graph", "what is: uses graph method");
    assert(
      r.answer.includes("REST API backend"),
      "what is: includes description",
    );
    assert(r.answer.includes("User"), "what is: includes dependents");
  }

  // "stats"
  {
    const r = await queryWorldModel(model, "stats?");
    assert(r.method === "graph", "stats: uses graph method");
    assert(r.answer.includes("4"), "stats: shows entity count");
    assert(r.answer.includes("Processes"), "stats: shows processes");
  }

  // "how many entities"
  {
    const r = await queryWorldModel(model, "how many entities?");
    assert(r.method === "graph", "how many: uses graph method");
  }

  // Empty question
  {
    const r = await queryWorldModel(model, "");
    assert(r.answer === "No question provided.", "empty question: handled");
  }

  // Entity not found for "what is" — pattern matches but handler returns null, falls to inference
  // Skip this in unit tests since it requires LLM — tested in E2E instead

  // Query that hits a known entity with no dependents
  {
    const r = await queryWorldModel(model, "what depends on the Database?");
    assert(r.method === "graph", "leaf entity: uses graph method");
    assert(
      r.answer.includes("API Server"),
      "leaf entity: finds API Server depends on Database",
    );
  }

  // "list all systems"
  {
    const r = await queryWorldModel(model, "list all systems");
    assert(r.method === "graph", "list type: uses graph method");
    assert(r.answer.includes("API"), "list type: includes API");
    assert(r.answer.includes("Database"), "list type: includes Database");
  }

  // "show actors"
  {
    const r = await queryWorldModel(model, "show actors");
    assert(r.method === "graph", "show actors: uses graph method");
    assert(r.answer.includes("User"), "show actors: includes User");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
