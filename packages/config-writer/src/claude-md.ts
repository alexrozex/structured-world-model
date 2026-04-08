import type { Blueprint, DomainContext } from "@swm/compiler";
import { renderFrontmatter } from "./types.js";

export function blueprintToCLAUDEMD(
  blueprint: Blueprint,
  warnings?: string[],
  domainContext?: DomainContext,
): string {
  const frontmatter = renderFrontmatter({
    postcode: blueprint.postcode.raw,
    type: "blueprint",
    name: blueprint.summary.split(".")[0]?.slice(0, 60) ?? "blueprint",
    edges: {
      implements: blueprint.architecture.components.map((c) => c.name),
    },
    compiledAt: Date.now(),
  });

  const lines: string[] = [];

  // 0. Warning banner (fallback/partial compilation)
  if (warnings && warnings.length > 0) {
    lines.push(
      "> **WARNING: Partial compilation** — this blueprint was produced by fallback.",
    );
    for (const w of warnings) {
      lines.push(`> - ${w}`);
    }
    lines.push("");
  }

  // 1. Title + summary
  lines.push(`# ${blueprint.summary.split(".")[0]}`);
  lines.push("");
  lines.push(blueprint.summary);
  lines.push("");

  // 2. Out of scope — safety constraint, always inline
  const outOfScope = blueprint.scope?.outOfScope?.length
    ? blueprint.scope.outOfScope
    : (domainContext?.excludedConcerns ?? []);
  if (outOfScope.length > 0) {
    lines.push("## Out of Scope");
    lines.push("Ada explicitly excluded these. Do not build them:");
    for (const exc of outOfScope) {
      lines.push(`- ${exc}`);
    }
    lines.push("");
  }

  // 3. Build order — component names only, no inline detail
  const components = blueprint.architecture.components;
  if (components.length > 0) {
    const ordered = topologicalSort(components);
    lines.push("## Build Order");
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i]!;
      lines.push(`${i + 1}. **${c.name}** \`${c.boundedContext}\``);
    }
    lines.push("");
  }

  // 4. Orchestration map (only when subGoals present)
  if (blueprint.subGoals && blueprint.subGoals.length > 0) {
    lines.push("## Orchestration Map");
    lines.push(
      "Ada builds this project by bounded context. Each context is one Claude Code session:",
    );
    lines.push("");
    for (const sg of blueprint.subGoals) {
      const deps =
        sg.dependsOn && sg.dependsOn.length > 0
          ? ` <- after: ${sg.dependsOn.join(", ")}`
          : "";
      lines.push(`**${sg.name}**${deps}`);
      lines.push(sg.derivedIntent);
      lines.push("");
    }
    lines.push("## Orchestration Protocol");
    lines.push(
      "When ADA_SUBGOAL env is set, you are in an orchestrated session:",
    );
    lines.push(
      '1. Call `ada.advance_execution("<sessionId>")` to get your component-level task brief',
    );
    lines.push("2. Implement all components in your bounded context");
    lines.push(
      '3. Call `ada.set_task_status("<component>", "complete", [<evidence>])` per component',
    );
    lines.push(
      '4. Call `ada.complete_subgoal("<subGoalName>", [<evidence>])` when ALL components are done',
    );
    lines.push("5. Exit — the Ada orchestrator will spawn the next session");
    lines.push("");
  }

  // 5. Ada MCP — pull context on demand, never push
  lines.push("## Ada MCP");
  lines.push(
    "The MCP server is the spec authority. Pull context on demand — never assume from memory.",
  );
  lines.push("");
  lines.push(
    "**Start of every task:** call `ada.advance_execution(agentId)` — returns your task brief, bounded context contract, and execution instructions.",
  );
  lines.push("");
  lines.push("**Before modifying any entity:**");
  lines.push(
    "- `ada.query_constraints(entityName)` — get invariants and constraints",
  );
  lines.push(
    "- `ada.check_drift(description)` — verify a planned action against original intent",
  );
  lines.push("");
  lines.push("**During execution:**");
  lines.push(
    "- `ada.get_contract(boundedContext)` — read your delegation contract",
  );
  lines.push(
    "- `ada.get_workflow(workflowName)` — get step-by-step workflow with Hoare triples",
  );
  lines.push(
    "- `ada.report_execution_failure(component, description)` — request retry guidance",
  );
  lines.push(
    "- `ada.set_task_status(component, 'complete', [evidence])` — mark complete",
  );
  lines.push("");

  // 6. Compilation health (small, valuable)
  if (blueprint.audit) {
    const a = blueprint.audit;
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    lines.push("## Compilation Health");
    lines.push(
      `**Decision:** ${a.governorDecision}  **Confidence:** ${pct(a.confidence)}  **Gates:** ${pct(a.gatePassRate)}`,
    );
    if (a.violationCount > 0) {
      lines.push(
        `> ${a.violationCount} policy violation(s) — query \`ada.get_world_model("GOV")\` for details`,
      );
    }
    lines.push("");
  }

  // 7. Session protocol
  lines.push("## This Session");
  lines.push(
    "You are the lead agent. Call `ada.advance_execution(agentId)` to get your first task. Follow the execution brief. Verify postconditions before marking complete.",
  );
  lines.push("");

  return frontmatter + lines.join("\n");
}

function topologicalSort(
  components: readonly import("@swm/compiler").BlueprintComponent[],
): import("@swm/compiler").BlueprintComponent[] {
  const byName = new Map(components.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const result: import("@swm/compiler").BlueprintComponent[] = [];

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const comp = byName.get(name);
    if (!comp) return;
    for (const dep of comp.dependencies) {
      visit(dep);
    }
    result.push(comp);
  }

  for (const comp of components) {
    visit(comp.name);
  }

  return result;
}
