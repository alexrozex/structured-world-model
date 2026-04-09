/**
 * Tests for comparison HTML export.
 */

import { toComparisonHtml } from "../../src/export/comparison-html.js";
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

function makeModel(
  name: string,
  entityNames: string[],
  types?: string[],
): WorldModelType {
  return {
    id: "wm_" + name,
    name,
    description: "Test " + name,
    version: "0.1.0",
    created_at: "2026-01-01",
    entities: entityNames.map((n, i) => ({
      id: `ent_${name}_${i}`,
      name: n,
      type: (types?.[i] ?? "object") as "object" | "actor" | "system",
      description: `${n} entity`,
    })),
    relations:
      entityNames.length >= 2
        ? [
            {
              id: `rel_${name}_0`,
              type: "uses" as const,
              source: `ent_${name}_0`,
              target: `ent_${name}_1`,
              label: "uses",
            },
          ]
        : [],
    processes: [],
    constraints: [],
  } as WorldModelType;
}

function run() {
  console.log(
    "\n\u2500\u2500\u2500 Comparison HTML Tests \u2500\u2500\u2500\n",
  );

  // Basic HTML structure
  {
    const a = makeModel("Spec", ["User", "Product"]);
    const b = makeModel("Impl", ["User", "Product"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("<!DOCTYPE html>"), "has doctype");
    assert(html.includes("Model Comparison"), "has title");
    assert(html.includes("Spec"), "shows model A name");
    assert(html.includes("Impl"), "shows model B name");
  }

  // Matching entities shown
  {
    const a = makeModel("A", ["User", "Admin"]);
    const b = makeModel("B", ["User", "Admin"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("match"), "matching entities have match class");
    assert(html.includes("\u2713"), "checkmark for matches");
  }

  // Only-in-A entities shown
  {
    const a = makeModel("A", ["User", "Admin", "Billing"]);
    const b = makeModel("B", ["User"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("only-a"), "only-in-A entities have class");
    assert(html.includes("\u2190"), "left arrow for A-only");
  }

  // Only-in-B entities shown
  {
    const a = makeModel("A", ["User"]);
    const b = makeModel("B", ["User", "Payment"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("only-b"), "only-in-B entities have class");
    assert(html.includes("\u2192"), "right arrow for B-only");
  }

  // Conflicts shown
  {
    const a = makeModel("A", ["User"], ["actor"]);
    const b = makeModel("B", ["User"], ["system"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("conflict"), "conflict entities have class");
    assert(html.includes("\u26A0"), "warning icon for conflicts");
  }

  // Stats section
  {
    const a = makeModel("A", ["User", "Product"]);
    const b = makeModel("B", ["User", "Product"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("Coverage"), "has coverage stat");
    assert(html.includes("Agreements"), "has agreements stat");
    assert(html.includes("Conflicts"), "has conflicts stat");
  }

  // Legend present
  {
    const a = makeModel("A", ["User"]);
    const b = makeModel("B", ["User"]);
    const html = toComparisonHtml(a, b);
    assert(html.includes("Match"), "legend has Match");
    assert(html.includes("Conflict"), "legend has Conflict");
    assert(html.includes("Only in A"), "legend has Only in A");
    assert(html.includes("Only in B"), "legend has Only in B");
  }

  // Empty models don't crash
  {
    const a = makeModel("Empty1", []);
    const b = makeModel("Empty2", []);
    const html = toComparisonHtml(a, b);
    assert(html.includes("<!DOCTYPE html>"), "empty models produce valid HTML");
  }

  // XSS safety — HTML entities escaped
  {
    const a = makeModel("A", ['<script>alert("xss")</script>']);
    const b = makeModel("B", ["Safe"]);
    const html = toComparisonHtml(a, b);
    assert(!html.includes("<script>alert"), "XSS: script tags escaped");
    assert(html.includes("&lt;script&gt;"), "XSS: properly escaped");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
