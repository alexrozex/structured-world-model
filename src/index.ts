export { buildWorldModel } from "./swm.js";
export type { SWMOptions } from "./swm.js";
export { Pipeline } from "./pipeline/index.js";
export type { PipelineInput, PipelineResult } from "./pipeline/index.js";
export type { WorldModelType, ValidationResultType } from "./schema/index.js";

// Agents
export { refineWorldModel } from "./agents/refinement.js";
export { queryWorldModel } from "./agents/query.js";
export type { QueryResult } from "./agents/query.js";

// Graph operations
export {
  findEntity,
  findDependents,
  pathsBetween,
  toMermaid,
  toDot,
  getStats,
} from "./utils/graph.js";

// Merge & diff
export { mergeWorldModels, diffWorldModels } from "./utils/merge.js";
export type { WorldModelDiff } from "./utils/merge.js";

// Algebra
export { intersection, difference, overlay } from "./utils/algebra.js";

// Export formats
export { toClaudeMd } from "./export/claude-md.js";
export { toSystemPrompt } from "./export/system-prompt.js";
export { toMcpSchema } from "./export/mcp-schema.js";
