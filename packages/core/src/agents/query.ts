import { callAgent } from "../utils/llm.js";
import {
  findEntity,
  findDependents,
  pathsBetween,
  getStats,
  analyzeImpact,
} from "../utils/graph.js";
import type { WorldModelType } from "../schema/index.js";

export interface QueryResult {
  answer: string;
  method: "graph" | "inference";
  entities_referenced: string[];
  confidence: number;
  /** Entity names whose extraction confidence in the model is below 0.5 — treat these answers as uncertain */
  low_confidence_entities: string[];
}

// ─── Internal result type (before confidence annotation) ──────

type RawQueryResult = Omit<QueryResult, "low_confidence_entities">;

/**
 * Annotate a result with low_confidence_entities by looking up each
 * referenced entity's extraction confidence in the model.
 */
function annotateConfidence(
  result: RawQueryResult,
  model: WorldModelType,
): QueryResult {
  const low = result.entities_referenced
    .map((name) =>
      model.entities.find((e) => e.name.toLowerCase() === name.toLowerCase()),
    )
    .filter(
      (e): e is WorldModelType["entities"][number] =>
        e !== undefined && (e.confidence ?? 1) < 0.5,
    )
    .map((e) => e.name);
  return { ...result, low_confidence_entities: low };
}

// ─── Deterministic graph queries ──────────────────────────────

