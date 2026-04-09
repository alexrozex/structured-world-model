/**
 * CLI integration tests — runs CLI commands as subprocesses.
 * No LLM calls needed — tests inspect/query/export on existing model files.
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

let passed = 0;
let failed = 0;
const TMP_MODEL = resolve(import.meta.dirname!, "../../.test-model.json");

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

function cli(args: string): string {
  try {
    return execSync(`npx tsx src/cli.ts ${args}`, {
      cwd: resolve(import.meta.dirname!, "../.."),
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    return (e.stdout ?? "").trim() + (e.stderr ?? "").trim();
  }
}

// Create a test model file
const testModel = {
  id: "wm_test123",
  name: "Test Marketplace",
  description: "A test marketplace for CLI testing",
  version: "0.1.0",
  created_at: "2026-01-01T00:00:00Z",
  entities: [
    {
      id: "ent_1",
      name: "User",
      type: "actor",
      description: "A marketplace user",
      properties: { role: "string" },
      tags: ["core"],
    },
    {
      id: "ent_2",
      name: "Product",
      type: "object",
      description: "Item for sale",
      properties: { price: "number" },
      tags: ["core"],
    },
    {
      id: "ent_3",
      name: "Order",
      type: "object",
      description: "Purchase record",
      properties: { status: "string" },
      tags: [],
    },
    {
      id: "ent_4",
      name: "Payment System",
      type: "system",
      description: "Handles transactions",
      properties: {},
      tags: [],
    },
  ],
  relations: [
    {
      id: "rel_1",
      type: "produces",
      source: "ent_1",
      target: "ent_3",
      label: "creates",
      bidirectional: false,
    },
    {
      id: "rel_2",
      type: "depends_on",
      source: "ent_3",
      target: "ent_2",
      label: "references",
      bidirectional: false,
    },
    {
      id: "rel_3",
      type: "uses",
      source: "ent_3",
      target: "ent_4",
      label: "pays through",
      bidirectional: false,
    },
  ],
  processes: [
    {
      id: "proc_1",
      name: "Purchase Flow",
      description: "User buys a product",
      trigger: "User clicks buy",
      participants: ["ent_1", "ent_2", "ent_3"],
      steps: [
        { order: 1, action: "Select product", actor: "ent_1" },
        { order: 2, action: "Create order", actor: "ent_1", output: ["ent_3"] },
        { order: 3, action: "Process payment", actor: "ent_4" },
      ],
      outcomes: ["Order created", "Payment processed"],
    },
  ],
  constraints: [
    {
      id: "cstr_1",
      name: "Valid Payment",
      type: "invariant",
      description: "All orders must have valid payment",
      scope: ["ent_3", "ent_4"],
      severity: "hard",
    },
    {
      id: "cstr_2",
      name: "Stock Check",
      type: "rule",
      description: "Products must be in stock",
      scope: ["ent_2"],
      severity: "soft",
    },
  ],
  metadata: {
    source_type: "text",
    source_summary: "Test model",
    confidence: 0.95,
  },
};

async function run() {
  console.log("\n\u2500\u2500\u2500 CLI Tests \u2500\u2500\u2500\n");

  // Setup: write test model
  writeFileSync(TMP_MODEL, JSON.stringify(testModel, null, 2));

  try {
    // Test 1: help command
    {
      const out = cli("help");
      assert(
        out.includes("model") && out.includes("inspect"),
        "help shows command list",
      );
    }

    // Test 2: schema command
    {
      const out = cli("schema");
      const parsed = JSON.parse(out);
      assert(parsed.type === "object", "schema outputs valid JSON Schema");
      assert(
        "entities" in (parsed.properties ?? {}),
        "schema includes entities property",
      );
    }

    // Test 3: inspect command
    {
      const out = cli(`inspect ${TMP_MODEL}`);
      assert(out.includes("Test Marketplace"), "inspect shows model name");
      assert(
        out.includes("4") && out.toLowerCase().includes("entities"),
        "inspect shows entity count",
      );
    }

    // Test 4: inspect --json
    {
      const out = cli(`inspect ${TMP_MODEL} --json`);
      const parsed = JSON.parse(out);
      assert(
        parsed.entities.total === 4,
        "inspect --json has correct entity count",
      );
      assert(
        parsed.relations.total === 3,
        "inspect --json has correct relation count",
      );
    }

    // Test 5: entities command
    {
      const out = cli(`entities ${TMP_MODEL}`);
      assert(out.includes("User"), "entities lists User");
      assert(out.includes("Product"), "entities lists Product");
    }

    // Test 6: entities --json
    {
      const out = cli(`entities ${TMP_MODEL} --json`);
      const parsed = JSON.parse(out);
      assert(Array.isArray(parsed), "entities --json returns array");
      assert(parsed.length === 4, "entities --json has 4 entries");
    }

    // Test 7: entities with type filter
    {
      const out = cli(`entities ${TMP_MODEL} -t actor`);
      assert(out.includes("User"), "entities -t actor includes User");
      assert(!out.includes("Product"), "entities -t actor excludes Product");
    }

    // Test 8: relations command
    {
      const out = cli(`relations ${TMP_MODEL}`);
      assert(
        out.includes("produces") || out.includes("creates"),
        "relations shows relation data",
      );
    }

    // Test 9: processes command
    {
      const out = cli(`processes ${TMP_MODEL}`);
      assert(out.includes("Purchase Flow"), "processes shows process name");
      assert(out.includes("Select product"), "processes shows step action");
    }

    // Test 10: constraints command
    {
      const out = cli(`constraints ${TMP_MODEL}`);
      assert(
        out.includes("Valid Payment"),
        "constraints shows constraint name",
      );
      assert(
        out.includes("hard") || out.includes("HARD"),
        "constraints shows severity",
      );
    }

    // Test 11: summary command
    {
      const out = cli(`summary ${TMP_MODEL}`);
      assert(out.length > 10, "summary produces output");
      assert(
        out.includes("4") || out.includes("entities"),
        "summary mentions entities",
      );
    }

    // Test 12: validate command
    {
      const out = cli(`validate ${TMP_MODEL}`);
      assert(
        out.includes("PASSED") || out.includes("score"),
        "validate produces result",
      );
    }

    // Test 13: export --as claude-md
    {
      const out = cli(`export ${TMP_MODEL} --as claude-md`);
      assert(out.includes("# Test Marketplace"), "export claude-md has title");
      assert(out.includes("User"), "export claude-md includes entities");
    }

    // Test 14: export --as system-prompt
    {
      const out = cli(`export ${TMP_MODEL} --as system-prompt`);
      assert(
        out.includes("expert"),
        "export system-prompt contains expert framing",
      );
    }

    // Test 15: export --as mcp
    {
      const out = cli(`export ${TMP_MODEL} --as mcp`);
      const parsed = JSON.parse(out);
      assert(
        parsed.tools && parsed.tools.length > 0,
        "export mcp has tools array",
      );
    }

    // Test 16: clusters command
    {
      const out = cli(`clusters ${TMP_MODEL}`);
      assert(
        out.includes("cluster") || out.includes("1"),
        "clusters finds connected components",
      );
    }

    // Test 17: impact command
    {
      const out = cli(`impact ${TMP_MODEL} Order`);
      assert(
        out.includes("Order") || out.includes("impact"),
        "impact analyzes entity",
      );
    }

    // Test 18: search command
    {
      const out = cli(`search ${TMP_MODEL} payment`);
      assert(
        out.includes("Payment") || out.includes("payment"),
        "search finds payment-related items",
      );
    }

    // Test 19: stats command
    {
      const out = cli(`stats ${TMP_MODEL}`);
      assert(
        out.includes("4") || out.includes("entities"),
        "stats shows entity count",
      );
    }

    // Test 20: query with graph pattern (no LLM needed)
    {
      const out = cli(`query ${TMP_MODEL} "what depends on Product?"`);
      assert(
        out.includes("Order") || out.includes("depends"),
        "query finds dependencies",
      );
    }

    // Test 21: mcp-config command
    {
      const out = cli(`mcp-config ${TMP_MODEL}`);
      assert(
        out.includes("swm") || out.includes("command"),
        "mcp-config generates config",
      );
    }
  } finally {
    // Cleanup
    if (existsSync(TMP_MODEL)) unlinkSync(TMP_MODEL);
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
