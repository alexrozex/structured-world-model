import type { Blueprint } from "@swm/compiler";
import type { ConfigGraph } from "./types.js";
import { generatePostcode } from "@swm/provenance";

export interface WorldModelNode {
  readonly id: string; // postcode string
  readonly type: "blueprint" | "agent" | "skill" | "hook" | "world-model";
  readonly name: string;
  readonly path: string; // relative file path
  readonly boundedContext?: string;
  readonly edges: {
    readonly implements: readonly string[]; // workflow names
    readonly dependsOn: readonly string[]; // other node IDs (postcodes)
    readonly usedBy: readonly string[]; // reverse edges: who depends on this
  };
}

export interface WorldModel {
  readonly postcode: string;
  readonly compiledAt: number;
  readonly blueprintPostcode: string;
  readonly nodes: readonly WorldModelNode[];
  readonly edges: readonly { from: string; to: string; relation: string }[];
}

export function buildWorldModel(
  blueprint: Blueprint,
  _configGraph: ConfigGraph,
): WorldModel {
  const compiledAt = Date.now();
  const nodes: WorldModelNode[] = [];
  const edges: { from: string; to: string; relation: string }[] = [];

  // ── Blueprint node ──────────────────────────────────────────────────────
  const blueprintNode: WorldModelNode = {
    id: blueprint.postcode.raw,
    type: "blueprint",
    name: blueprint.summary.split(".")[0]?.slice(0, 60) ?? "blueprint",
    path: "CLAUDE.md",
    edges: {
      implements: blueprint.architecture.components.map((c) => c.name),
      dependsOn: [],
      usedBy: [],
    },
  };
  nodes.push(blueprintNode);

  // ── Agent nodes ─────────────────────────────────────────────────────────
  for (const component of blueprint.architecture.components) {
    const agentId = `ML.AGT.${component.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}/v1`;
    const agentPath = `AGENTS/${component.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.md`;

    // Find workflows for this bounded context
    const contextWorkflows = blueprint.processModel.workflows
      .filter((w) =>
        w.steps.some((s) => s.boundedContext === component.boundedContext),
      )
      .map((w) => w.name);

    // Find dependencies (other components this one depends on)
    const depIds = component.dependencies.map(
      (dep) => `ML.AGT.${dep.toLowerCase().replace(/[^a-z0-9]/g, "-")}/v1`,
    );

    const agentNode: WorldModelNode = {
      id: agentId,
      type: "agent",
      name: component.name,
      path: agentPath,
      boundedContext: component.boundedContext,
      edges: {
        implements: contextWorkflows,
        dependsOn: [blueprint.postcode.raw, ...depIds],
        usedBy: [],
      },
    };
    nodes.push(agentNode);

    // Blueprint → Agent edges
    edges.push({
      from: blueprint.postcode.raw,
      to: agentId,
      relation: "produces",
    });
    for (const depId of depIds) {
      edges.push({ from: agentId, to: depId, relation: "depends_on" });
    }
  }

  // ── Skill nodes ─────────────────────────────────────────────────────────
  for (const workflow of blueprint.processModel.workflows) {
    const skillId = `ML.SKL.${workflow.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}/v1`;
    const skillNode: WorldModelNode = {
      id: skillId,
      type: "skill",
      name: workflow.name,
      path: `SKILLS/${workflow.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.md`,
      edges: {
        implements: [workflow.name],
        dependsOn: [blueprint.postcode.raw],
        usedBy: [],
      },
    };
    nodes.push(skillNode);
    edges.push({
      from: blueprint.postcode.raw,
      to: skillId,
      relation: "defines",
    });
  }

  // ── Compute reverse edges (usedBy) ────────────────────────────────────────
  const usedByMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (!usedByMap.has(edge.to)) usedByMap.set(edge.to, []);
    usedByMap.get(edge.to)!.push(edge.from);
  }

  const nodesWithReverse = nodes.map((n) => ({
    ...n,
    edges: {
      ...n.edges,
      usedBy: usedByMap.get(n.id) ?? [],
    },
  }));

  const content = JSON.stringify({
    blueprintPostcode: blueprint.postcode.raw,
    nodeCount: nodesWithReverse.length,
  });
  const postcode = generatePostcode("CFG", content);

  return {
    postcode: postcode.raw,
    compiledAt,
    blueprintPostcode: blueprint.postcode.raw,
    nodes: nodesWithReverse,
    edges,
  };
}

export function renderWorldModelMd(worldModel: WorldModel): string {
  const lines = [
    `---`,
    `ada_postcode: "${worldModel.postcode}"`,
    `ada_type: world-model`,
    `ada_blueprint: "${worldModel.blueprintPostcode}"`,
    `ada_nodes: ${worldModel.nodes.length}`,
    `ada_compiled_at: ${worldModel.compiledAt}`,
    `---`,
    ``,
    `# World Model`,
    ``,
    `This is the navigable graph of all compiled artifacts. Every node has a postcode. Every edge is a typed relationship. Load any node and traverse to its neighbors.`,
    ``,
    `## Nodes (${worldModel.nodes.length})`,
    ``,
  ];

  for (const node of worldModel.nodes) {
    lines.push(`### ${node.name}`);
    lines.push(`- **Type:** ${node.type}`);
    lines.push(`- **Postcode:** \`${node.id}\``);
    lines.push(`- **Path:** \`${node.path}\``);
    if (node.boundedContext)
      lines.push(`- **Bounded context:** ${node.boundedContext}`);
    if (node.edges.implements.length > 0)
      lines.push(`- **Implements:** ${node.edges.implements.join(", ")}`);
    if (node.edges.dependsOn.length > 0)
      lines.push(
        `- **Depends on:** ${node.edges.dependsOn.map((id) => `\`${id}\``).join(", ")}`,
      );
    if (node.edges.usedBy.length > 0)
      lines.push(
        `- **Used by:** ${node.edges.usedBy.map((id) => `\`${id}\``).join(", ")}`,
      );
    lines.push(``);
  }

  lines.push(`## Edge List`);
  lines.push(``);
  for (const edge of worldModel.edges) {
    lines.push(`- \`${edge.from}\` → \`${edge.to}\` *(${edge.relation})*`);
  }

  return lines.join("\n");
}