const GRAPH_PATTERNS: Array<{
  pattern: RegExp;
  handler: (
    model: WorldModelType,
    match: RegExpMatchArray,
  ) => RawQueryResult | null;
}> = [
  {
    // "what depends on X" / "what uses X" / "what needs X"
    pattern:
      /what\s+(?:depends\s+on|uses|needs|requires|consumes)\s+(?:the\s+)?(.+?)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;
      const deps = findDependents(model, entity.id);
      if (deps.incoming.length === 0) {
        return {
          answer: `Nothing in the model depends on ${entity.name}.`,
          method: "graph",
          entities_referenced: [entity.name],
          confidence: 1,
        };
      }
      const lines = deps.incoming.map(
        (d) =>
          `- ${d.entity.name} —[${d.relation.type}]→ ${entity.name}: ${d.relation.label}`,
      );
      return {
        answer: `${deps.incoming.length} entities depend on ${entity.name}:\n${lines.join("\n")}`,
        method: "graph",
        entities_referenced: [
          entity.name,
          ...deps.incoming.map((d) => d.entity.name),
        ],
        confidence: 1,
      };
    },
  },
  {
    // "what does X depend on" / "what does X use" / "what does X need"
    pattern:
      /what\s+does\s+(.+?)\s+(?:depend\s+on|use|need|require|consume)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;
      const deps = findDependents(model, entity.id);
      if (deps.outgoing.length === 0) {
        return {
          answer: `${entity.name} does not depend on anything in the model.`,
          method: "graph",
          entities_referenced: [entity.name],
          confidence: 1,
        };
      }
      const lines = deps.outgoing.map(
        (d) =>
          `- ${entity.name} —[${d.relation.type}]→ ${d.entity.name}: ${d.relation.label}`,
      );
      return {
        answer: `${entity.name} depends on ${deps.outgoing.length} entities:\n${lines.join("\n")}`,
        method: "graph",
        entities_referenced: [
          entity.name,
          ...deps.outgoing.map((d) => d.entity.name),
        ],
        confidence: 1,
      };
    },
  },
  {
    // "how is X connected to Y" / "path from X to Y" / "how does X relate to Y"
    pattern:
      /(?:how\s+(?:is|does)\s+(.+?)\s+(?:connected|related?)\s+to\s+(.+?)|path\s+from\s+(.+?)\s+to\s+(.+?))(?:\?|$)/i,
    handler: (model, match) => {
      const srcName = (match[1] || match[3])?.trim();
      const tgtName = (match[2] || match[4])?.trim();
      if (!srcName || !tgtName) return null;
      const src = findEntity(model, srcName);
      const tgt = findEntity(model, tgtName);
      if (!src || !tgt) return null;

      const paths = pathsBetween(model, src.id, tgt.id);
      if (paths.length === 0) {
        return {
          answer: `No path found from ${src.name} to ${tgt.name} in the model.`,
          method: "graph",
          entities_referenced: [src.name, tgt.name],
          confidence: 1,
        };
      }

      const pathDescs = paths.map((path, i) => {
        const hops = path
          .map((step, j) => {
            if (j === 0) return step.entity.name;
            return `—[${step.relation?.type ?? "?"}]→ ${step.entity.name}`;
          })
          .join(" ");
        return `  Path ${i + 1}: ${hops}`;
      });

      return {
        answer: `${paths.length} path(s) from ${src.name} to ${tgt.name}:\n${pathDescs.join("\n")}`,
        method: "graph",
        entities_referenced: [src.name, tgt.name],
        confidence: 1,
      };
    },
  },
  {
    // "what constraints apply to X" / "rules for X"
    pattern:
      /(?:what\s+constraints?\s+(?:apply|applies)\s+to|rules?\s+for)\s+(?:the\s+)?(.+?)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;

      const applicable = model.constraints.filter((c) =>
        c.scope.includes(entity.id),
      );

      if (applicable.length === 0) {
        return {
          answer: `No constraints apply to ${entity.name}.`,
          method: "graph",
          entities_referenced: [entity.name],
          confidence: 1,
        };
      }

      const lines = applicable.map(
        (c) => `- [${c.severity}] ${c.name}: ${c.description}`,
      );
      return {
        answer: `${applicable.length} constraint(s) apply to ${entity.name}:\n${lines.join("\n")}`,
        method: "graph",
        entities_referenced: [entity.name],
        confidence: 1,
      };
    },
  },
  {
    // "what breaks if I remove X" / "impact of removing X" / "what happens without X"
    pattern:
      /(?:what\s+(?:breaks|happens)|impact\s+of\s+removing|what\s+if\s+(?:we|I)\s+remove)\s+(?:if\s+(?:we|I)\s+remove\s+)?(?:the\s+)?(.+?)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;

      const result = analyzeImpact(model, entity.id);
      if (!result) return null;

      const lines = [result.summary];
      if (result.dependents.length > 0) {
        lines.push(
          `Dependents: ${result.dependents.map((d) => d.name).join(", ")}`,
        );
      }
      if (result.affectedProcesses.length > 0) {
        lines.push(
          `Affected processes: ${result.affectedProcesses.map((a) => a.process.name).join(", ")}`,
        );
      }
      if (result.affectedConstraints.length > 0) {
        lines.push(
          `Affected constraints: ${result.affectedConstraints.map((c) => `[${c.severity}] ${c.name}`).join(", ")}`,
        );
      }

      return {
        answer: lines.join("\n"),
        method: "graph" as const,
        entities_referenced: [
          entity.name,
          ...result.dependents.map((d) => d.name),
        ],
        confidence: 1,
      };
    },
  },
  {
    // "what processes involve X" / "where does X participate" / "processes for X"
    pattern:
      /(?:what\s+processes?\s+(?:involve|include|use|have)|(?:where|which\s+processes?)\s+does\s+.+?\s+participate|processes?\s+(?:for|with|involving))\s+(?:the\s+)?(.+?)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;

      const involved = model.processes.filter(
        (p) =>
          p.participants.includes(entity.id) ||
          p.steps.some((s) => s.actor === entity.id),
      );

      if (involved.length === 0) {
        return {
          answer: `${entity.name} does not participate in any processes.`,
          method: "graph" as const,
          entities_referenced: [entity.name],
          confidence: 1,
        };
      }

      const lines = involved.map((p) => {
        const steps = p.steps
          .filter((s) => s.actor === entity.id)
          .map((s) => `  ${s.order}. ${s.action}`);
        const role =
          steps.length > 0
            ? `\n  Steps as ${entity.name}:\n${steps.join("\n")}`
            : "\n  (participant, no direct steps)";
        return `- **${p.name}**: ${p.description}${role}`;
      });

      return {
        answer: `${entity.name} participates in ${involved.length} process${involved.length > 1 ? "es" : ""}:\n${lines.join("\n")}`,
        method: "graph" as const,
        entities_referenced: [entity.name, ...involved.map((p) => p.name)],
        confidence: 1,
      };
    },
  },
  {
    // "list all actors" / "show all systems" / "show actors" / "what actors are there"
    pattern: /(?:list|show|what)\s+(?:all\s+)?(\w+?)s?(?:\s|$|\?)/i,
    handler: (model, match) => {
      const typeQuery = match[1].toLowerCase();
      const validTypes = [
        "actor",
        "object",
        "system",
        "concept",
        "location",
        "event",
        "group",
        "resource",
      ];
      const matchedType = validTypes.find(
        (t) =>
          t === typeQuery ||
          t + "s" === typeQuery + "s" ||
          typeQuery.startsWith(t),
      );
      if (!matchedType) return null;

      const filtered = model.entities.filter((e) => e.type === matchedType);
      if (filtered.length === 0) {
        return {
          answer: `No ${matchedType} entities in this model.`,
          method: "graph" as const,
          entities_referenced: [],
          confidence: 1,
        };
      }

      const lines = filtered.map((e) => `- **${e.name}**: ${e.description}`);
      return {
        answer: `${filtered.length} ${matchedType}${filtered.length > 1 ? "s" : ""}:\n${lines.join("\n")}`,
        method: "graph" as const,
        entities_referenced: filtered.map((e) => e.name),
        confidence: 1,
      };
    },
  },
  {
    // "how many entities" / "stats" / "summary"
    pattern: /(?:how\s+many|stats|statistics|summary|overview)\b/i,
    handler: (model) => {
      const stats = getStats(model);
      const lines = [
        `Entities: ${stats.entities.total} (${Object.entries(
          stats.entities.byType,
        )
          .map(([t, c]) => `${c} ${t}`)
          .join(", ")})`,
        `Relations: ${stats.relations.total}`,
        `Processes: ${stats.processes.total} (${stats.processes.totalSteps} steps)`,
        `Constraints: ${stats.constraints.total} (${stats.constraints.hard} hard, ${stats.constraints.soft} soft)`,
        `Confidence: ${stats.confidence}`,
        "",
        "Most connected:",
        ...stats.mostConnected.map(
          (mc) => `  - ${mc.entity}: ${mc.connections} connections`,
        ),
      ];
      return {
        answer: lines.join("\n"),
        method: "graph",
        entities_referenced: stats.mostConnected.map((mc) => mc.entity),
        confidence: 1,
      };
    },
  },
  {
    // "what is X" / "describe X" / "tell me about X"
    pattern:
      /(?:what\s+is|describe|tell\s+me\s+about|who\s+is)\s+(?:the\s+)?(.+?)(?:\?|$)/i,
    handler: (model, match) => {
      const entity = findEntity(model, match[1].trim());
      if (!entity) return null;

      const deps = findDependents(model, entity.id);
      const constraints = model.constraints.filter((c) =>
        c.scope.includes(entity.id),
      );
      const processes = model.processes.filter((p) =>
        p.participants.includes(entity.id),
      );

      const lines = [
        `**${entity.name}** (${entity.type})`,
        entity.description,
        "",
      ];

      if (entity.properties && Object.keys(entity.properties).length > 0) {
        lines.push(`Properties: ${JSON.stringify(entity.properties)}`);
      }

      if (deps.incoming.length > 0) {
        lines.push(
          `Depended on by: ${deps.incoming.map((d) => d.entity.name).join(", ")}`,
        );
      }
      if (deps.outgoing.length > 0) {
        lines.push(
          `Depends on: ${deps.outgoing.map((d) => d.entity.name).join(", ")}`,
        );
      }
      if (processes.length > 0) {
        lines.push(
          `Participates in: ${processes.map((p) => p.name).join(", ")}`,
        );
      }
      if (constraints.length > 0) {
        lines.push(
          `Constraints: ${constraints.map((c) => `[${c.severity}] ${c.name}`).join(", ")}`,
        );
      }

      return {
        answer: lines.join("\n"),
        method: "graph",
        entities_referenced: [
          entity.name,
          ...deps.incoming.map((d) => d.entity.name),
          ...deps.outgoing.map((d) => d.entity.name),
        ],
        confidence: 1,
      };
    },
  },
];

