import { z } from "zod/v4";

/**
 * Zod schema for raw extraction output from the LLM.
 * Used to validate + coerce LLM responses before structuring.
 * Intentionally lenient — uses defaults and coercion rather than
 * rejecting partial extractions.
 */

const RawEntitySchema = z.object({
  name: z.string().default("unnamed"),
  type: z.string().default("object"),
  description: z.string().default(""),
  properties: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source_context: z
    .string()
    .optional()
    .describe(
      "Verbatim excerpt or paraphrase of the input that this entity was extracted from",
    ),
});

const RawRelationSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string().default("uses"),
  label: z.string().default(""),
  bidirectional: z.boolean().optional(),
});

const RawProcessStepSchema = z.object({
  order: z.number().optional(),
  action: z.string().default(""),
  actor: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
});

const RawProcessSchema = z.object({
  name: z.string().default("unnamed process"),
  description: z.string().default(""),
  trigger: z.string().optional(),
  steps: z.array(RawProcessStepSchema).default([]),
  participants: z.array(z.string()).default([]),
  outcomes: z.array(z.string()).default([]),
});

const RawConstraintSchema = z.object({
  name: z.string().default("unnamed constraint"),
  type: z.string().default("rule"),
  description: z.string().default(""),
  scope: z.array(z.string()).default([]),
  severity: z.enum(["hard", "soft"]).default("soft"),
});

export const RawExtractionSchema = z.object({
  entities: z.array(RawEntitySchema).default([]),
  relations: z.array(RawRelationSchema).default([]),
  processes: z.array(RawProcessSchema).default([]),
  constraints: z.array(RawConstraintSchema).default([]),
  model_name: z.string().default("Untitled"),
  model_description: z.string().default(""),
  source_summary: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  extraction_notes: z.array(z.string()).default([]),
});

export type ValidatedRawExtraction = z.infer<typeof RawExtractionSchema>;

/**
 * Validate and coerce raw LLM extraction output.
 * Returns a clean extraction with defaults for missing fields,
 * plus any validation issues encountered.
 */
export function validateExtraction(raw: unknown): {
  extraction: ValidatedRawExtraction;
  issues: string[];
} {
  const issues: string[] = [];

  // Handle completely wrong types
  if (raw === null || raw === undefined) {
    issues.push("Extraction was null/undefined — returning empty model");
    return { extraction: RawExtractionSchema.parse({}), issues };
  }

  if (typeof raw !== "object") {
    issues.push(
      `Extraction was ${typeof raw} instead of object — returning empty model`,
    );
    return { extraction: RawExtractionSchema.parse({}), issues };
  }

  const result = RawExtractionSchema.safeParse(raw);

  if (result.success) {
    // Filter out entities with empty names
    const extraction = result.data;
    const beforeCount = extraction.entities.length;
    extraction.entities = extraction.entities.filter(
      (e) => e.name && e.name !== "unnamed",
    );
    if (extraction.entities.length < beforeCount) {
      issues.push(
        `Dropped ${beforeCount - extraction.entities.length} entities with empty/default names`,
      );
    }

    // Filter out relations with empty source/target
    const relBefore = extraction.relations.length;
    extraction.relations = extraction.relations.filter(
      (r) => r.source && r.target,
    );
    if (extraction.relations.length < relBefore) {
      issues.push(
        `Dropped ${relBefore - extraction.relations.length} relations with empty source/target`,
      );
    }

    return { extraction, issues };
  }

  // Partial parse — try to salvage what we can
  issues.push(
    `Extraction had schema errors: ${result.error.issues
      .slice(0, 3)
      .map((i) => i.message)
      .join("; ")}`,
  );

  // Attempt lenient parse by stripping invalid fields
  try {
    const obj = raw as Record<string, unknown>;
    const lenient = RawExtractionSchema.parse({
      entities: Array.isArray(obj.entities) ? obj.entities : [],
      relations: Array.isArray(obj.relations) ? obj.relations : [],
      processes: Array.isArray(obj.processes) ? obj.processes : [],
      constraints: Array.isArray(obj.constraints) ? obj.constraints : [],
      model_name:
        typeof obj.model_name === "string" ? obj.model_name : "Untitled",
      model_description:
        typeof obj.model_description === "string" ? obj.model_description : "",
      source_summary:
        typeof obj.source_summary === "string" ? obj.source_summary : "",
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0.5,
      extraction_notes: Array.isArray(obj.extraction_notes)
        ? obj.extraction_notes
        : [],
    });
    issues.push("Recovered partial extraction via lenient parse");
    return { extraction: lenient, issues };
  } catch {
    issues.push("Lenient parse also failed — returning empty model");
    return { extraction: RawExtractionSchema.parse({}), issues };
  }
}
