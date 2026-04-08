export { buildWorldModel } from "./swm.js";
export { Pipeline } from "./pipeline/index.js";
export type { PipelineInput, PipelineResult } from "./pipeline/index.js";
export type { WorldModelType, ValidationResultType } from "./schema/index.js";

// Agents
export { refineWorldModel } from "./agents/refinement.js";

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