// ─── LLM inference query ──────────────────────────────────────

function modelToContext(model: WorldModelType): string {
  const entities = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");

  const relations = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} —[${r.type}]→ ${tgt}: ${r.label}`;
    })
    .join("\n");

  const processes = model.processes
    .map((p) => {
      const steps = p.steps
        .map((s) => {
          const actor = s.actor
            ? (model.entities.find((e) => e.id === s.actor)?.name ?? "?")
            : "?";
          return `  ${s.order}. ${actor}: ${s.action}`;
        })
        .join("\n");
      return `- ${p.name} (trigger: ${p.trigger ?? "n/a"}): ${p.description}\n${steps}\n  Outcomes: ${p.outcomes.join(", ")}`;
    })
    .join("\n");

  const constraints = model.constraints
    .map((c) => {
      const scopeNames = c.scope
        .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
        .join(", ");
      return `- [${c.severity}] ${c.name} (applies to: ${scopeNames}): ${c.description}`;
    })
    .join("\n");

  return `# World Model: ${model.name}\n${model.description}\n\n## Entities (${model.entities.length})\n${entities}\n\n## Relations (${model.relations.length})\n${relations}\n\n## Processes (${model.processes.length})\n${processes}\n\n## Constraints (${model.constraints.length})\n${constraints}`;
}

