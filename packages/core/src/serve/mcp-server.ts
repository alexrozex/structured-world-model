import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import type { WorldModelType } from "../schema/index.js";
import {
  findEntity,
  findDependents,
  pathsBetween,
  getStats,
  toMermaid,
  analyzeImpact,
} from "../utils/graph.js";
import { queryWorldModel } from "../agents/query.js";

function loadModel(resolved: string): WorldModelType {
  const raw = readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as WorldModelType;
}

/**
 * Create and start an MCP server that serves a world model as live, queryable tools.
 * Any AI agent that connects gets instant domain expertise.
 *
 * When the model JSON file changes on disk the server hot-reloads the model
 * without restarting — all subsequent tool calls return data from the new model.
 */
export async function startMcpServer(modelPath: string): Promise<void> {
  const resolved = resolve(modelPath);

  // Mutable container — tool handlers close over this so they always see the
  // latest model without needing to re-register.
  const state: { model: WorldModelType } = { model: loadModel(resolved) };

  // ─── File watcher: hot-reload on change ───────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  watch(resolved, () => {
    // Debounce: editors often write a file in multiple events
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        state.model = loadModel(resolved);
        process.stderr.write(`[swm-mcp] hot-reloaded model from ${resolved}\n`);
      } catch {
        process.stderr.write(
          `[swm-mcp] failed to reload model from ${resolved} — keeping previous version\n`,
        );
      }
    }, 100);
  });

  // Snapshot used only for tool descriptions (static strings set at registration)
  const initialModel = state.model;
  const entityNames = initialModel.entities.map((e) => e.name);

  const server = new McpServer({
    name: `swm-${initialModel.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
    version: initialModel.version ?? "0.1.0",
  });

  // ─── Tool: get_entity ───────────────────────────────────
  server.tool(
    "get_entity",
    `Look up a domain entity. This world model has ${initialModel.entities.length} entities across ${new Set(initialModel.entities.map((e) => e.type)).size} types.`,
    {
      name: z
        .string()
        .describe(
          `Entity name to look up. Available: ${entityNames.slice(0, 15).join(", ")}${entityNames.length > 15 ? "..." : ""}`,
        ),
    },
    async ({ name }) => {
      const model = state.model;
      const entity = findEntity(model, name);
      if (!entity) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Entity "${name}" not found. Available: ${model.entities.map((e) => e.name).join(", ")}`,
            },
          ],
        };
      }

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
        lines.push(`Properties: ${JSON.stringify(entity.properties, null, 2)}`);
      }
      if (deps.incoming.length > 0) {
        lines.push(
          `\nDepended on by: ${deps.incoming.map((d) => `${d.entity.name} [${d.relation.type}]`).join(", ")}`,
        );
      }
      if (deps.outgoing.length > 0) {
        lines.push(
          `Depends on: ${deps.outgoing.map((d) => `${d.entity.name} [${d.relation.type}]`).join(", ")}`,
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

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: get_relations ────────────────────────────────
  server.tool(
    "get_relations",
    "Get all relations for a given entity — incoming, outgoing, or both",
    {
      entity: z.string().describe("Entity name"),
      direction: z
        .enum(["incoming", "outgoing", "both"])
        .default("both")
        .describe("Direction of relations"),
    },
    async ({ entity: name, direction }) => {
      const model = state.model;
      const entity = findEntity(model, name);
      if (!entity) {
        return {
          content: [
            { type: "text" as const, text: `Entity "${name}" not found.` },
          ],
        };
      }

      const deps = findDependents(model, entity.id);
      const lines: string[] = [];

      if (direction !== "outgoing" && deps.incoming.length > 0) {
        lines.push("**Incoming:**");
        for (const d of deps.incoming) {
          lines.push(
            `  ${d.entity.name} —[${d.relation.type}]→ ${entity.name}: ${d.relation.label}`,
          );
        }
      }
      if (direction !== "incoming" && deps.outgoing.length > 0) {
        lines.push("**Outgoing:**");
        for (const d of deps.outgoing) {
          lines.push(
            `  ${entity.name} —[${d.relation.type}]→ ${d.entity.name}: ${d.relation.label}`,
          );
        }
      }

      if (lines.length === 0) lines.push("No relations found.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: find_path ────────────────────────────────────
  server.tool(
    "find_path",
    "Find connection paths between two entities in the domain model",
    {
      from: z.string().describe("Source entity name"),
      to: z.string().describe("Target entity name"),
    },
    async ({ from, to }) => {
      const model = state.model;
      const src = findEntity(model, from);
      const tgt = findEntity(model, to);
      if (!src)
        return {
          content: [
            { type: "text" as const, text: `Entity "${from}" not found.` },
          ],
        };
      if (!tgt)
        return {
          content: [
            { type: "text" as const, text: `Entity "${to}" not found.` },
          ],
        };

      const paths = pathsBetween(model, src.id, tgt.id);
      if (paths.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No path found from ${src.name} to ${tgt.name}.`,
            },
          ],
        };
      }

      const lines = paths.map((path, i) => {
        const hops = path
          .map((step, j) =>
            j === 0
              ? step.entity.name
              : `—[${step.relation?.type ?? "?"}]→ ${step.entity.name}`,
          )
          .join(" ");
        return `Path ${i + 1}: ${hops}`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: get_process ──────────────────────────────────
  server.tool(
    "get_process",
    `Get details of a domain process. Available: ${initialModel.processes.map((p) => p.name).join(", ")}`,
    { name: z.string().describe("Process name") },
    async ({ name }) => {
      const model = state.model;
      const proc = model.processes.find((p) =>
        p.name.toLowerCase().includes(name.toLowerCase()),
      );
      if (!proc) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Process "${name}" not found. Available: ${model.processes.map((p) => p.name).join(", ")}`,
            },
          ],
        };
      }

      const lines = [
        `**${proc.name}**`,
        proc.description,
        proc.trigger ? `Trigger: ${proc.trigger}` : "",
        "",
        "Steps:",
      ];

      for (const step of proc.steps) {
        const actor = step.actor
          ? (model.entities.find((e) => e.id === step.actor)?.name ?? "?")
          : "system";
        lines.push(`  ${step.order}. **${actor}**: ${step.action}`);
      }

      const participants = proc.participants
        .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
        .join(", ");
      lines.push(`\nParticipants: ${participants}`);
      lines.push(`Outcomes: ${proc.outcomes.join(", ")}`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: check_constraint ─────────────────────────────
  server.tool(
    "check_constraint",
    `Check if an action violates a domain constraint. Constraints: ${initialModel.constraints.map((c) => `[${c.severity}] ${c.name}`).join(", ")}`,
    {
      action: z.string().describe("Description of the action to validate"),
    },
    async ({ action }) => {
      const model = state.model;
      const lines = ["Checking action against all constraints:\n"];

      for (const c of model.constraints) {
        const scopeNames = c.scope
          .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
          .join(", ");
        lines.push(
          `[${c.severity.toUpperCase()}] ${c.name} (applies to: ${scopeNames})`,
        );
        lines.push(`  Rule: ${c.description}`);
        lines.push("");
      }

      lines.push(`\nAction to evaluate: "${action}"`);
      lines.push("Review each constraint above against this action.");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: query ────────────────────────────────────────
  server.tool(
    "query",
    "Ask any natural language question about this domain. Uses graph analysis for structural questions, LLM inference for open-ended ones.",
    { question: z.string().describe("Your question about the domain") },
    async ({ question }) => {
      const result = await queryWorldModel(state.model, question);
      return {
        content: [
          {
            type: "text" as const,
            text: `${result.answer}\n\n---\nMethod: ${result.method} | Confidence: ${result.confidence}`,
          },
        ],
      };
    },
  );

  // ─── Tool: get_stats ────────────────────────────────────
  server.tool(
    "get_stats",
    "Get statistical overview of the domain model",
    {},
    async () => {
      const model = state.model;
      const stats = getStats(model);
      const lines = [
        `**${model.name}**`,
        model.description,
        "",
        `Entities: ${stats.entities.total} (${Object.entries(
          stats.entities.byType,
        )
          .map(([t, c]) => `${c} ${t}`)
          .join(", ")})`,
        `Relations: ${stats.relations.total} (${Object.entries(
          stats.relations.byType,
        )
          .map(([t, c]) => `${c} ${t}`)
          .join(", ")})`,
        `Processes: ${stats.processes.total} (${stats.processes.totalSteps} total steps)`,
        `Constraints: ${stats.constraints.total} (${stats.constraints.hard} hard, ${stats.constraints.soft} soft)`,
        `Confidence: ${stats.confidence}`,
        "",
        "Most connected entities:",
        ...stats.mostConnected.map(
          (mc) => `  ${mc.entity}: ${mc.connections} connections`,
        ),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: get_diagram ──────────────────────────────────
  server.tool(
    "get_diagram",
    "Get a Mermaid diagram of the world model for visualization",
    {},
    async () => {
      return {
        content: [{ type: "text" as const, text: toMermaid(state.model) }],
      };
    },
  );

  // ─── Tool: analyze_impact ────────────────────────────────
  server.tool(
    "analyze_impact",
    "Analyze what breaks if an entity is removed — broken relations, dependents, affected processes and constraints, severity rating",
    {
      entity: z.string().describe("Entity name to analyze"),
    },
    async ({ entity: name }) => {
      const model = state.model;
      const entity = findEntity(model, name);
      if (!entity) {
        return {
          content: [
            { type: "text" as const, text: `Entity "${name}" not found.` },
          ],
        };
      }
      const result = analyzeImpact(model, entity.id);
      if (!result) {
        return {
          content: [{ type: "text" as const, text: "Analysis failed." }],
        };
      }

      const lines = [
        `**Impact of removing ${entity.name}** — Severity: ${result.severity.toUpperCase()}`,
        "",
        result.summary,
      ];
      if (result.dependents.length > 0) {
        lines.push(
          `\nDependents: ${result.dependents.map((d) => d.name).join(", ")}`,
        );
      }
      if (result.affectedProcesses.length > 0) {
        lines.push(
          `Affected processes: ${result.affectedProcesses.map((a) => `${a.process.name} (${a.role})`).join(", ")}`,
        );
      }
      if (result.affectedConstraints.length > 0) {
        lines.push(
          `Affected constraints: ${result.affectedConstraints.map((c) => `[${c.severity}] ${c.name}`).join(", ")}`,
        );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Tool: search ────────────────────────────────────────
  server.tool(
    "search",
    "Full-text search across all entities, relations, processes, and constraints",
    { query: z.string().describe("Search term") },
    async ({ query }) => {
      const model = state.model;
      const q = query.toLowerCase();

      const matchedEntities = model.entities.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description && e.description.toLowerCase().includes(q)),
      );

      const matchedRelations = model.relations.filter((r) =>
        r.label.toLowerCase().includes(q),
      );

      const matchedProcesses = model.processes.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          p.steps.some((s) => s.action.toLowerCase().includes(q)),
      );

      const matchedConstraints = model.constraints.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q)),
      );

      const lines: string[] = [];

      lines.push("**Entities:**");
      if (matchedEntities.length > 0) {
        for (const e of matchedEntities) {
          lines.push(`  ${e.name} (${e.type}) — ${e.description ?? ""}`);
        }
      } else {
        lines.push("  No matches.");
      }

      lines.push("\n**Relations:**");
      if (matchedRelations.length > 0) {
        for (const r of matchedRelations) {
          const src =
            model.entities.find((e) => e.id === r.source)?.name ?? r.source;
          const tgt =
            model.entities.find((e) => e.id === r.target)?.name ?? r.target;
          lines.push(`  ${src} —[${r.type}]→ ${tgt}: ${r.label}`);
        }
      } else {
        lines.push("  No matches.");
      }

      lines.push("\n**Processes:**");
      if (matchedProcesses.length > 0) {
        for (const p of matchedProcesses) {
          lines.push(`  ${p.name} — ${p.description ?? ""}`);
        }
      } else {
        lines.push("  No matches.");
      }

      lines.push("\n**Constraints:**");
      if (matchedConstraints.length > 0) {
        for (const c of matchedConstraints) {
          lines.push(`  [${c.severity}] ${c.name} — ${c.description ?? ""}`);
        }
      } else {
        lines.push("  No matches.");
      }

      const total =
        matchedEntities.length +
        matchedRelations.length +
        matchedProcesses.length +
        matchedConstraints.length;
      lines.unshift(`Found ${total} result(s) for "${query}":\n`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ─── Resource: full model ───────────────────────────────
  server.resource("world-model", `swm://model/${initialModel.id}`, async () => {
    const model = state.model;
    return {
      contents: [
        {
          uri: `swm://model/${model.id}`,
          text: JSON.stringify(model, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
