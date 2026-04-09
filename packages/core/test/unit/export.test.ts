import { toClaudeMd } from "../../src/export/claude-md.js";
import { toSystemPrompt } from "../../src/export/system-prompt.js";
import { toMcpSchema } from "../../src/export/mcp-schema.js";
import { toHtml } from "../../src/export/html.js";
import { toMarkdownTable } from "../../src/export/markdown-table.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(): WorldModelType {
  return {
    id: "wm_test",
    name: "Test System",
    description: "A test system",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [
      { id: "ent_1", name: "User", type: "actor", description: "End user" },
      {
        id: "ent_2",
        name: "API",
        type: "system",
        description: "REST API",
        properties: { port: 3000 },
      },
      {
        id: "ent_3",
        name: "Database",
        type: "system",
        description: "PostgreSQL",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "uses",
        source: "ent_1",
        target: "ent_2",
        label: "sends requests",
      },
      {
        id: "rel_2",
        type: "depends_on",
        source: "ent_2",
        target: "ent_3",
        label: "queries",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Request Flow",
        description: "Handle API request",
        trigger: "HTTP request received",
        steps: [
          { order: 1, action: "Authenticate", actor: "ent_2" },
          { order: 2, action: "Query data", actor: "ent_3" },
        ],
        participants: ["ent_1", "ent_2", "ent_3"],
        outcomes: ["Response sent"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Rate Limit",
        type: "capacity",
        description: "Max 1000 req/min",
        scope: ["ent_2"],
        severity: "hard",
      },
      {
        id: "cstr_2",
        name: "Logging",
        type: "rule",
        description: "All requests logged",
        scope: ["ent_2"],
        severity: "soft",
      },
    ],
    metadata: {
      source_type: "text",
      source_summary: "test",
      confidence: 0.9,
      extraction_notes: ["Test note"],
    },
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
  console.log("═══ Export Unit Tests ═══\n");
  const model = makeModel();

  // ─── CLAUDE.md ───────────────────────────────────────

  const claudeMd = toClaudeMd(model);
  assert(
    claudeMd.startsWith("# Test System"),
    "CLAUDE.md: starts with model name as heading",
  );
  assert(
    claudeMd.includes("End user"),
    "CLAUDE.md: includes entity descriptions",
  );
  assert(claudeMd.includes("User"), "CLAUDE.md: includes entity names");
  assert(
    claudeMd.includes("sends requests"),
    "CLAUDE.md: includes relation labels",
  );
  assert(
    claudeMd.includes("Request Flow"),
    "CLAUDE.md: includes process names",
  );
  assert(
    claudeMd.includes("Authenticate"),
    "CLAUDE.md: includes process steps",
  );
  assert(claudeMd.includes("Rate Limit"), "CLAUDE.md: includes constraints");
  assert(
    claudeMd.includes("Hard Constraints"),
    "CLAUDE.md: separates hard/soft constraints",
  );
  assert(
    claudeMd.includes("Soft Constraints"),
    "CLAUDE.md: includes soft constraints section",
  );
  assert(
    claudeMd.includes("Test note"),
    "CLAUDE.md: includes extraction notes",
  );
  assert(
    claudeMd.includes("3 entities"),
    "CLAUDE.md: includes stats in header",
  );

  // ─── System Prompt ───────────────────────────────────

  const prompt = toSystemPrompt(model);
  assert(
    prompt.includes("expert on the domain: Test System"),
    "Prompt: declares domain expertise",
  );
  assert(prompt.includes("ENTITIES (3)"), "Prompt: correct entity count");
  assert(
    prompt.includes("RELATIONSHIPS (2)"),
    "Prompt: correct relation count",
  );
  assert(prompt.includes("PROCESSES (1)"), "Prompt: correct process count");
  assert(
    prompt.includes("CONSTRAINTS (2)"),
    "Prompt: correct constraint count",
  );
  assert(prompt.includes("[HARD]"), "Prompt: marks hard constraints");
  assert(prompt.includes("[SOFT]"), "Prompt: marks soft constraints");
  assert(prompt.includes("User (actor)"), "Prompt: includes entity type");
  assert(
    prompt.includes("HTTP request received"),
    "Prompt: includes process trigger",
  );

  // ─── MCP Schema ──────────────────────────────────────

  const mcp = toMcpSchema(model);
  assert(mcp.name === "test-system", "MCP: normalized server name");
  assert(mcp.tools.length >= 5, "MCP: at least 5 tools generated");

  const toolNames = mcp.tools.map((t) => t.name);
  assert(toolNames.includes("get_entity"), "MCP: has get_entity tool");
  assert(toolNames.includes("get_relations"), "MCP: has get_relations tool");
  assert(toolNames.includes("query_world_model"), "MCP: has query tool");
  assert(toolNames.includes("check_constraint"), "MCP: has constraint checker");

  const getEntity = mcp.tools.find((t) => t.name === "get_entity")!;
  assert(
    getEntity.inputSchema.properties.name.enum!.length === 3,
    "MCP: get_entity enum has all 3 entity names",
  );
  assert(
    getEntity.inputSchema.required.includes("name"),
    "MCP: get_entity requires name",
  );

  const procTool = mcp.tools.find((t) => t.name.startsWith("process_"));
  assert(!!procTool, "MCP: has process tool");
  assert(
    procTool!.name === "process_request_flow",
    "MCP: process tool name normalized",
  );

  // Empty model
  const empty: WorldModelType = {
    id: "wm_e",
    name: "Empty",
    description: "empty",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [],
    relations: [],
    processes: [],
    constraints: [],
  };
  const emptyMd = toClaudeMd(empty);
  assert(
    emptyMd.includes("# Empty"),
    "CLAUDE.md empty: doesn't crash on empty model",
  );
  const emptyMcp = toMcpSchema(empty);
  assert(emptyMcp.tools.length >= 2, "MCP empty: still generates base tools");

  // ─── HTML Export ─────────────────────────────────────────────

  const html = toHtml(model);
  assert(html.startsWith("<!DOCTYPE html>"), "HTML: starts with DOCTYPE");
  assert(html.includes("<title>Test System"), "HTML: model name in title");
  assert(
    html.includes("</html>"),
    "HTML: is a complete document (ends with </html>)",
  );
  assert(html.includes("User"), "HTML: entity names are present");
  assert(html.includes("API"), "HTML: all entities included");
  assert(html.includes("ent_1"), "HTML: entity IDs present in graph data");
  assert(html.includes('"type":"uses"'), "HTML: relation types in graph data");
  assert(html.includes("Request Flow"), "HTML: process names appear in tables");
  assert(
    html.includes("Rate Limit"),
    "HTML: constraint names appear in tables",
  );
  assert(html.includes("badge-hard"), "HTML: hard constraints get badge class");
  assert(html.includes("badge-soft"), "HTML: soft constraints get badge class");
  assert(
    !html.includes("cdn.") &&
      !html.includes("unpkg.com") &&
      !html.includes("jsdelivr"),
    "HTML: no CDN dependencies (self-contained)",
  );
  assert(
    html.includes("<script>"),
    "HTML: includes inline script for interactivity",
  );
  assert(html.includes("svg"), "HTML: includes SVG element");
  assert(
    html.includes("force") || html.includes("REPEL"),
    "HTML: force simulation embedded",
  );

  // Empty model should not crash
  const emptyHtml = toHtml({
    id: "wm_e",
    name: "Empty",
    description: "empty",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [],
    relations: [],
    processes: [],
    constraints: [],
  });
  assert(
    emptyHtml.includes("<!DOCTYPE html>"),
    "HTML empty: renders without crash",
  );
  assert(emptyHtml.includes("Empty"), "HTML empty: model name present");

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
  // ─── toMarkdownTable ─────────────────────────────────────────

  const md = toMarkdownTable(model);

  assert(md.includes("# Test System"), "MD table: has title");
  assert(md.includes("A test system"), "MD table: has description");
  assert(md.includes("## Entities"), "MD table: has entities section");
  assert(
    md.includes("| Name | Type | Description | Confidence |"),
    "MD table: entity table header",
  );
  assert(md.includes("| User | actor |"), "MD table: User entity row");
  assert(md.includes("| API | system |"), "MD table: API entity row");
  assert(md.includes("## Relations"), "MD table: has relations section");
  assert(
    md.includes("| Source | Type | Target | Label |"),
    "MD table: relation table header",
  );
  assert(
    md.includes("| User | uses | API |"),
    "MD table: relation row with resolved names",
  );
  assert(md.includes("## Processes"), "MD table: has processes section");
  assert(md.includes("### Request Flow"), "MD table: process name as h3");
  assert(md.includes("**Trigger:**"), "MD table: process trigger");
  assert(
    md.includes("| Step | Actor | Action |"),
    "MD table: step table header",
  );
  assert(md.includes("| 1 | API |"), "MD table: step row with actor");
  assert(md.includes("**Outcomes:**"), "MD table: outcomes line");
  assert(md.includes("## Constraints"), "MD table: has constraints section");
  assert(
    md.includes("| Name | Type | Severity | Description | Scope |"),
    "MD table: constraint table header",
  );

  // Pipe characters in descriptions should be escaped
  const pipeModel = {
    ...model,
    entities: [
      {
        id: "ent_1",
        name: "Test",
        type: "actor" as const,
        description: "Has | pipe",
      },
    ],
    relations: [],
    processes: [],
    constraints: [],
  };
  const pipeMd = toMarkdownTable(pipeModel);
  assert(
    pipeMd.includes("Has \\| pipe"),
    "MD table: pipe chars escaped in descriptions",
  );

  // Confidence rendering
  const confModel = {
    ...model,
    entities: [
      {
        id: "ent_1",
        name: "High",
        type: "actor" as const,
        description: "d",
        confidence: 0.95,
      },
      {
        id: "ent_2",
        name: "Low",
        type: "actor" as const,
        description: "d",
        confidence: 0.3,
      },
      { id: "ent_3", name: "None", type: "actor" as const, description: "d" },
    ],
    relations: [],
    processes: [],
    constraints: [],
  };
  const confMd = toMarkdownTable(confModel);
  assert(confMd.includes("95%"), "MD table: confidence 0.95 → 95%");
  assert(confMd.includes("30%"), "MD table: confidence 0.3 → 30%");
  assert(confMd.includes("—"), "MD table: missing confidence → dash");

  // Empty model
  const emptyMdTable = toMarkdownTable(empty);
  assert(
    emptyMdTable.includes("## Entities"),
    "MD table empty: entities header present",
  );
  assert(
    !emptyMdTable.includes("## Relations"),
    "MD table empty: no relations section",
  );
  assert(
    !emptyMdTable.includes("## Processes"),
    "MD table empty: no processes section",
  );
  assert(
    !emptyMdTable.includes("## Constraints"),
    "MD table empty: no constraints section",
  );

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
