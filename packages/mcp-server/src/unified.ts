/**
 * Unified MCP server: SWM extraction tools + Ada governance tools + bridge tools.
 *
 * Starts a single MCP server that provides:
 * - swm.* tools (9): entity lookup, pathfinding, impact analysis, query, diagram
 * - ada.* tools (26+): blueprint, invariants, drift, delegation, execution
 * - bridge.* tools (2): extract_and_compile, enrich_model
 *
 * Loads a world model JSON (for SWM tools) and/or .ada/state.json (for Ada tools).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// SWM tool implementations (re-exported from @swm/core's serve module)
import { getBlueprint } from "./tools/blueprint.js";
import { getInvariants } from "./tools/invariants.js";
import { verifyCode } from "./tools/verify.js";
import { getWorkflow } from "./tools/workflow.js";
import { logDrift } from "./tools/drift.js";
import { proposeAgent } from "./tools/propose-agent.js";
import { queryConstraints } from "./tools/query-constraints.js";
import { checkDrift } from "./tools/check-drift.js";
import { getWorldModel as getAdaWorldModel } from "./tools/get-world-model.js";
import { proposeAmendment } from "./tools/propose-amendment.js";
import {
  getRuntimeState,
  createCheckpoint,
  rollbackTo,
  recordFact,
} from "./tools/runtime-state.js";
import { getMacroPlan } from "./tools/macro-plan.js";
import { extractSkills, proposeSkill } from "./tools/skill-extraction.js";
import { runVerificationStack } from "./tools/verify-stack.js";
import {
  getContract,
  enterDelegation,
  exitDelegation,
} from "./tools/get-contract.js";
import { reportImplementationDecision, reportGap } from "./tools/feedback.js";
import { reportExecutionFailure, resolveRepair } from "./tools/local-repair.js";
import { advanceExecution } from "./tools/advance.js";
import { completeSubGoal } from "./tools/execution-orchestrator.js";
import { setTaskStatus as setTaskStatusSubGoal } from "./tools/task-status.js";
import { compileIntent } from "./tools/compile.js";
import { researchTopic } from "./tools/research.js";

export interface UnifiedServerOptions {
  /** Path to a SWM world model JSON file. Enables swm.* tools. */
  worldModelPath?: string;
  /** Whether Ada tools should be enabled. Default true if .ada/ exists. */
  enableAda?: boolean;
}

interface SwmModel {
  id: string;
  name: string;
  version: string;
  description: string;
  entities: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    properties?: Record<string, unknown>;
    tags?: string[];
    confidence?: number;
  }>;
  relations: Array<{
    id: string;
    type: string;
    source: string;
    target: string;
    label: string;
    weight?: number;
    bidirectional?: boolean;
  }>;
  processes: Array<{
    id: string;
    name: string;
    description: string;
    trigger?: string;
    steps: Array<{
      order: number;
      action: string;
      actor?: string;
      input?: string[];
      output?: string[];
    }>;
    participants: string[];
    outcomes: string[];
  }>;
  constraints: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    scope: string[];
    severity: "hard" | "soft";
  }>;
  metadata?: {
    source_type: string;
    source_summary: string;
    confidence: number;
    extraction_notes?: string[];
  };
}

