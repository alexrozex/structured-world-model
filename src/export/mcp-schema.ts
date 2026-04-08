import type { WorldModelType } from "../schema/index.js";

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >;
    required: string[];
  };
}

interface MCPSchema {
  name: string;
  description: string;
  tools: MCPTool[];
}

/**
 * Export a world model as MCP tool definitions.
 * Each entity type gets query tools. Each process gets an execution tool.
 * Constraints become validation tools.
 */
export function toMcpSchema(model: WorldModelType): MCPSchema {
  const tools: MCPTool[] = [];

  // ─── Entity lookup tool ─────────────────────────────────
  const entityNames = model.entities.map((e) => e.name);
  tools.push({
    name: "get_entity",
    description: `Look up a domain entity by name. Available entities: ${entityNames.slice(0, 10).join(", ")}${entityNames.length > 10 ? ` and ${entityNames.length - 10} more` : ""}`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the entity to look up",
          enum: entityNames,
        },
      },
      required: ["name"],
    },
  });

  // ─── Relation query tool ────────────────────────────────
  tools.push({
    name: "get_relations",
    description:
      "Get all relations for a given entity — what it depends on, what depends on it",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Name of the entity",
          enum: entityNames,
        },
        direction: {
          type: "string",
          description: "Direction of relations to query",
          enum: ["incoming", "outgoing", "both"],
        },
      },
      required: ["entity"],
    },
  });

  // ─── Process execution tools ────────────────────────────
  for (const proc of model.processes) {
    const participantNames = proc.participants.map(
      (id) => model.entities.find((e) => e.id === id)?.name ?? id,
    );

    tools.push({
      name: `process_${proc.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      description: `${proc.description}. Participants: ${participantNames.join(", ")}. ${proc.steps.length} steps.${proc.trigger ? ` Triggered by: ${proc.trigger}` : ""}`,
      inputSchema: {
        type: "object",
        properties: {
          step: {
            type: "string",
            description: `Which step to query or execute (1-${proc.steps.length})`,
          },
          context: {
            type: "string",
            description: "Additional context for this process invocation",
          },
        },
        required: [],
      },
    });
  }

  // ─── Constraint validation tool ─────────────────────────
  if (model.constraints.length > 0) {
    const constraintNames = model.constraints.map((c) => c.name);
    tools.push({
      name: "check_constraint",
      description:
        "Validate whether an action or state violates a domain constraint",
      inputSchema: {
        type: "object",
        properties: {
          constraint: {
            type: "string",
            description: "Name of the constraint to check",
            enum: constraintNames,
          },
          action: {
            type: "string",
            description:
              "Description of the action or state to validate against the constraint",
          },
        },
        required: ["constraint", "action"],
      },
    });
  }

  // ─── Query tool ─────────────────────────────────────────
  tools.push({
    name: "query_world_model",
    description: "Ask a natural language question about the domain model",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Natural language question about the domain",
        },
      },
      required: ["question"],
    },
  });

  return {
    name: model.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
    description: `MCP server for ${model.name}: ${model.description}`,
    tools,
  };
}
