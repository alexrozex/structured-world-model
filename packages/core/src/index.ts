export { buildWorldModel } from "./swm.js";
export type { SWMOptions } from "./swm.js";
export { Pipeline } from "./pipeline/index.js";
export type { PipelineInput, PipelineResult } from "./pipeline/index.js";
export type { WorldModelType, ValidationResultType } from "./schema/index.js";
export type {
  EntityType,
  RelationType,
  ProcessType,
  ConstraintType,
} from "./schema/index.js";

// Agents
export { refineWorldModel } from "./agents/refinement.js";
export { queryWorldModel } from "./agents/query.js";
export type { QueryResult } from "./agents/query.js";
export { transformWorldModel } from "./agents/transform.js";

// Graph operations
export {
  findEntity,
  findDependents,
  pathsBetween,
  toMermaid,
  toDot,
  getStats,
  summarize,
  subgraph,
  findClusters,
  analyzeImpact,
} from "./utils/graph.js";
export type { ImpactAnalysis } from "./utils/graph.js";
export type { Cluster } from "./utils/graph.js";

// Merge & diff
export {
  mergeWorldModels,
  diffWorldModels,
  detectMergeConflicts,
} from "./utils/merge.js";
export type { WorldModelDiff, MergeConflict } from "./utils/merge.js";

// Compare
export { compare } from "./utils/compare.js";
export type { CompareResult, Conflict } from "./utils/compare.js";

// Algebra
export { intersection, difference, overlay } from "./utils/algebra.js";

// Coverage
export { coverage } from "./utils/coverage.js";
export type { CoverageResult } from "./utils/coverage.js";

// Fix
export { fixWorldModel } from "./utils/fix.js";
export type { FixResult } from "./utils/fix.js";

// Export formats
export { toClaudeMd } from "./export/claude-md.js";
export { toSystemPrompt } from "./export/system-prompt.js";
export { toMcpSchema } from "./export/mcp-schema.js";
export { toMarkdownTable } from "./export/markdown-table.js";
export { toHtml } from "./export/html.js";
export { getWorldModelJsonSchema } from "./schema/json-schema.js";

// Timeline
export {
  createTimeline,
  addSnapshot,
  entityHistory,
  timelineSummary,
  snapshotChangelog,
} from "./utils/timeline.js";
export type { Timeline, Snapshot } from "./utils/timeline.js";

// Pipeline stages (for custom pipeline composition)
export { extractionAgent } from "./agents/extraction.js";
export { structuringAgent } from "./agents/structuring.js";
export { validationAgent } from "./agents/validation.js";
export { secondPassAgent } from "./agents/second-pass.js";

// Schema utilities
export {
  validateExtraction,
  getRawExtractionJsonSchema,
} from "./schema/extraction.js";

// MCP server
export { startMcpServer } from "./serve/mcp-server.js";

// LLM utilities
export { setDefaultModel, getDefaultModel } from "./utils/llm.js";

// ID generation
export { genId } from "./utils/ids.js";
