import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

/**
 * ada.compile — triggers full 9-stage Ada compilation from within Claude Code.
 *
 * This is the entry-point tool. Claude calls this first when given intent.
 * It runs the full Ada pipeline (CTX→INT→PER→ENT→PRO→SYN→VER→GOV→BLD),
 * writes CLAUDE.md + agent files + contracts + world model to the project,
 * and returns a summary of what was compiled.
 *
 * Claude can then immediately call ada.get_macro_plan() to start executing.
 */
export function compileIntent(
  intent: string,
  projectDir: string,
  options: { amend?: boolean; noWebResearch?: boolean },
): { content: string; isError: boolean } {
  if (!intent || intent.trim().length === 0) {
    return { content: "Intent is required.", isError: true };
  }

  // Find the ada CLI binary
  const adaBin = findAdaBin();
  if (!adaBin) {
    return {
      content: "Ada CLI binary not found. Ensure ada is installed and on PATH.",
      isError: true,
    };
  }

  const cwd = projectDir || process.cwd();

  if (!fs.existsSync(cwd)) {
    return { content: `Project directory not found: ${cwd}`, isError: true };
  }

  const flags: string[] = ["--no-execute"];
  if (options.amend) flags.push("--amend");

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.noWebResearch) env["ADA_WEB_RESEARCH"] = "false";

  try {
    const result = execSync(
      `${adaBin} compile ${JSON.stringify(intent)} ${flags.join(" ")}`,
      {
        cwd,
        env,
        timeout: 600_000, // 10 minutes max
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Load the compiled blueprint to summarize
    const stateFile = path.join(cwd, ".ada", "state.json");
    if (!fs.existsSync(stateFile)) {
      return {
        content: result || "Compilation completed but no state file found.",
        isError: false,
      };
    }

    const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<
      string,
      unknown
    >;
    const bp = state["blueprint"] as Record<string, unknown> | undefined;

    if (!bp) {
      return { content: result || "Compilation completed.", isError: false };
    }

    const arch = bp["architecture"] as Record<string, unknown> | undefined;
    const components = (arch?.["components"] as unknown[]) ?? [];
    const audit = bp["audit"] as Record<string, unknown> | undefined;
    const decision =
      audit?.["governorDecision"] ?? state["decision"] ?? "unknown";
    const summary = (bp["summary"] as string) ?? "No summary";

    const lines = [
      `✓ Compilation complete — Governor decision: ${decision}`,
      ``,
      `Summary: ${summary}`,
      ``,
      `Bounded contexts (${components.length}):`,
      ...(components as Array<Record<string, unknown>>).map(
        (c) => `  • ${String(c["name"])} (${String(c["boundedContext"])})`,
      ),
      ``,
      `Confidence: ${audit?.["confidence"] ?? "—"}`,
      `Coverage: ${audit?.["coverageScore"] ?? "—"}`,
      ``,
      `Next steps:`,
      `  1. Call ada.get_macro_plan() to get the ordered execution plan`,
      `  2. Call ada.get_contract("<bounded_context>") before starting each context`,
      `  3. Ada governs your execution — call ada.check_drift() before major decisions`,
    ];

    return { content: lines.join("\n"), isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // execSync throws on non-zero exit; stderr is in the message
    return {
      content: `Compilation failed:\n${msg.slice(0, 2000)}`,
      isError: true,
    };
  }
}

function findAdaBin(): string | null {
  // 1. Check PATH
  try {
    execSync("which ada", { encoding: "utf8", stdio: "pipe" });
    return "ada";
  } catch {
    /* not on PATH */
  }

  // 2. Check common install locations
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "ada"),
    "/usr/local/bin/ada",
    "/opt/homebrew/bin/ada",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 3. Try to find it relative to the mcp-server (dev mode)
  try {
    const devBin = path.resolve(__dirname, "../../../../cli/dist/index.js");
    if (fs.existsSync(devBin)) return `node ${devBin}`;
  } catch {
    /* skip */
  }

  return null;
}
