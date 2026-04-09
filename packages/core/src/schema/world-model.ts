import { z } from "zod/v4";

// ─── Primitives ───────────────────────────────────────────────

export const EntityId = z.string().describe("Unique entity identifier");
export const RelationId = z.string().describe("Unique relation identifier");
export const ProcessId = z.string().describe("Unique process identifier");
export const ConstraintId = z.string().describe("Unique constraint identifier");

// ─── Entity ───────────────────────────────────────────────────
// Something that exists in the world. Can be concrete (a server, a user)
// or abstract (a policy, a concept).

export const Entity = z.object({
  id: EntityId,
  name: z.string().describe("Human-readable name"),
  type: z
    .enum([
      "actor",
      "object",
      "system",
      "concept",
      "location",
      "event",
      "group",
      "resource",
    ])
    .describe("Ontological category"),
  description: z.string().describe("What this entity is and why it matters"),
  properties: z
    .record(z.string(), z.unknown())
    .describe("Arbitrary key-value attributes")
    .optional(),
  tags: z.array(z.string()).optional(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Extraction confidence for this entity (1=explicit, 0.5=inferred, 0=placeholder)",
    ),
  source_context: z
    .string()
    .optional()
    .describe(
      "Verbatim excerpt from the input that evidences this entity's existence",
    ),
});

export type Entity = z.infer<typeof Entity>;

// ─── Relation ─────────────────────────────────────────────────
// A directed edge between two entities.

export const Relation = z.object({
  id: RelationId,
  type: z
    .enum([
      "has",
      "is_a",
      "part_of",
      "depends_on",
      "produces",
      "consumes",
      "controls",
      "communicates_with",
      "located_in",
      "triggers",
      "inherits",
      "contains",
      "uses",
      "flows_to",
      "opposes",
      "enables",
      "transforms",
    ])
    .describe("Semantic type of the relation"),
  source: EntityId.describe("Source entity ID"),
  target: EntityId.describe("Target entity ID"),
  label: z.string().describe("Human-readable description of the relation"),
  weight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Strength/confidence of the relation"),
  bidirectional: z.boolean().optional(),
  source_context: z
    .string()
    .optional()
    .describe("Verbatim excerpt from the input that evidences this relation"),
});

export type Relation = z.infer<typeof Relation>;

// ─── Process ──────────────────────────────────────────────────
// A dynamic sequence — something that happens over time.

export const ProcessStep = z.object({
  order: z.number(),
  action: z.string().describe("What happens in this step"),
  actor: EntityId.optional().describe("Who/what performs the action"),
  input: z.array(EntityId).optional(),
  output: z.array(EntityId).optional(),
});

export const Process = z.object({
  id: ProcessId,
  name: z.string(),
  description: z.string(),
  trigger: z.string().optional().describe("What initiates this process"),
  steps: z.array(ProcessStep),
  participants: z.array(EntityId).describe("All entities involved"),
  outcomes: z
    .array(z.string())
    .describe("What this process produces or changes"),
  source_context: z
    .string()
    .optional()
    .describe("Verbatim excerpt from input that evidences this process"),
});

export type Process = z.infer<typeof Process>;

// ─── Constraint ───────────────────────────────────────────────
// An invariant — something that must always be true.

export const Constraint = z.object({
  id: ConstraintId,
  name: z.string(),
  type: z.enum([
    "invariant",
    "rule",
    "boundary",
    "dependency",
    "capacity",
    "temporal",
    "authorization",
  ]),
  description: z.string().describe("What must hold true"),
  scope: z
    .array(EntityId)
    .describe("Which entities this constraint applies to"),
  severity: z
    .enum(["hard", "soft"])
    .describe("Hard = violation is an error, Soft = violation is a warning"),
  source_context: z
    .string()
    .optional()
    .describe("Verbatim excerpt from input that evidences this constraint"),
});

export type Constraint = z.infer<typeof Constraint>;

// ─── World Model ──────────────────────────────────────────────
// The complete structured representation.

export const WorldModel = z.object({
  id: z.string(),
  name: z.string().describe("Name of this world model"),
  description: z.string().describe("What domain/system this model represents"),
  version: z.string().default("0.1.0"),
  created_at: z.string(),

  entities: z.array(Entity),
  relations: z.array(Relation),
  processes: z.array(Process),
  constraints: z.array(Constraint),

  metadata: z
    .object({
      source_type: z
        .enum(["text", "document", "url", "code", "conversation", "mixed"])
        .describe("What kind of input produced this model"),
      source_summary: z.string().describe("Brief description of the input"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Overall extraction confidence"),
      extraction_notes: z
        .array(z.string())
        .optional()
        .describe("Observations, ambiguities, or gaps noted during extraction"),
    })
    .optional(),
});

export type WorldModel = z.infer<typeof WorldModel>;

// ─── Validation result ────────────────────────────────────────

export const ValidationIssue = z.object({
  type: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  path: z.string().optional().describe("JSONPath to the problematic element"),
});

export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationResult = z.object({
  valid: z.boolean(),
  issues: z.array(ValidationIssue),
  stats: z.object({
    entities: z.number(),
    relations: z.number(),
    processes: z.number(),
    constraints: z.number(),
  }),
  score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Quality score 0-100 based on completeness, integrity, and diversity",
    ),
});

export type ValidationResult = z.infer<typeof ValidationResult>;
