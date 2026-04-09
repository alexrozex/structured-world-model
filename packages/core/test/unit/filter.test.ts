/**
 * Tests for model filtering.
 */

import { filterModel } from "../../src/utils/filter.js";
import type { WorldModelType } from "../../src/schema/index.js";

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

const model: WorldModelType = {
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
      description: "End user",
      tags: ["core"],
      confidence: 0.9,
    },
    {
      id: "ent_2",
      name: "Admin",
      type: "actor",
      description: "Administrator",
      tags: ["core", "admin"],
      confidence: 0.95,
    },
    {
      id: "ent_3",
      name: "Database",
      type: "system",
      description: "Data storage",
      tags: ["infra"],
      confidence: 0.8,
    },
    {
      id: "ent_4",
      name: "Payment",
      type: "object",
      description: "Payment record",
      tags: ["billing"],
      confidence: 0.7,
    },
    {
      id: "ent_5",
      name: "Auth",
      type: "concept",
      description: "Authentication flow",
      tags: ["security"],
      confidence: 0.4,
    },
  ],
  relations: [
    {
      id: "rel_1",
      type: "uses",
      source: "ent_1",
      target: "ent_3",
      label: "queries",
    },
    {
      id: "rel_2",
      type: "controls",
      source: "ent_2",
      target: "ent_3",
      label: "manages",
    },
    {
      id: "rel_3",
      type: "produces",
      source: "ent_1",
      target: "ent_4",
      label: "creates",
    },
    {
      id: "rel_4",
      type: "uses",
      source: "ent_1",
      target: "ent_5",
      label: "authenticates via",
    },
  ],
  processes: [
    {
      id: "proc_1",
      name: "Login",
      description: "User login",
      steps: [{ order: 1, action: "Enter creds", actor: "ent_1" }],
      participants: ["ent_1", "ent_5"],
      outcomes: ["Authenticated"],
    },
    {
      id: "proc_2",
      name: "Pay",
      description: "Payment flow",
      steps: [{ order: 1, action: "Submit", actor: "ent_1" }],
      participants: ["ent_1", "ent_4"],
      outcomes: ["Paid"],
    },
  ],
  constraints: [
    {
      id: "cstr_1",
      name: "Auth Required",
      type: "authorization",
      description: "Must authenticate",
      scope: ["ent_1", "ent_5"],
      severity: "hard",
    },
    {
      id: "cstr_2",
      name: "Rate Limit",
      type: "capacity",
      description: "Max 100 req/s",
      scope: ["ent_3"],
      severity: "soft",
    },
  ],
} as WorldModelType;

function run() {
  console.log("\n\u2500\u2500\u2500 Filter Tests \u2500\u2500\u2500\n");

  // Filter by entity type
  {
    const r = filterModel(model, { entityTypes: ["actor"] });
    assert(r.entities.length === 2, "entityTypes: keeps 2 actors");
    assert(
      r.entities.every((e) => e.type === "actor"),
      "entityTypes: all are actors",
    );
    assert(
      r.relations.length === 0,
      "entityTypes: no actor-to-actor relations in test data",
    );
  }

  // Filter by tag
  {
    const r = filterModel(model, { tags: ["core"] });
    assert(r.entities.length === 2, "tags: keeps 2 'core' entities");
    assert(
      r.entities.some((e) => e.name === "User"),
      "tags: includes User",
    );
    assert(
      r.entities.some((e) => e.name === "Admin"),
      "tags: includes Admin",
    );
  }

  // Filter by confidence
  {
    const r = filterModel(model, { minConfidence: 0.8 });
    assert(r.entities.length === 3, "minConfidence: keeps 3 entities >= 0.8");
    assert(
      !r.entities.some((e) => e.name === "Auth"),
      "minConfidence: excludes Auth (0.4)",
    );
    assert(
      !r.entities.some((e) => e.name === "Payment"),
      "minConfidence: excludes Payment (0.7)",
    );
  }

  // Filter by search
  {
    const r = filterModel(model, { search: "payment" });
    assert(
      r.entities.length === 1,
      "search: finds 1 entity matching 'payment'",
    );
    assert(r.entities[0].name === "Payment", "search: correct entity");
  }

  // Search in description
  {
    const r = filterModel(model, { search: "storage" });
    assert(r.entities.length === 1, "search desc: finds Database by 'storage'");
    assert(r.entities[0].name === "Database", "search desc: correct entity");
  }

  // Filter by constraint severity
  {
    const r = filterModel(model, { constraintSeverity: "hard" });
    assert(
      r.constraints.every((c) => c.severity === "hard"),
      "severity: only hard constraints",
    );
  }

  {
    const r = filterModel(model, { constraintSeverity: "soft" });
    assert(
      r.constraints.every((c) => c.severity === "soft"),
      "severity: only soft constraints",
    );
  }

  // Custom predicate
  {
    const r = filterModel(model, {
      entityPredicate: (e) => e.name.length <= 4,
    });
    assert(
      r.entities.length === 2,
      "predicate: keeps User and Auth (name <= 4 chars)",
    );
  }

  // Relations pruned to surviving entities
  {
    const r = filterModel(model, { entityTypes: ["system"] });
    assert(
      r.relations.length === 0,
      "relations pruned: no system-to-system relations",
    );
  }

  // Processes pruned — only processes with surviving participants
  {
    const r = filterModel(model, { entityTypes: ["actor", "object"] });
    assert(
      r.processes.length === 2,
      "processes pruned: both survive (each has actor participant)",
    );
    // But Login lost its Auth participant
    const login = r.processes.find((p) => p.name === "Login");
    assert(
      login !== undefined && login.participants.length === 1,
      "processes pruned: Login lost Auth participant",
    );
  }

  // Constraints pruned — only constraints with surviving scope
  {
    const r = filterModel(model, { entityTypes: ["system"] });
    assert(
      r.constraints.length <= 1,
      "constraints pruned: only Rate Limit (system scope) survives",
    );
  }

  // Empty filter returns everything
  {
    const r = filterModel(model, {});
    assert(r.entities.length === 5, "empty filter: all entities");
    assert(r.relations.length === 4, "empty filter: all relations");
  }

  // Multiple filters combined
  {
    const r = filterModel(model, { entityTypes: ["actor"], tags: ["admin"] });
    assert(r.entities.length === 1, "combined: actor + admin tag = just Admin");
    assert(r.entities[0].name === "Admin", "combined: correct entity");
  }

  // Filtered model gets new ID
  {
    const r = filterModel(model, { entityTypes: ["actor"] });
    assert(r.id !== model.id, "filtered model gets new ID");
    assert(r.id.startsWith("wm_"), "new ID has wm_ prefix");
  }

  // Preserves model metadata
  {
    const r = filterModel(model, { entityTypes: ["actor"] });
    assert(r.name === "Test", "preserves model name");
    assert(r.version === "0.1.0", "preserves version");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
