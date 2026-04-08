import * as fs from "node:fs";
import * as path from "node:path";
import type { DelegationContract, DelegationFrame } from "@swm/compiler";

// ─── Paths ────────────────────────────────────────────────────────────────────

function getProjectDir(): string {
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"]!)
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

function contractsDir(projectDir: string): string {
  return path.join(projectDir, ".claude", "contracts");
}

function delegationStackPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "delegation-stack.json");
}

// ─── Stack helpers ────────────────────────────────────────────────────────────

function loadStack(projectDir: string): DelegationFrame[] {
  try {
    const raw = fs.readFileSync(delegationStackPath(projectDir), "utf8");
    return JSON.parse(raw) as DelegationFrame[];
  } catch {
    return [];
  }
}

function saveStack(projectDir: string, stack: DelegationFrame[]): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    delegationStackPath(projectDir),
    JSON.stringify(stack, null, 2),
    "utf8",
  );
}

// ─── Contract reader ─────────────────────────────────────────────────────────

function loadContract(
  projectDir: string,
  context: string,
): DelegationContract | null {
  const slug = context.toLowerCase().replace(/\s+/g, "-");
  const contractPath = path.join(contractsDir(projectDir), `${slug}.json`);
  try {
    const raw = fs.readFileSync(contractPath, "utf8");
    return JSON.parse(raw) as DelegationContract;
  } catch {
    return null;
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export function getContract(context: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();
  const contract = loadContract(projectDir, context);

  if (!contract) {
    // List available contracts to help the caller
    let available: string[] = [];
    try {
      available = fs
        .readdirSync(contractsDir(projectDir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
    } catch {
      // dir doesn't exist yet
    }
    return {
      content:
        `No contract found for context: "${context}"\n` +
        `Available: ${available.length > 0 ? available.join(", ") : "none — run 'ada compile' first"}`,
      isError: true,
    };
  }

  const stack = loadStack(projectDir);
  const currentDepth = stack.length; // depth = number of active frames

  const lines = [
    `Contract: ${contract.context}`,
    `Component: ${contract.componentName}`,
    `Max recursion depth: ${contract.maxRecursionDepth}`,
    `Current delegation depth: ${currentDepth}`,
    `Can spawn child agents: ${currentDepth < contract.maxRecursionDepth ? "YES" : "NO — at max depth, must report up"}`,
    "",
    "Scope:",
    `  Bounded context: ${contract.scope.boundedContext}`,
    `  Allowed paths: ${contract.scope.allowedPathGlobs.join(", ")}`,
    `  Allowed tools: ${contract.scope.allowedTools.join(", ")}`,
    "",
    "Stop conditions (escalate to macro planner when any apply):",
    ...contract.stopConditions.map((s) => `  - ${s}`),
    "",
    "Required evidence before returning:",
    ...contract.requiredEvidence.map((e) => `  - ${e}`),
    "",
    "Reporting cadence:",
    `  ${contract.reportingCadence}`,
    "",
    JSON.stringify(contract, null, 2),
  ];

  return { content: lines.join("\n"), isError: false };
}

export function enterDelegation(
  context: string,
  agentId: string,
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();
  const contract = loadContract(projectDir, context);
  const stack = loadStack(projectDir);
  const currentDepth = stack.length;

  if (contract && currentDepth >= contract.maxRecursionDepth) {
    return {
      content:
        `Delegation refused: max recursion depth (${contract.maxRecursionDepth}) reached for context "${context}".\n` +
        `Current depth: ${currentDepth}. Report results up to the macro planner instead of spawning further.`,
      isError: true,
    };
  }

  const frame: DelegationFrame = {
    agentId,
    context,
    enteredAt: Date.now(),
    depth: currentDepth,
  };

  stack.push(frame);
  saveStack(projectDir, stack);

  const contractInfo = contract
    ? `\nContract loaded for "${context}". Max depth: ${contract.maxRecursionDepth}. Current depth: ${currentDepth}.`
    : `\nNo compiled contract for "${context}" — proceeding without scope enforcement.`;

  return {
    content: `Delegation entered: ${agentId} → ${context} (depth ${currentDepth})${contractInfo}`,
    isError: false,
  };
}

export function exitDelegation(agentId: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();
  const stack = loadStack(projectDir);
  let idx = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.agentId === agentId) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    return {
      content: `Agent "${agentId}" not found in delegation stack. Stack: ${JSON.stringify(stack.map((f) => f.agentId))}`,
      isError: true,
    };
  }

  const frame = stack[idx]!;
  const remaining = stack.filter((_, i) => i !== idx);
  saveStack(projectDir, remaining);

  return {
    content: `Delegation exited: ${agentId} ← ${frame.context} (was depth ${frame.depth}). Stack depth now: ${remaining.length}.`,
    isError: false,
  };
}
