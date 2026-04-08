import * as fs from "node:fs";
import * as path from "node:path";
import type { Blueprint, GovernorDecision, DomainContext } from "@swm/compiler";
import { generatePostcode } from "@swm/provenance";
import { blueprintToCLAUDEMD } from "./claude-md.js";
import { componentsToAgents } from "./agents.js";
import { workflowsToSkills } from "./skills.js";
import { invariantsToHooks } from "./hooks.js";
import { buildSettings } from "./settings.js";
import { blueprintToContracts } from "./contracts.js";
import { buildContractToBuildMD } from "./build-md.js";
import { buildWorldModel, renderWorldModelMd } from "./world-model.js";
import type { ConfigGraph } from "./types.js";

export interface WriteConfigOptions {
  readonly partial?: boolean;
  readonly warnings?: string[];
  readonly domainContext?: DomainContext;
}

export function writeConfigGraph(
  blueprint: Blueprint,
  governorDecision: GovernorDecision,
  targetDir: string,
  options?: WriteConfigOptions,
): ConfigGraph {
  if (governorDecision.decision !== "ACCEPT" && !options?.partial) {
    throw new Error(
      `Cannot write config graph: Governor decision is ${governorDecision.decision}, not ACCEPT`,
    );
  }

  const writtenAgents: string[] = [];
  const writtenSkills: string[] = [];
  const writtenHooks: string[] = [];

  // 1. CLAUDE.md
  const claudeMdContent = blueprintToCLAUDEMD(
    blueprint,
    options?.warnings,
    options?.domainContext,
  );
  const claudeMdPath = path.join(targetDir, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, claudeMdContent, "utf8");

  // 1b. BUILD.md — only present when BLD stage ran (GOV ACCEPT)
  let buildMdPath: string | null = null;
  if (blueprint.build) {
    const buildMdContent = buildContractToBuildMD(blueprint.build);
    buildMdPath = path.join(targetDir, "BUILD.md");
    fs.writeFileSync(buildMdPath, buildMdContent, "utf8");
  }

  // 2. Agent .md files
  const agents = componentsToAgents(blueprint, options?.domainContext);
  for (const agent of agents) {
    const agentPath = path.join(targetDir, agent.path);
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });
    fs.writeFileSync(agentPath, agent.body, "utf8");
    writtenAgents.push(agentPath);
  }

  // 3. Skill files
  const skills = workflowsToSkills(blueprint.processModel);
  for (const skill of skills) {
    const skillPath = path.join(targetDir, skill.path);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, skill.body, "utf8");
    writtenSkills.push(skillPath);
  }

  // 4. Hook scripts
  const hooks = invariantsToHooks(blueprint.dataModel);
  for (const hook of hooks) {
    const hookPath = path.join(targetDir, hook.path);
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, hook.script, { encoding: "utf8", mode: 0o755 });
    writtenHooks.push(hookPath);
  }

  // 4b. Feedback loop hooks — audit, compact checkpoint, session end
  const feedbackHooks: Array<{ file: string; content: string }> = [
    {
      file: "hooks/post-tool-audit.sh",
      content: [
        "#!/bin/bash",
        "INPUT=$(cat)",
        'TOOL_NAME=$(echo "$INPUT" | jq -r \'.tool_name // "unknown"\' 2>/dev/null || echo "unknown")',
        'SESSION_ID=$(echo "$INPUT" | jq -r \'.session_id // ""\' 2>/dev/null || echo "")',
        'PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${ADA_PROJECT_DIR:-$(pwd)}}"',
        'LOG_FILE="$PROJECT_DIR/.ada/session-log.jsonl"',
        'mkdir -p "$PROJECT_DIR/.ada"',
        'case "$TOOL_NAME" in',
        '  Write|Edit|MultiEdit) PATH_HINT=$(echo "$INPUT" | jq -r \'.tool_input.file_path // .tool_input.path // ""\' 2>/dev/null || echo "") ;;',
        '  Bash) PATH_HINT=$(echo "$INPUT" | jq -r \'.tool_input.command // ""\' 2>/dev/null | cut -c1-80 || echo "") ;;',
        '  Read) PATH_HINT=$(echo "$INPUT" | jq -r \'.tool_input.file_path // ""\' 2>/dev/null || echo "") ;;',
        '  *) PATH_HINT="" ;;',
        "esac",
        "TS=$(date +%s)",
        'printf \'{"ts":%d,"session":"%s","tool":"%s","path":"%s"}\\n\' "$TS" "$SESSION_ID" "$TOOL_NAME" "$PATH_HINT" >> "$LOG_FILE"',
        "exit 0",
      ].join("\n"),
    },
    {
      file: "hooks/pre-compact.sh",
      content: [
        "#!/bin/bash",
        'PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${ADA_PROJECT_DIR:-$(pwd)}}"',
        'MANIFEST="$PROJECT_DIR/.ada/manifest.json"',
        'SESSION_LOG="$PROJECT_DIR/.ada/session-log.jsonl"',
        'INTENT=""',
        'RUN_ID=""',
        'if [ -f "$MANIFEST" ]; then',
        '  INTENT=$(jq -r \'.intent // ""\' "$MANIFEST" 2>/dev/null | cut -c1-120)',
        '  RUN_ID=$(jq -r \'.runId // ""\' "$MANIFEST" 2>/dev/null)',
        "fi",
        'LAST_TOOL=""',
        'if [ -f "$SESSION_LOG" ]; then',
        '  LAST_TOOL=$(tail -1 "$SESSION_LOG" 2>/dev/null | jq -r \'"\\(.tool) \\(.path)"\' 2>/dev/null || echo "")',
        "fi",
        'echo "ADA CHECKPOINT — preserve this across compaction."',
        'echo "Active run: ${RUN_ID:-none}"',
        'echo "Original intent: ${INTENT:-unknown}"',
        '[ -n "$LAST_TOOL" ] && echo "Last tool call: $LAST_TOOL"',
        'echo "After compaction: re-read CLAUDE.md and all .claude/agents/ files."',
        "exit 0",
      ].join("\n"),
    },
    {
      file: "hooks/session-end.sh",
      content: [
        "#!/bin/bash",
        "INPUT=$(cat)",
        'SESSION_ID=$(echo "$INPUT" | jq -r \'.session_id // "unknown"\' 2>/dev/null || echo "unknown")',
        'END_REASON=$(echo "$INPUT" | jq -r \'.end_reason // "unknown"\' 2>/dev/null || echo "unknown")',
        'PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${ADA_PROJECT_DIR:-$(pwd)}}"',
        'SESSIONS_DIR="$PROJECT_DIR/.ada/sessions"',
        'mkdir -p "$SESSIONS_DIR"',
        "TS=$(date +%s)",
        'cat > "$SESSIONS_DIR/${SESSION_ID}.json" <<EOF',
        '{"sessionId":"$SESSION_ID","endReason":"$END_REASON","completedAt":$TS}',
        "EOF",
        "exit 0",
      ].join("\n"),
    },
  ];
  for (const fh of feedbackHooks) {
    const fhPath = path.join(targetDir, fh.file);
    fs.mkdirSync(path.dirname(fhPath), { recursive: true });
    fs.writeFileSync(fhPath, fh.content, { encoding: "utf8", mode: 0o755 });
  }

  // 4d. Session-start hook (referenced by settings.json SessionStart entry)
  const projectLabel = blueprint.summary.split(".")[0]!.slice(0, 80);
  const sessionStartScript = [
    "#!/bin/bash",
    "# Ada session start — world model reference",
    `echo '  Ada: ${projectLabel}'`,
    "echo '  World model : .ada/manifest.json'",
    "echo '  Constraints : ada.query_constraints(scope)'",
    "echo '  Drift check : ada.check_drift(description)'",
    "echo ''",
  ].join("\n");
  const sessionStartPath = path.join(targetDir, "hooks", "session-start.sh");
  fs.mkdirSync(path.dirname(sessionStartPath), { recursive: true });
  fs.writeFileSync(sessionStartPath, sessionStartScript, {
    encoding: "utf8",
    mode: 0o755,
  });

  // 5. Delegation contracts — .claude/contracts/{context}.json
  const contractFiles = blueprintToContracts(blueprint);
  const writtenContracts: string[] = [];
  for (const cf of contractFiles) {
    const cfPath = path.join(targetDir, cf.path);
    fs.mkdirSync(path.dirname(cfPath), { recursive: true });
    fs.writeFileSync(cfPath, JSON.stringify(cf.contract, null, 2), "utf8");
    writtenContracts.push(cfPath);
  }

  // 6. settings.json
  const settings = buildSettings(hooks);
  const settingsPath = path.join(targetDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");

  // 6. .mcp.json — canonical per-project MCP server config (version-controlled)
  const mcpConfig = {
    mcpServers: {
      ada: {
        type: "stdio",
        command: "ada",
        args: ["mcp"],
        env: { ADA_PROJECT_DIR: "${CLAUDE_PROJECT_DIR:-}" },
      },
    },
  };
  const mcpJsonPath = path.join(targetDir, ".mcp.json");
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), "utf8");

  const postcode = generatePostcode("CFG", JSON.stringify(blueprint.postcode));

  // 7. World model graph — built after all other artifacts are written
  const partialConfigGraph: ConfigGraph = {
    claudeMd: claudeMdPath,
    buildMd: buildMdPath,
    agents: writtenAgents,
    skills: writtenSkills,
    hooks: writtenHooks,
    settings: settingsPath,
    mcpJson: mcpJsonPath,
    contracts: writtenContracts,
    postcode,
    worldModelJson: "", // placeholder — filled below
    worldModelMd: "",
  };

  const worldModel = buildWorldModel(blueprint, partialConfigGraph);
  const worldModelJson = JSON.stringify(worldModel, null, 2);
  const worldModelMdContent = renderWorldModelMd(worldModel);

  const worldModelJsonPath = path.join(targetDir, ".ada", "world-model.json");
  const worldModelMdPath = path.join(targetDir, "WORLD-MODEL.md");
  fs.mkdirSync(path.dirname(worldModelJsonPath), { recursive: true });
  fs.writeFileSync(worldModelJsonPath, worldModelJson, "utf8");
  fs.writeFileSync(worldModelMdPath, worldModelMdContent, "utf8");

  return {
    ...partialConfigGraph,
    worldModelJson: worldModelJsonPath,
    worldModelMd: worldModelMdPath,
  };
}
