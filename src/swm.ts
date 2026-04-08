import { Pipeline } from "./pipeline/index.js";
import type { PipelineInput, PipelineResult } from "./pipeline/index.js";
import { extractionAgent } from "./agents/extraction.js";
import { structuringAgent } from "./agents/structuring.js";
import { validationAgent } from "./agents/validation.js";

export interface SWMOptions {
  onStageStart?: (name: string) => void;
  onStageEnd?: (name: string, durationMs: number) => void;
}

export async function buildWorldModel(
  input: PipelineInput,
  options?: SWMOptions,
): Promise<PipelineResult> {
  const pipeline = new Pipeline({
    onStageStart: options?.onStageStart,
    onStageEnd: options?.onStageEnd,
  });

  pipeline
    .addStage("extraction", extractionAgent)
    .addStage("structuring", structuringAgent)
    .addStage("validation", validationAgent);

  return pipeline.execute(input);
}

export { Pipeline };
export type { PipelineInput, PipelineResult };
