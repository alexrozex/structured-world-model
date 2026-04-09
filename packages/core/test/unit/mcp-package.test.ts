/**
 * Tests for MCP server package generation.
 */

import { generateMcpPackage } from "../../src/export/mcp-package.js";
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
  name: "Test Store",
  description: "An e-commerce store",
  version: "2.0.0",
  created_at: "2026-01-01",
  entities: [
    {
      id: "ent_1",
      name: "Product",
      type: "object",
      description: "Item for sale",
    },
    { id: "ent_2", name: "Customer", type: "actor", description: "Buyer" },
  ],
  relations: [
    {
      id: "rel_1",
      type: "uses",
      source: "ent_2",
      target: "ent_1",
      label: "buys",
    },
  ],
  processes: [
    {
      id: "proc_1",
      name: "Purchase",
      description: "Buy flow",
      steps: [],
      participants: ["ent_2"],
      outcomes: ["Order"],
    },
  ],
  constraints: [
    {
      id: "cstr_1",
      name: "Stock",
      type: "rule",
      description: "Must be in stock",
      scope: ["ent_1"],
      severity: "hard",
    },
  ],
} as WorldModelType;

function run() {
  console.log("\n\u2500\u2500\u2500 MCP Package Tests \u2500\u2500\u2500\n");

  // Generates all required files
  {
    const files = generateMcpPackage(model);
    assert("package.json" in files, "has package.json");
    assert("server.ts" in files, "has server.ts");
    assert("model.json" in files, "has model.json");
    assert("README.md" in files, "has README.md");
    assert("claude-config.json" in files, "has claude-config.json");
    assert(Object.keys(files).length === 5, "exactly 5 files");
  }

  // package.json is valid JSON with correct fields
  {
    const files = generateMcpPackage(model);
    const pkg = JSON.parse(files["package.json"]);
    assert(pkg.name === "swm-mcp-test-store", "package name slugified");
    assert(pkg.version === "2.0.0", "version from model");
    assert(
      pkg.description.includes("Test Store"),
      "description includes model name",
    );
    assert(pkg.scripts.start.includes("tsx"), "start script uses tsx");
    assert(pkg.dependencies["@modelcontextprotocol/sdk"], "has MCP SDK dep");
  }

  // server.ts contains MCP server setup
  {
    const files = generateMcpPackage(model);
    assert(
      files["server.ts"].includes("McpServer"),
      "server imports McpServer",
    );
    assert(
      files["server.ts"].includes("StdioServerTransport"),
      "server imports transport",
    );
    assert(
      files["server.ts"].includes("get_entity"),
      "server has get_entity tool",
    );
    assert(
      files["server.ts"].includes("get_stats"),
      "server has get_stats tool",
    );
    assert(files["server.ts"].includes("search"), "server has search tool");
  }

  // model.json is the world model
  {
    const files = generateMcpPackage(model);
    const m = JSON.parse(files["model.json"]);
    assert(m.name === "Test Store", "model.json has correct name");
    assert(m.entities.length === 2, "model.json has entities");
  }

  // README has useful content
  {
    const files = generateMcpPackage(model);
    assert(files["README.md"].includes("# Test Store"), "README has title");
    assert(
      files["README.md"].includes("npm install"),
      "README has install instructions",
    );
    assert(
      files["README.md"].includes("**2**") &&
        files["README.md"].includes("entities"),
      "README has entity count",
    );
    assert(files["README.md"].includes("get_entity"), "README documents tools");
  }

  // claude-config.json has MCP config
  {
    const files = generateMcpPackage(model);
    const cfg = JSON.parse(files["claude-config.json"]);
    assert(cfg.mcpServers["test-store"], "config has server entry");
    assert(
      cfg.mcpServers["test-store"].command === "npx",
      "config command is npx",
    );
  }

  // Custom name option
  {
    const files = generateMcpPackage(model, { name: "my-store" });
    const pkg = JSON.parse(files["package.json"]);
    assert(pkg.name === "swm-mcp-my-store", "custom name in package.json");
  }

  // Name with special characters slugified
  {
    const specialModel = {
      ...model,
      name: "Hello World! System (v2)",
    } as WorldModelType;
    const files = generateMcpPackage(specialModel);
    const pkg = JSON.parse(files["package.json"]);
    assert(!pkg.name.includes("!"), "special chars removed from name");
    assert(!pkg.name.includes("("), "parens removed from name");
  }

  // Empty model doesn't crash
  {
    const empty = {
      ...model,
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    } as WorldModelType;
    const files = generateMcpPackage(empty);
    assert(
      files["server.ts"].length > 100,
      "empty model still generates server",
    );
    assert(
      files["README.md"].includes("**0**") &&
        files["README.md"].includes("entities"),
      "README shows zero entities",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
