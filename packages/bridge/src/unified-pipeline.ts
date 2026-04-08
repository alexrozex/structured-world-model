/**
 * Unified pipeline: any input + intent → extracted structure → compiled architecture.
 *
 * Three modes:
 * 1. Extract only: buildWorldModel() — SWM standalone
 * 2. Compile only: MotherCompiler.compile() — Ada standalone
 * 3. Unified: buildEnrichedModel() — extract then compile
 */

import { buildWorldModel } from "@swm/core";
import type { PipelineInput, PipelineResult } from "@swm/core";
import { MotherCompiler } from "@swm/compiler";
import type {
  CompileOptions,
  CompileResult,
  CompilerStageCode,
} from "@swm/compiler";

import {
  worldModelToCompilerSeed,
  blueprintToEnrichedModel,
} from "./compose.js";
import type { EnrichedWorldModel } from "./enriched-model.js";

export interface UnifiedOptions {
  /** SWM extraction passes (1-3). Default 1. */
  readonly passes?: number;
  /** Auto-fix SWM validation issues before compilation. */
  readonly fix?: boolean;
  /** Claude model for extraction. */
  readonly extractionModel?: string;
  /** Anthropic API key. */
  readonly apiKey?: string;
  /** Callbacks for compilation stage progress. */
  readonly onStageStart?: (stage: CompilerStageCode) => void;
  readonly onStageComplete?: CompileOptions["onStageComplete"];
}

export interface UnifiedResult {
  /** The enriched model combining SWM extraction + Ada compilation. */
  readonly enrichedModel: EnrichedWorldModel;
  /** Raw SWM extraction result (world model + validation). */
  readonly extraction: PipelineResult;
  /** Raw Ada compilation result (blueprint + governance). */
  readonly compilation: CompileResult;
  /** Total duration across both pipelines. */
  readonly totalDurationMs: number;
}

/**
 * Full unified pipeline:
 * 1. SWM extracts structured world model from input
 * 2. Bridge maps world model to compiler seed
 * 3. Ada compiles intent through 9-stage pipeline using seed
 * 4. Bridge merges blueprint back into enriched world model
 */
export async function buildEnrichedModel(
  input: PipelineInput,
  intent: string,
  options: UnifiedOptions = {},
): Promise<UnifiedResult> {
  const startTime = Date.now();

  // Phase 1: SWM extraction
  const extraction = await buildWorldModel(input, {
    passes: options.passes ?? 1,
    model: options.extractionModel,
  });

  // Phase 2: Bridge — map world model to compiler seed
  const seed = worldModelToCompilerSeed(extraction.worldModel);

  // Phase 3: Ada compilation
  // Enrich the intent with extracted context
  const enrichedIntent = buildEnrichedIntent(intent, extraction, seed);

  const compiler = new MotherCompiler();
  const compilation = await compiler.compile(enrichedIntent, {
    apiKey: options.apiKey,
    onStageStart: options.onStageStart,
    onStageComplete: options.onStageComplete,
  });

  // Phase 4: Bridge — merge blueprint into enriched model
  const enrichedModel = blueprintToEnrichedModel(
    extraction.worldModel,
    compilation.blueprint,
  );

  return {
    enrichedModel,
    extraction,
    compilation,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Build an enriched intent string that includes extracted context.
 * This gives Ada's INT stage a head start by providing pre-extracted
 * entities, processes, and constraints as grounding context.
 */
function buildEnrichedIntent(
  rawIntent: string,
  extraction: PipelineResult,
  seed: ReturnType<typeof worldModelToCompilerSeed>,
): string {
  const model = extraction.worldModel;
  const entityCount = model.entities.length;
  const processCount = model.processes.length;
  const constraintCount = model.constraints.length;

  if (entityCount === 0) return rawIntent;

  const entityList = model.entities
    .slice(0, 20) // cap to avoid token bloat
    .map((e) => `  - ${e.name} (${e.type}): ${e.description}`)
    .join("\n");

  const processList = model.processes
    .slice(0, 10)
    .map((p) => `  - ${p.name}: ${p.description}`)
    .join("\n");

  const constraintList = model.constraints
    .slice(0, 10)
    .map((c) => `  - [${c.severity}] ${c.name}: ${c.description}`)
    .join("\n");

  const contextBlock = [
    `\n\n--- Pre-extracted domain context (${entityCount} entities, ${processCount} processes, ${constraintCount} constraints) ---`,
    entityList ? `\nEntities:\n${entityList}` : "",
    processList ? `\nProcesses:\n${processList}` : "",
    constraintList ? `\nConstraints:\n${constraintList}` : "",
    `\n--- End pre-extracted context ---`,
  ]
    .filter(Boolean)
    .join("\n");

  return rawIntent + contextBlock;
}
