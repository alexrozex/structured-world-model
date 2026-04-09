/**
 * Tests for summary card export.
 */

import { toSummaryCard } from "../../src/export/summary-card.js";
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
  name: "Test System",
  description: "A test system for cards",
  version: "1.0.0",
  created_at: "2026-01-01",
  entities: [
    { id: "ent_1", name: "User", type: "actor", description: "End user" },
    { id: "ent_2", name: "Admin", type: "actor", description: "Administrator" },
    {
      id: "ent_3",
      name: "API",
      type: "system",
      description: "REST API server",
    },
    {
      id: "ent_4",
      name: "Database",
      type: "system",
      description: "Data storage",
    },
    {
      id: "ent_5",
      name: "Order",
      type: "object",
      description: "Purchase order",
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
      target: "ent_4",
      label: "queries",
    },
    {
      id: "rel_3",
      type: "produces",
      source: "ent_1",
      target: "ent_5",
      label: "creates",
    },
  ],
  processes: [
    {
      id: "proc_1",
      name: "Order Flow",
      description: "User creates and submits an order",
      steps: [{ order: 1, action: "Submit", actor: "ent_1" }],
      participants: ["ent_1"],
      outcomes: ["Order created"],
    },
  ],
  constraints: [
    {
      id: "cstr_1",
      name: "Auth Required",
      type: "authorization",
      description: "Must authenticate before ordering",
      scope: ["ent_1"],
      severity: "hard",
    },
    {
      id: "cstr_2",
      name: "Rate Limit",
      type: "capacity",
      description: "Max 100 orders per minute",
      scope: ["ent_3"],
      severity: "soft",
    },
  ],
  metadata: { source_type: "text", source_summary: "Test", confidence: 0.9 },
} as WorldModelType;

function run() {
  console.log("\n\u2500\u2500\u2500 Summary Card Tests \u2500\u2500\u2500\n");

  // Has model name as heading
  {
    const card = toSummaryCard(model);
    assert(card.includes("## Test System"), "has model name heading");
  }

  // Has description
  {
    const card = toSummaryCard(model);
    assert(card.includes("A test system for cards"), "has description");
  }

  // Has stats line
  {
    const card = toSummaryCard(model);
    assert(card.includes("5 entities"), "has entity count");
    assert(card.includes("3 relations"), "has relation count");
    assert(card.includes("1 processes"), "has process count");
  }

  // Has confidence
  {
    const card = toSummaryCard(model);
    assert(card.includes("90%"), "has confidence percentage");
  }

  // Has entity types breakdown
  {
    const card = toSummaryCard(model);
    assert(card.includes("**actor:**"), "has actor type");
    assert(card.includes("User, Admin"), "has actor names");
    assert(card.includes("**system:**"), "has system type");
  }

  // Has relationships
  {
    const card = toSummaryCard(model);
    assert(card.includes("Key Relationships"), "has relationships section");
    assert(card.includes("User"), "relationships mention User");
    assert(card.includes("*uses*"), "relationships show type");
  }

  // Has processes
  {
    const card = toSummaryCard(model);
    assert(card.includes("Order Flow"), "has process name");
  }

  // Shows only hard constraints
  {
    const card = toSummaryCard(model);
    assert(card.includes("Auth Required"), "has hard constraint");
    assert(!card.includes("Rate Limit"), "excludes soft constraint");
  }

  // Has version footer
  {
    const card = toSummaryCard(model);
    assert(card.includes("v1.0.0"), "has version in footer");
    assert(card.includes("SWM"), "has SWM attribution");
  }

  // Empty model doesn't crash
  {
    const empty = {
      ...model,
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
      metadata: undefined,
    } as WorldModelType;
    const card = toSummaryCard(empty);
    assert(card.includes("## Test System"), "empty: still has heading");
    assert(card.includes("0 entities"), "empty: shows zero");
  }

  // Long descriptions truncated
  {
    const longProc = {
      ...model,
      processes: [{ ...model.processes[0], description: "A".repeat(200) }],
    } as WorldModelType;
    const card = toSummaryCard(longProc);
    assert(card.includes("..."), "long description truncated");
  }

  // Many relations shows "and N more"
  {
    const manyRels = {
      ...model,
      relations: Array.from({ length: 8 }, (_, i) => ({
        id: `rel_${i}`,
        type: "uses" as const,
        source: "ent_1",
        target: "ent_3",
        label: `rel ${i}`,
      })),
    } as WorldModelType;
    const card = toSummaryCard(manyRels);
    assert(card.includes("and 3 more"), "many relations shows overflow count");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
