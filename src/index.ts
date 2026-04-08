export { buildWorldModel } from "./swm.js";
export type { SWMOptions } from "./swm.js";
export { Pipeline } from "./pipeline/index.js";
export type { PipelineInput, PipelineResult } from "./pipeline/index.js";
export type { WorldModelType, ValidationResultType } from "./schema/index.js";

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
} from "./utils/graph.js";
export type { Cluster } from "./utils/graph.js";

// Merge & diff
export { mergeWorldModels, diffWorldModels } from "./utils/merge.js";
export type { WorldModelDiff } from "./utils/merge.js";

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
export { getWorldModelJsonSchema } from "./schema/json-schema.js";

// Timeline
export {
  createTimeline,
  addSnapshot,
  entityHistory,
  timelineSummary,
} from "./utils/timeline.js";
export type { Timeline, Snapshot } from "./utils/timeline.js";