const QUERY_SYSTEM_PROMPT = `You are a world-model query agent. You answer questions based STRICTLY on the world model provided.

RULES:
- Only use information present in the model — do not hallucinate or infer beyond what the model states
- If the model doesn't contain enough information to answer, say so explicitly
- Reference specific entities, relations, processes, and constraints by name
- Be concise and direct
- If the question asks about something not in the model, say "The model does not contain information about [X]"`;

async function inferenceQuery(
  model: WorldModelType,
  question: string,
): Promise<QueryResult> {
  const context = modelToContext(model);
  const userMessage = `${context}\n\n---\n\nQuestion: ${question}`;

  const answer = await callAgent(QUERY_SYSTEM_PROMPT, userMessage, {
    maxTokens: 4096,
  });

  // Extract entity names that appear in the answer
  const referenced = model.entities
    .filter((e) => answer.toLowerCase().includes(e.name.toLowerCase()))
    .map((e) => e.name);

  return annotateConfidence(
    { answer, method: "inference", entities_referenced: referenced, confidence: 0.8 },
    model,
  );
}

// ─── Public API ───────────────────────────────────────────────

export async function queryWorldModel(
  model: WorldModelType,
  question: string,
): Promise<QueryResult> {
  if (!question || !question.trim()) {
    return {
      answer: `No question provided. Try one of these patterns:

- what depends on <entity>?
- what does <entity> depend on?
- how is <entity> connected to <entity>?
- what constraints apply to <entity>?
- what is <entity>?
- what processes involve <entity>?
- what breaks if I remove <entity>?
- list all <type> (actor, system, object, concept, ...)
- stats / how many entities?
- Or ask any question — falls back to LLM inference.`,
      method: "graph",
      entities_referenced: [],
      confidence: 1,
      low_confidence_entities: [],
    };
  }

  // Try deterministic graph queries first
  for (const { pattern, handler } of GRAPH_PATTERNS) {
    const match = question.match(pattern);
    if (match) {
      const result = handler(model, match);
      if (result) return annotateConfidence(result, model);
      // Pattern matched but handler returned null (entity not found) — fall through to inference
    }
  }

  // Fall back to LLM inference
  return inferenceQuery(model, question);
}
