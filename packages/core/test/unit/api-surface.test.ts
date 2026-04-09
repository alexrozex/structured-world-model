/**
 * Public API surface tests — verifies all exports from @swm/core are accessible.
 */

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

async function run() {
  console.log("\n\u2500\u2500\u2500 API Surface Tests \u2500\u2500\u2500\n");

  const mod = await import("../../src/index.js");

  // Core
  assert(typeof mod.buildWorldModel === "function", "buildWorldModel exported");
  assert(typeof mod.Pipeline === "function", "Pipeline exported");

  // Agents
  assert(
    typeof mod.refineWorldModel === "function",
    "refineWorldModel exported",
  );
  assert(typeof mod.queryWorldModel === "function", "queryWorldModel exported");
  assert(
    typeof mod.transformWorldModel === "function",
    "transformWorldModel exported",
  );
  assert(typeof mod.extractionAgent === "function", "extractionAgent exported");
  assert(
    typeof mod.structuringAgent === "function",
    "structuringAgent exported",
  );
  assert(typeof mod.validationAgent === "function", "validationAgent exported");
  assert(typeof mod.secondPassAgent === "function", "secondPassAgent exported");

  // Graph
  assert(typeof mod.findEntity === "function", "findEntity exported");
  assert(typeof mod.findDependents === "function", "findDependents exported");
  assert(typeof mod.pathsBetween === "function", "pathsBetween exported");
  assert(typeof mod.toMermaid === "function", "toMermaid exported");
  assert(typeof mod.toDot === "function", "toDot exported");
  assert(typeof mod.getStats === "function", "getStats exported");
  assert(typeof mod.summarize === "function", "summarize exported");
  assert(typeof mod.subgraph === "function", "subgraph exported");
  assert(typeof mod.findClusters === "function", "findClusters exported");
  assert(typeof mod.analyzeImpact === "function", "analyzeImpact exported");

  // Merge & diff
  assert(
    typeof mod.mergeWorldModels === "function",
    "mergeWorldModels exported",
  );
  assert(typeof mod.diffWorldModels === "function", "diffWorldModels exported");
  assert(
    typeof mod.detectMergeConflicts === "function",
    "detectMergeConflicts exported",
  );

  // Compare
  assert(typeof mod.compare === "function", "compare exported");

  // Algebra
  assert(typeof mod.intersection === "function", "intersection exported");
  assert(typeof mod.difference === "function", "difference exported");
  assert(typeof mod.overlay === "function", "overlay exported");

  // Coverage
  assert(typeof mod.coverage === "function", "coverage exported");

  // Fix
  assert(typeof mod.fixWorldModel === "function", "fixWorldModel exported");

  // Export formats
  assert(typeof mod.toClaudeMd === "function", "toClaudeMd exported");
  assert(typeof mod.toSystemPrompt === "function", "toSystemPrompt exported");
  assert(typeof mod.toMcpSchema === "function", "toMcpSchema exported");
  assert(typeof mod.toMarkdownTable === "function", "toMarkdownTable exported");
  assert(typeof mod.toHtml === "function", "toHtml exported");
  assert(
    typeof mod.getWorldModelJsonSchema === "function",
    "getWorldModelJsonSchema exported",
  );

  // Timeline
  assert(typeof mod.createTimeline === "function", "createTimeline exported");
  assert(typeof mod.addSnapshot === "function", "addSnapshot exported");
  assert(typeof mod.entityHistory === "function", "entityHistory exported");
  assert(typeof mod.timelineSummary === "function", "timelineSummary exported");
  assert(
    typeof mod.snapshotChangelog === "function",
    "snapshotChangelog exported",
  );

  // Schema utilities
  assert(
    typeof mod.validateExtraction === "function",
    "validateExtraction exported",
  );
  assert(
    typeof mod.getRawExtractionJsonSchema === "function",
    "getRawExtractionJsonSchema exported",
  );

  // MCP server
  assert(typeof mod.startMcpServer === "function", "startMcpServer exported");

  // LLM utilities
  assert(typeof mod.setDefaultModel === "function", "setDefaultModel exported");
  assert(typeof mod.getDefaultModel === "function", "getDefaultModel exported");

  // ID generation
  assert(typeof mod.genId === "function", "genId exported");

  // Count total exports
  const exportCount = Object.keys(mod).length;
  assert(exportCount >= 40, `API surface: ${exportCount} exports (>= 40)`);

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
