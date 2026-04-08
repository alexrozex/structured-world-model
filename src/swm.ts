import { Pipeline } from "./pipeline/index.js";
import type { PipelineInput, PipelineResult } from "./pipeline/index.js";
import { extractionAgent } from "./agents/extraction.js";
import { structuringAgent } from "./agents/structuring.js";
import { validationAgent } from "./agents/validation.js";
import { secondPassAgent } from "./agents/second-pass.js";
import { mergeWorldModels } from "./utils/merge.js";
import { setDefaultModel } from "./utils/llm.js";
import type { WorldModelType } from "./schema/index.js";

export interface SWMOptions {
  onStageStart?: (name: string) => void;
  onStageEnd?: (name: string, durationMs: number, data?: unknown) => void;
  /** Number of extraction passes (1 = standard, 2+ = deeper). Default 1. Max 3. */
  passes?: number;
  /** Claude model to use. Default: claude-sonnet-4-20250514 */
  model?: string;
}

export async function buildWorldModel(
  input: PipelineInput,
  options?: SWMOptions,
): Promise<PipelineResult> {
  if (options?.model) setDefaultModel(options.model);
  const passes = Math.min(Math.max(options?.passes ?? 1, 1), 3);
  const callbacks = {
    onStageStart: options?.onStageStart,
    onStageEnd: options?.onStageEnd,
  };

  // Pass 1: standard pipeline
  const pipeline = new Pipeline(callbacks);
  pipeline
    .addStage("extraction", extractionAgent)
    .addStage("structuring", structuringAgent)
    .addStage("validation", validationAgent);

  const firstPassResult = await pipeline.execute(input);

  if (passes === 1) {
    return firstPassResult;
  }

  // Multi-pass: run second-pass agent, merge, re-validate
  let currentModel = firstPassResult.worldModel;
  const allStages = [...firstPassResult.stages];
  let totalMs = firstPassResult.totalDurationMs;

  for (let pass = 2; pass <= passes; pass++) {
    const passLabel = `pass-${pass}-extraction`;

    callbacks.onStageStart?.(passLabel);
    const passStart = Date.now();

    const deltaExtraction = await secondPassAgent(input, currentModel);

    const passMs = Date.now() - passStart;
    callbacks.onStageEnd?.(passLabel, passMs);
    allStages.push({
      stage: passLabel,
      data: deltaExtraction,
      durationMs: passMs,
    });
    totalMs += passMs;

    // Skip if delta extraction is empty (second pass found nothing or failed)
    const hasContent =
      deltaExtraction.entities.length > 0 ||
      deltaExtraction.relations.length > 0 ||
      deltaExtraction.processes.length > 0 ||
      deltaExtraction.constraints.length > 0;

    if (!hasContent) {
      callbacks.onStageStart?.(`pass-${pass}-skip`);
      callbacks.onStageEnd?.(`pass-${pass}-skip`, 0);
      allStages.push({
        stage: `pass-${pass}-skip`,
        data: "empty delta — nothing new found",
        durationMs: 0,
      });
      continue;
    }

    // Structure the delta
    callbacks.onStageStart?.(`pass-${pass}-structuring`);
    const structStart = Date.now();

    const { worldModel: deltaModel } = await structuringAgent({
      input,
      extraction: deltaExtraction,
    });

    const structMs = Date.now() - structStart;
    callbacks.onStageEnd?.(`pass-${pass}-structuring`, structMs);
    allStages.push({
      stage: `pass-${pass}-structuring`,
      data: deltaModel,
      durationMs: structMs,
    });
    totalMs += structMs;

    // Merge
    callbacks.onStageStart?.(`pass-${pass}-merge`);
    const mergeStart = Date.now();

    currentModel = mergeWorldModels(currentModel, deltaModel, {
      name: currentModel.name,
      description: currentModel.description,
    });

    const mergeMs = Date.now() - mergeStart;
    callbacks.onStageEnd?.(`pass-${pass}-merge`, mergeMs);
    allStages.push({
      stage: `pass-${pass}-merge`,
      data: currentModel,
      durationMs: mergeMs,
    });
    totalMs += mergeMs;
  }

  // Final validation on the merged model
  callbacks.onStageStart?.("final-validation");
  const valStart = Date.now();

  const { worldModel: finalModel, validation } = await validationAgent({
    input,
    worldModel: currentModel,
  });

  const valMs = Date.now() - valStart;
  callbacks.onStageEnd?.("final-validation", valMs);
  allStages.push({
    stage: "final-validation",
    data: validation,
    durationMs: valMs,
  });
  totalMs += valMs;

  return {
    worldModel: finalModel,
    validation,
    stages: allStages,
    totalDurationMs: totalMs,
  };
}

export { Pipeline };
export type { PipelineInput, PipelineResult };