export async function startUnifiedServer(
  options: UnifiedServerOptions = {},
): Promise<void> {
  const hasAda =
    options.enableAda ?? fs.existsSync(path.resolve(".ada/state.json"));

  let model: SwmModel | null = null;
  if (options.worldModelPath) {
    const resolved = path.resolve(options.worldModelPath);
    const raw = fs.readFileSync(resolved, "utf-8");
    model = JSON.parse(raw) as SwmModel;
  }

  const serverName = model
    ? `swm-unified-${model.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`
    : "swm-unified";

  const server = new McpServer({
    name: serverName,
    version: model?.version ?? "1.0.0",
  });

  // ═══════════════════════════════════════════════════════════════
  // SWM Tools (require a loaded world model)
  // ═══════════════════════════════════════════════════════════════

  if (model) {
    registerSwmTools(server, model);
  }

  // ═══════════════════════════════════════════════════════════════
  // Ada Tools (require .ada/ directory)
  // ═══════════════════════════════════════════════════════════════

  if (hasAda) {
    registerAdaTools(server);
  }

  // ═══════════════════════════════════════════════════════════════
  // Bridge Tools (available when both engines are present)
  // ═══════════════════════════════════════════════════════════════

  registerBridgeTools(server, !!model, hasAda);

  // Connect
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── SWM Tool Registration ──────────────────────────────────────

function registerSwmTools(server: McpServer, model: SwmModel): void {
  const entityNames = model.entities.map((e) => e.name);

  const findEntity = (name: string) =>
    model.entities.find((e) => e.name.toLowerCase() === name.toLowerCase()) ??
    model.entities.find((e) =>
      e.name.toLowerCase().includes(name.toLowerCase()),
    );

  const findDeps = (entityId: string) => {
    const incoming = model.relations
      .filter((r) => r.target === entityId)
      .map((r) => ({
        relation: r,
        entity: model.entities.find((e) => e.id === r.source),
      }))
      .filter((d) => d.entity);
    const outgoing = model.relations
      .filter((r) => r.source === entityId)
      .map((r) => ({
        relation: r,
        entity: model.entities.find((e) => e.id === r.target),
      }))
      .filter((d) => d.entity);
    return { incoming, outgoing };
  };

  server.tool(
    "swm.get_entity",
    `Look up a domain entity. ${model.entities.length} entities available.`,
    {
      name: z
        .string()
        .describe(
          `Entity name. Available: ${entityNames.slice(0, 15).join(", ")}`,
        ),
    },
    async ({ name }) => {
      const entity = findEntity(name);
      if (!entity)
        return {
          content: [
            {
              type: "text" as const,
              text: `Entity "${name}" not found. Available: ${entityNames.join(", ")}`,
            },
          ],
        };
      const deps = findDeps(entity.id);
      const lines = [
        `**${entity.name}** (${entity.type})`,
        entity.description,
        "",
      ];
      if (deps.incoming.length > 0)
        lines.push(
          `Depended on by: ${deps.incoming.map((d) => `${d.entity!.name} [${d.relation.type}]`).join(", ")}`,
        );
      if (deps.outgoing.length > 0)
        lines.push(
          `Depends on: ${deps.outgoing.map((d) => `${d.entity!.name} [${d.relation.type}]`).join(", ")}`,
        );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.get_relations",
    "Get relations for an entity",
    {
      entity: z.string(),
      direction: z.enum(["incoming", "outgoing", "both"]).default("both"),
    },
    async ({ entity: name, direction }) => {
      const entity = findEntity(name);
      if (!entity)
        return {
          content: [
            { type: "text" as const, text: `Entity "${name}" not found.` },
          ],
        };
      const deps = findDeps(entity.id);
      const lines: string[] = [];
      if (direction !== "outgoing")
        for (const d of deps.incoming)
          lines.push(`${d.entity!.name} —[${d.relation.type}]→ ${entity.name}`);
      if (direction !== "incoming")
        for (const d of deps.outgoing)
          lines.push(`${entity.name} —[${d.relation.type}]→ ${d.entity!.name}`);
      return {
        content: [
          {
            type: "text" as const,
            text: lines.length ? lines.join("\n") : "No relations found.",
          },
        ],
      };
    },
  );

  server.tool(
    "swm.find_path",
    "Find paths between two entities",
    { from: z.string(), to: z.string() },
    async ({ from, to }) => {
      // BFS pathfinding
      const src = findEntity(from);
      const tgt = findEntity(to);
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

      const adj = new Map<string, Array<{ target: string; type: string }>>();
      for (const r of model.relations) {
        if (!adj.has(r.source)) adj.set(r.source, []);
        adj.get(r.source)!.push({ target: r.target, type: r.type });
        if (!adj.has(r.target)) adj.set(r.target, []);
        adj.get(r.target)!.push({ target: r.source, type: r.type });
      }

      const queue: Array<{ id: string; path: string[] }> = [
        { id: src.id, path: [src.name] },
      ];
      const visited = new Set<string>([src.id]);
      const paths: string[][] = [];

      while (queue.length > 0 && paths.length < 5) {
        const curr = queue.shift()!;
        if (curr.id === tgt.id) {
          paths.push(curr.path);
          continue;
        }
        if (curr.path.length > 6) continue;
        for (const n of adj.get(curr.id) ?? []) {
          if (!visited.has(n.target)) {
            visited.add(n.target);
            const name =
              model.entities.find((e) => e.id === n.target)?.name ?? n.target;
            queue.push({
              id: n.target,
              path: [...curr.path, `—[${n.type}]→`, name],
            });
          }
        }
      }

      const text = paths.length
        ? paths.map((p, i) => `Path ${i + 1}: ${p.join(" ")}`).join("\n")
        : `No path found from ${src.name} to ${tgt.name}.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "swm.get_process",
    `Get process details. Available: ${model.processes.map((p) => p.name).join(", ")}`,
    { name: z.string() },
    async ({ name }) => {
      const proc = model.processes.find((p) =>
        p.name.toLowerCase().includes(name.toLowerCase()),
      );
      if (!proc)
        return {
          content: [
            { type: "text" as const, text: `Process "${name}" not found.` },
          ],
        };
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
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.check_constraint",
    "Check action against domain constraints",
    { action: z.string() },
    async ({ action }) => {
      const lines = model.constraints.map(
        (c) => `[${c.severity.toUpperCase()}] ${c.name}: ${c.description}`,
      );
      lines.push(`\nAction to evaluate: "${action}"`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.get_stats",
    "Statistical overview of the domain model",
    {},
    async () => {
      const byType: Record<string, number> = {};
      for (const e of model.entities)
        byType[e.type] = (byType[e.type] ?? 0) + 1;
      const lines = [
        `**${model.name}**: ${model.description}`,
        `Entities: ${model.entities.length} (${Object.entries(byType)
          .map(([t, c]) => `${c} ${t}`)
          .join(", ")})`,
        `Relations: ${model.relations.length}`,
        `Processes: ${model.processes.length}`,
        `Constraints: ${model.constraints.length}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.get_diagram",
    "Mermaid diagram of the domain model",
    {},
    async () => {
      const lines = ["graph TD"];
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");
      for (const e of model.entities)
        lines.push(`  ${sanitize(e.name)}["${e.name}"]`);
      for (const r of model.relations) {
        const s = model.entities.find((e) => e.id === r.source);
        const t = model.entities.find((e) => e.id === r.target);
        if (s && t)
          lines.push(
            `  ${sanitize(s.name)} -->|${r.type}| ${sanitize(t.name)}`,
          );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.analyze_impact",
    "What breaks if an entity is removed",
    { entity: z.string() },
    async ({ entity: name }) => {
      const entity = findEntity(name);
      if (!entity)
        return {
          content: [
            { type: "text" as const, text: `Entity "${name}" not found.` },
          ],
        };
      const deps = findDeps(entity.id);
      const affectedProcesses = model.processes.filter((p) =>
        p.participants.includes(entity.id),
      );
      const affectedConstraints = model.constraints.filter((c) =>
        c.scope.includes(entity.id),
      );
      const lines = [
        `**Impact of removing ${entity.name}**`,
        `Direct dependents: ${deps.incoming.length}`,
        `Affected processes: ${affectedProcesses.map((p) => p.name).join(", ") || "none"}`,
        `Affected constraints: ${affectedConstraints.map((c) => `[${c.severity}] ${c.name}`).join(", ") || "none"}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "swm.query",
    "Natural language question about this domain",
    { question: z.string() },
    async ({ question }) => {
      // Simplified query — keyword match against entities and relations
      const q = question.toLowerCase();
      const matches = model.entities.filter(
        (e) =>
          q.includes(e.name.toLowerCase()) ||
          e.description.toLowerCase().includes(q),
      );
      if (matches.length > 0) {
        const lines = matches.map(
          (e) => `**${e.name}** (${e.type}): ${e.description}`,
        );
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `No direct match found for "${question}". Try searching for specific entity names.`,
          },
        ],
      };
    },
  );
}

// ─── Ada Tool Registration ──────────────────────────────────────

function registerAdaTools(server: McpServer): void {
  server.tool(
    "ada.get_blueprint",
    "Returns the full active Blueprint",
    {},
    async () => {
      const r = getBlueprint();
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.get_invariants",
    "Returns invariants for an entity",
    { entityName: z.string() },
    async ({ entityName }) => {
      const r = getInvariants(entityName);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.verify",
    "Check code against entity invariants",
    { code: z.string(), entityName: z.string() },
    async ({ code, entityName }) => {
      const r = verifyCode(code, entityName);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.get_workflow",
    "Get workflow steps with Hoare triples",
    { workflowName: z.string() },
    async ({ workflowName }) => {
      const r = getWorkflow(workflowName);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.log_drift",
    "Log semantic drift",
    {
      location: z.string(),
      original: z.string(),
      actual: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
    },
    async ({ location, original, actual, severity }) => {
      const r = logDrift(location, original, actual, severity);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.query_constraints",
    "Query constraints by scope",
    { scope: z.string() },
    async ({ scope }) => {
      const r = queryConstraints(scope);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.check_drift",
    "Check if change aligns with intent",
    { description: z.string() },
    async ({ description }) => {
      const r = checkDrift(description);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.get_macro_plan",
    "Ordered execution plan from blueprint",
    {},
    async () => {
      const r = getMacroPlan();
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.compile",
    "Compile intent through 9-stage pipeline",
    {
      intent: z.string(),
      projectDir: z.string().optional(),
      amend: z.boolean().optional(),
    },
    async ({ intent, projectDir, amend }) => {
      const r = compileIntent(intent, projectDir ?? process.cwd(), {
        ...(amend !== undefined && { amend }),
      });
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.advance_execution",
    "Get task brief for next subGoal",
    {
      agentId: z.string(),
      projectDir: z.string().optional(),
    },
    async ({ agentId, projectDir }) => {
      const r = advanceExecution(agentId, projectDir);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.set_task_status",
    "Report task completion",
    {
      component: z.string(),
      status: z.enum(["in_progress", "complete", "blocked"]),
      evidence: z.array(z.string()).optional(),
      projectDir: z.string().optional(),
    },
    async ({ component, status, evidence, projectDir }) => {
      const r = setTaskStatusSubGoal(
        component,
        status,
        evidence ?? [],
        projectDir,
      );
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.complete_subgoal",
    "Mark bounded context complete",
    {
      subGoalName: z.string(),
      evidence: z.array(z.string()),
    },
    async ({ subGoalName, evidence }) => {
      const r = completeSubGoal(subGoalName, evidence);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.get_runtime_state",
    "Current world-state snapshot",
    {},
    async () => {
      const r = getRuntimeState();
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.checkpoint",
    "Create named checkpoint",
    { description: z.string() },
    async ({ description }) => {
      const r = createCheckpoint(description);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.rollback_to",
    "Rollback to checkpoint",
    { checkpointId: z.string() },
    async ({ checkpointId }) => {
      const r = rollbackTo(checkpointId);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.record_fact",
    "Record world-state fact",
    {
      fact: z.string(),
      confidence: z.number(),
      source: z.enum(["tool_output", "inferred"]),
      evidencePath: z.string().optional(),
    },
    async ({ fact, confidence, source, evidencePath }) => {
      const r = recordFact(fact, confidence, source, evidencePath);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.get_world_model",
    "Get compiled world model or stage artifact",
    {
      stage: z.string().optional(),
    },
    async ({ stage }) => {
      const r = getAdaWorldModel(stage);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.propose_amendment",
    "Propose blueprint change",
    {
      stage: z.string(),
      field: z.string(),
      proposed: z.string(),
      rationale: z.string(),
      original: z.string().optional(),
    },
    async ({ stage, field, proposed, rationale, original }) => {
      const r = proposeAmendment(stage, field, proposed, rationale, original);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.report_execution_failure",
    "Report component failure",
    {
      componentName: z.string(),
      failureDescription: z.string(),
      maxRetries: z.number().optional(),
    },
    async ({ componentName, failureDescription, maxRetries }) => {
      const r = reportExecutionFailure(
        componentName,
        failureDescription,
        maxRetries ?? 3,
      );
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.resolve_repair",
    "Mark repair as resolved",
    { componentName: z.string() },
    async ({ componentName }) => {
      const r = resolveRepair(componentName);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.report_gap",
    "Report blueprint gap",
    { description: z.string() },
    async ({ description }) => {
      const r = reportGap(description);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );

  server.tool(
    "ada.research",
    "Web research for current best practices",
    {
      query: z.string(),
      focus: z.string().optional(),
    },
    async ({ query, focus }) => {
      const r = await researchTopic(query, focus);
      return {
        content: [{ type: "text" as const, text: r.content }],
        isError: r.isError,
      };
    },
  );
}

// ─── Bridge Tool Registration ───────────────────────────────────

function registerBridgeTools(
  server: McpServer,
  hasModel: boolean,
  hasAda: boolean,
): void {
  server.tool(
    "bridge.status",
    "Shows which engines are active and what capabilities are available",
    {},
    async () => {
      const lines = [
        "**Unified SWM Server Status**",
        `SWM extraction tools: ${hasModel ? "ACTIVE (world model loaded)" : "INACTIVE (no world model)"}`,
        `Ada governance tools: ${hasAda ? "ACTIVE (.ada/ found)" : "INACTIVE (no .ada/)"}`,
        "",
        hasModel
          ? "Use swm.* tools to query the domain model."
          : "Load a world model with: swm serve <model.json>",
        hasAda
          ? "Use ada.* tools for governance and compilation."
          : "Run swm compile to create a blueprint.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "bridge.capabilities",
    "List all available tools grouped by engine",
    {},
    async () => {
      const swmTools = hasModel
        ? [
            "swm.get_entity",
            "swm.get_relations",
            "swm.find_path",
            "swm.get_process",
            "swm.check_constraint",
            "swm.get_stats",
            "swm.get_diagram",
            "swm.analyze_impact",
            "swm.query",
          ]
        : [];
      const adaTools = hasAda
        ? [
            "ada.get_blueprint",
            "ada.get_invariants",
            "ada.verify",
            "ada.get_workflow",
            "ada.log_drift",
            "ada.query_constraints",
            "ada.check_drift",
            "ada.get_macro_plan",
            "ada.compile",
            "ada.advance_execution",
            "ada.set_task_status",
            "ada.complete_subgoal",
            "ada.get_runtime_state",
            "ada.checkpoint",
            "ada.rollback_to",
            "ada.record_fact",
            "ada.get_world_model",
            "ada.propose_amendment",
            "ada.report_execution_failure",
            "ada.resolve_repair",
            "ada.report_gap",
            "ada.research",
          ]
        : [];
      const bridgeTools = ["bridge.status", "bridge.capabilities"];

      const lines = [
        `**SWM Tools** (${swmTools.length}): ${swmTools.join(", ") || "none (no world model loaded)"}`,
        `**Ada Tools** (${adaTools.length}): ${adaTools.join(", ") || "none (no .ada/ found)"}`,
        `**Bridge Tools** (${bridgeTools.length}): ${bridgeTools.join(", ")}`,
        `\nTotal: ${swmTools.length + adaTools.length + bridgeTools.length} tools`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}
