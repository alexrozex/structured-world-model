/**
 * Quick API — one function to extract, validate, assess health, and export.
 *
 * Usage:
 *   import { swm } from "@swm/core";
 *   const result = await swm("A marketplace for freelancers...");
 *   console.log(result.model.entities);
 *   console.log(result.health.grade);
 *   console.log(result.exports.claudeMd);
 */

import { buildWorldModel } from "./swm.js";
import type { PipelineInput } from "./pipeline/index.js";
import type { WorldModelType, ValidationResultType } from "./schema/index.js";
import { toClaudeMd } from "./export/claude-md.js";
import { toSystemPrompt } from "./export/system-prompt.js";
import { toMcpSchema } from "./export/mcp-schema.js";
import { toMarkdownTable } from "./export/markdown-table.js";
import { toHtml } from "./export/html.js";
import { assessHealth } from "./utils/health.js";
import type { HealthReport } from "./utils/health.js";
import { estimateCost } from "./utils/cost.js";
import { isUrl } from "./utils/fetch.js";

export interface QuickResult {
  /** The extracted and validated world model */
  model: WorldModelType;
  /** Validation results with quality score */
  validation: ValidationResultType;
  /** Health assessment with grade A-F */
  health: HealthReport;
  /** Pre-rendered export formats */
  exports: {
    claudeMd: string;
    systemPrompt: string;
    mcpSchema: ReturnType<typeof toMcpSchema>;
    markdownTable: string;
    html: string;
    json: string;
  };
  /** Cost estimate for this extraction */
  cost: import("./utils/cost.js").CostEstimate;
  /** Pipeline timing in ms */
  durationMs: number;
}

export interface QuickOptions {
  /** Number of extraction passes (1-3). Default 1. */
  passes?: number;
  /** Claude model to use */
  model?: string;
  /** Source type hint. Auto-detected if omitted. */
  sourceType?: PipelineInput["sourceType"];
  /** Model name override */
  name?: string;
}

/**
 * Extract a world model from any input in one call.
 * Returns the model, validation, health grade, and all export formats.
 */
export async function swm(
  input: string,
  options?: QuickOptions,
): Promise<QuickResult> {
  // Auto-detect source type
  let sourceType: PipelineInput["sourceType"] = options?.sourceType ?? "text";
  if (!options?.sourceType) {
    if (isUrl(input)) sourceType = "url";
    else if (
      input.trimStart().startsWith("{") ||
      input.trimStart().startsWith("[")
    )
      sourceType = "document";
    else if (/\bfunction\s+\w+|^import\s+/m.test(input)) sourceType = "code";
    else if (/^[A-Z]\w+\s*:/m.test(input) && /\n[A-Z]\w+\s*:/m.test(input))
      sourceType = "conversation";
  }

  const pipelineInput: PipelineInput = {
    raw: input,
    sourceType,
    name: options?.name,
  };

  const result = await buildWorldModel(pipelineInput, {
    passes: options?.passes ?? 1,
    model: options?.model,
  });

  const health = assessHealth(result.worldModel, result.validation);

  const exports = {
    claudeMd: toClaudeMd(result.worldModel),
    systemPrompt: toSystemPrompt(result.worldModel),
    mcpSchema: toMcpSchema(result.worldModel),
    markdownTable: toMarkdownTable(result.worldModel),
    html: toHtml(result.worldModel),
    json: JSON.stringify(result.worldModel, null, 2),
  };

  const cost = estimateCost(input, {
    passes: options?.passes ?? 1,
    sourceType,
  });

  return {
    model: result.worldModel,
    validation: result.validation,
    health,
    exports,
    cost,
    durationMs: result.totalDurationMs,
  };
}
