/**
 * Integration test: exercises the full pipeline without LLM calls.
 * Structuring → Validation → Fix → Query → Export → Merge → Diff → Coverage → Subgraph → Clusters → Timeline
 */

import { structuringAgent } from "../../src/agents/structuring.js";
import { validationAgent } from "../../src/agents/validation.js";
import { fixWorldModel } from "../../src/utils/fix.js";
import { queryWorldModel } from "../../src/agents/query.js";
import { toClaudeMd } from "../../src/export/claude-md.js";
import { toSystemPrompt } from "../../src/export/system-prompt.js";
import { toMcpSchema } from "../../src/export/mcp-schema.js";
import { mergeWorldModels, diffWorldModels } from "../../src/utils/merge.js";
import { coverage } from "../../src/utils/coverage.js";
import { intersection, difference, overlay } from "../../src/utils/algebra.js";
import {
  findEntity,
  findDependents,
  pathsBetween,
  subgraph,
  findClusters,
  summarize,
  getStats,
  toMermaid,
  toDot,
} from "../../src/utils/graph.js";
import {
  createTimeline,
  addSnapshot,
  entityHistory,
} from "../../src/utils/timeline.js";
import { getWorldModelJsonSchema } from "../../src/schema/json-schema.js";
import type { RawExtraction } from "../../src/agents/extraction.js";

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
  console.log("═══ Integration Test ═══\n");

  // ─── 1. Structure a raw extraction ───────────────────
  const extraction: RawExtraction = {
    entities: [
      {
        name: "Customer",
        type: "actor",
        description: "Person who buys products",
      },
      {
        name: "Product",
        type: "object",
        description: "Item for sale with price and inventory",
      },
      {
        name: "Cart",
        type: "object",
        description: "Shopping cart holding products",
      },
      {
        name: "Order",
        type: "object",
        description: "Completed purchase with payment",
      },
      {
        name: "Payment Gateway",
        type: "system",
        description: "Processes credit card payments",
      },
      {
        name: "Warehouse",
        type: "location",
        description: "Stores physical products",
      },
    ],
    relations: [
      { source: "Customer", target: "Cart", type: "has", label: "owns" },
      { source: "Cart", target: "Product", type: "contains", label: "holds" },
      {
        source: "Customer",
        target: "Order",
        type: "produces",
        label: "places",
      },
      {
        source: "Order",
        target: "Payment Gateway",
        type: "uses",
        label: "processes payment",
      },
      {
        source: "Product",
        target: "Warehouse",
        type: "located_in",
        label: "stored in",
      },
    ],
    processes: [
      {
        name: "Checkout",
        description: "Customer completes purchase",
        trigger: "Customer clicks checkout",
        steps: [
          { order: 1, action: "Review cart items", actor: "Customer" },
          { order: 2, action: "Enter payment details", actor: "Customer" },
          { order: 3, action: "Process payment", actor: "Payment Gateway" },
          { order: 4, action: "Create order record", actor: "Order" },
        ],
        participants: [
          "Customer",
          "Cart",
          "Product",
          "Order",
          "Payment Gateway",
        ],
        outcomes: ["Order confirmed", "Payment processed", "Inventory updated"],
      },
    ],
    constraints: [
      {
        name: "Payment Required",
        type: "rule",
        description: "Orders require successful payment",
        scope: ["Order", "Payment Gateway"],
        severity: "hard" as const,
      },
      {
        name: "Stock Check",
        type: "boundary",
        description: "Cannot sell out-of-stock products",
        scope: ["Product", "Warehouse"],
        severity: "hard" as const,
      },
      {
        name: "Free Shipping",
        type: "rule",
        description: "Orders over $50 get free shipping",
        scope: ["Order"],
        severity: "soft" as const,
      },
    ],
    model_name: "E-Commerce Store",
    model_description: "Online store with cart, checkout, and payment",
    source_summary: "Integration test fixture",
    confidence: 0.95,
    extraction_notes: [],
  };

  const { worldModel } = await structuringAgent({
    input: { raw: "test", sourceType: "text" },
    extraction,
  });

  assert(worldModel.entities.length === 6, "1. Structuring: 6 entities");
  assert(worldModel.relations.length === 5, "1. Structuring: 5 relations");
  assert(worldModel.processes.length === 1, "1. Structuring: 1 process");
  assert(worldModel.constraints.length === 3, "1. Structuring: 3 constraints");

  // ─── 2. Validate ────────────────────────────────────
  const { validation } = await validationAgent({
    input: { raw: "test", sourceType: "text" },
    worldModel,
  });

  assert(validation.valid, "2. Validation: model is valid");
  assert(validation.stats.entities === 6, "2. Validation: correct stats");

  // ─── 3. Fix (should be clean) ───────────────────────
  const { model: fixed, fixes } = fixWorldModel(worldModel);
  assert(fixes.length === 0, "3. Fix: nothing to fix on clean model");

  // ─── 4. Query (deterministic) ───────────────────────
  const q1 = await queryWorldModel(
    worldModel,
    "what depends on Payment Gateway?",
  );
  assert(q1.method === "graph", "4. Query: uses graph method");
  assert(
    q1.answer.includes("Order"),
    "4. Query: finds Order depends on Payment Gateway",
  );

  const q2 = await queryWorldModel(worldModel, "what is Customer?");
  assert(q2.answer.includes("buys products"), "4. Query: describes Customer");

  const q3 = await queryWorldModel(worldModel, "stats");
  assert(q3.answer.includes("6"), "4. Query: stats shows 6 entities");

  // ─── 5. Export ──────────────────────────────────────
  const claudeMd = toClaudeMd(worldModel);
  assert(
    claudeMd.includes("E-Commerce Store"),
    "5. Export CLAUDE.md: includes name",
  );
  assert(
    claudeMd.includes("Checkout"),
    "5. Export CLAUDE.md: includes process",
  );
  assert(
    claudeMd.includes("Payment Required"),
    "5. Export CLAUDE.md: includes constraint",
  );

  const sysPrompt = toSystemPrompt(worldModel);
  assert(
    sysPrompt.includes("expert on the domain"),
    "5. Export system-prompt: includes role",
  );

  const mcp = toMcpSchema(worldModel);
  assert(mcp.tools.length >= 5, "5. Export MCP: has tools");

  const jsonSchema = getWorldModelJsonSchema();
  assert("properties" in jsonSchema, "5. JSON Schema: has properties");

  // ─── 6. Graph operations ────────────────────────────
  const customer = findEntity(worldModel, "Customer");
  assert(!!customer, "6. Graph: findEntity works");

  const deps = findDependents(worldModel, customer!.id);
  assert(
    deps.outgoing.length >= 2,
    "6. Graph: Customer has outgoing relations",
  );

  const paths = pathsBetween(
    worldModel,
    customer!.id,
    findEntity(worldModel, "Warehouse")!.id,
  );
  assert(paths.length >= 1, "6. Graph: path from Customer to Warehouse exists");

  const sub = subgraph(worldModel, customer!.id, 1);
  assert(
    sub.entities.length >= 3,
    "6. Graph: subgraph has Customer + neighbors",
  );

  const clusters = findClusters(worldModel);
  assert(clusters.length >= 1, "6. Graph: finds at least 1 cluster");

  const sum = summarize(worldModel);
  assert(sum.includes("6 entities"), "6. Graph: summary includes count");

  assert(
    toMermaid(worldModel).includes("graph TD"),
    "6. Graph: Mermaid export works",
  );
  assert(toDot(worldModel).includes("digraph"), "6. Graph: DOT export works");

  // ─── 7. Merge + Diff ───────────────────────────────
  const extraModel = await structuringAgent({
    input: { raw: "test", sourceType: "text" },
    extraction: {
      entities: [
        { name: "Customer", type: "actor", description: "Returning customer" },
        {
          name: "Review",
          type: "object",
          description: "Product review from customer",
        },
      ],
      relations: [
        {
          source: "Customer",
          target: "Review",
          type: "produces",
          label: "writes",
        },
      ],
      processes: [],
      constraints: [],
      model_name: "Reviews",
      model_description: "",
      source_summary: "",
      confidence: 0.8,
      extraction_notes: [],
    },
  });

  const merged = mergeWorldModels(worldModel, extraModel.worldModel);
  assert(merged.entities.length >= 7, "7. Merge: added Review entity");

  const diff = diffWorldModels(worldModel, merged);
  assert(diff.entities.added.length >= 1, "7. Diff: detects added entity");

  // ─── 8. Algebra ─────────────────────────────────────
  const inter = intersection(worldModel, extraModel.worldModel);
  assert(
    inter.entities.length === 1,
    "8. Algebra: intersection finds Customer",
  );

  const diff2 = difference(worldModel, extraModel.worldModel);
  assert(
    diff2.entities.length === 5,
    "8. Algebra: difference = 5 unique to original",
  );

  const overlaid = overlay(worldModel, extraModel.worldModel);
  assert(overlaid.entities.length >= 7, "8. Algebra: overlay adds Review");

  // ─── 9. Coverage ────────────────────────────────────
  const cov = coverage(worldModel, merged);
  assert(
    cov.entityCoverage === 1,
    "9. Coverage: merged covers 100% of original entities",
  );
  assert(cov.overall >= 0.9, "9. Coverage: high overall coverage");

  // ─── 10. Timeline ───────────────────────────────────
  let tl = createTimeline("E-Commerce");
  tl = addSnapshot(tl, worldModel, "v1");
  tl = addSnapshot(tl, merged, "v2");
  assert(tl.snapshots.length === 2, "10. Timeline: 2 snapshots");
  assert(
    tl.snapshots[1].diff_from_previous!.entities.added.length >= 1,
    "10. Timeline: diff shows added entity",
  );

  const history = entityHistory(tl, "Customer");
  assert(
    history.length === 2,
    "10. Timeline: Customer appears in both snapshots",
  );
  assert(
    history[0].event === "appeared",
    "10. Timeline: Customer appeared in v1",
  );

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
