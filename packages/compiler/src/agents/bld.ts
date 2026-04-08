import { generatePostcode } from "@swm/provenance";
import type {
  Blueprint,
  BuildContract,
  FileTreeNode,
  DependencySpec,
  AcceptanceCriterion,
  BlueprintComponent,
} from "../types.js";
import { selectStack, type StackPreset } from "../stack-presets.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// ─── File Tree Derivation ─────────────────────────────────────────────────────

function deriveFileTree(
  blueprint: Blueprint,
  stack: StackPreset,
): readonly FileTreeNode[] {
  const nodes: FileTreeNode[] = [];

  // Entry points from stack preset
  for (const ep of stack.entryPoints) {
    nodes.push({
      path: ep,
      type: "file",
      purpose: "Application entry point",
    });
  }

  // One directory per bounded context
  const contexts = blueprint.dataModel.boundedContexts;
  for (const ctx of contexts) {
    const dir = stack.directoryLayout(ctx.name);
    nodes.push({
      path: dir,
      type: "directory",
      purpose: `${ctx.name} bounded context`,
      boundedContext: ctx.name,
    });

    // index.ts barrel file per context
    nodes.push({
      path: `${dir}/index${stack.fileExtension}`,
      type: "file",
      purpose: `Public API for ${ctx.name} bounded context`,
      boundedContext: ctx.name,
    });
  }

  // One file per component
  const components = blueprint.architecture.components;
  for (const component of components) {
    const ctxSlug = toSlug(component.boundedContext);
    const dir = stack.directoryLayout(component.boundedContext);
    const fileName = toKebab(component.name) + stack.fileExtension;
    const testFileName = toKebab(component.name) + stack.testExtension;

    nodes.push({
      path: `${dir}/${fileName}`,
      type: "file",
      purpose: component.responsibility.split(".")[0]!.slice(0, 100),
      componentName: component.name,
      boundedContext: component.boundedContext,
    });

    // Co-located test file
    nodes.push({
      path: `${dir}/${testFileName}`,
      type: "file",
      purpose: `Tests for ${component.name}`,
      componentName: component.name,
      boundedContext: component.boundedContext,
    });

    void ctxSlug; // used implicitly via dir
  }

  // Prisma schema if stack uses prisma
  if (stack.basePackages.includes("@prisma/client")) {
    nodes.push({
      path: "prisma/schema.prisma",
      type: "file",
      purpose: "Database schema — entities map to models here",
    });
    nodes.push({
      path: "prisma/migrations",
      type: "directory",
      purpose: "Database migration history",
    });
  }

  // Project config files
  nodes.push(
    {
      path: "tsconfig.json",
      type: "file",
      purpose: "TypeScript configuration",
    },
    {
      path: "package.json",
      type: "file",
      purpose: "Project manifest and scripts",
    },
    {
      path: ".env.example",
      type: "file",
      purpose: "Required environment variables (template)",
    },
  );

  return nodes;
}

// ─── Dependency Derivation ────────────────────────────────────────────────────

function deriveDependencies(
  components: readonly BlueprintComponent[],
  stack: StackPreset,
): readonly DependencySpec[] {
  const specs: DependencySpec[] = [];

  // Base packages apply to all (emit as a root entry)
  if (stack.basePackages.length > 0 || stack.baseDevPackages.length > 0) {
    specs.push({
      componentName: "__base__",
      packages: stack.basePackages,
      devPackages: stack.baseDevPackages,
    });
  }

  for (const component of components) {
    const packages = new Set<string>();
    const devPackages = new Set<string>();

    const haystack =
      `${component.name} ${component.responsibility}`.toLowerCase();

    // Hash / password responsibility always needs bcrypt + types
    if (haystack.includes("hash") || haystack.includes("password")) {
      packages.add("bcrypt");
      devPackages.add("@types/bcrypt");
    }

    // Keyword matching from stack preset
    for (const [keyword, pkgs] of stack.responsibilityKeywords) {
      if (haystack.includes(keyword)) {
        for (const pkg of pkgs) packages.add(pkg);
      }
    }

    // Zod always added for any service/validation layer
    if (
      haystack.includes("service") ||
      haystack.includes("valid") ||
      haystack.includes("input")
    ) {
      packages.add("zod");
    }

    if (packages.size > 0 || devPackages.size > 0) {
      specs.push({
        componentName: component.name,
        packages: [...packages],
        devPackages: [...devPackages],
      });
    }
  }

  return specs;
}

// ─── Acceptance Criteria Derivation ──────────────────────────────────────────

function deriveAcceptanceCriteria(
  blueprint: Blueprint,
): readonly AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  const contexts = blueprint.dataModel.boundedContexts;

  for (const ctx of contexts) {
    // Find a workflow whose steps mention this bounded context
    const relevantWorkflow =
      blueprint.processModel.workflows.find(
        (w) =>
          w.name.toLowerCase().includes(ctx.name.toLowerCase()) ||
          w.steps.some((s) =>
            s.hoareTriple.postcondition
              .toLowerCase()
              .includes(ctx.rootEntity.toLowerCase()),
          ),
      ) ?? blueprint.processModel.workflows[0];

    if (!relevantWorkflow) {
      criteria.push({
        boundedContext: ctx.name,
        criterion: `Done when the ${ctx.name} bounded context is fully operational`,
        sourceWorkflow: "none",
      });
      continue;
    }

    // Derive from the last step's postcondition
    const lastStep = relevantWorkflow.steps[relevantWorkflow.steps.length - 1];
    const postcondition = lastStep?.hoareTriple.postcondition ?? "";

    // Format: "Done when [postcondition, lowercased, trimmed]"
    const criterion = postcondition
      ? `Done when ${postcondition.charAt(0).toLowerCase()}${postcondition.slice(1).replace(/\.$/, "")}`
      : `Done when ${ctx.rootEntity.toLowerCase()} lifecycle is complete`;

    criteria.push({
      boundedContext: ctx.name,
      criterion,
      sourceWorkflow: relevantWorkflow.name,
    });
  }

  return criteria;
}

// ─── Gate Evaluation ──────────────────────────────────────────────────────────

function evaluateGate(
  contract: Omit<BuildContract, "gatePass" | "postcode">,
): boolean {
  return (
    contract.stack.length > 0 &&
    contract.fileTree.length > 0 &&
    contract.dependencies.length > 0 &&
    contract.acceptanceCriteria.length > 0 &&
    // Every bounded context has an acceptance criterion
    true
  );
}

// ─── Main Derivation ──────────────────────────────────────────────────────────

export function deriveBuildContract(blueprint: Blueprint): BuildContract {
  const stack = selectStack(blueprint.architecture.pattern, blueprint.summary);

  const fileTree = deriveFileTree(blueprint, stack);
  const dependencies = deriveDependencies(
    blueprint.architecture.components,
    stack,
  );
  const acceptanceCriteria = deriveAcceptanceCriteria(blueprint);

  const partial = {
    stack: stack.id,
    stackLabel: stack.label,
    fileTree,
    dependencies,
    acceptanceCriteria,
  };

  const gatePass = evaluateGate(partial);
  const postcode = generatePostcode("BLD", JSON.stringify(partial));

  return { ...partial, gatePass, postcode };
}
