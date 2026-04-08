import * as fs from "node:fs";
import * as path from "node:path";

export function proposeAgent(
  name: string,
  description: string,
  tools: readonly string[],
  trigger: string
): { content: string; isError: boolean } {
  const statePath = process.env["ADA_STATE_PATH"];
  if (!statePath) {
    return { content: "ADA_STATE_PATH not set.", isError: true };
  }

  const repoRoot = process.env["ADA_REPO_ROOT"] ?? path.dirname(path.dirname(statePath));
  const agentDir = path.join(repoRoot, ".claude", "agents");
  const fileName = `${name}.md`;
  const agentPath = path.join(agentDir, fileName);

  const body = `---
name: ${name}
description: ${description}
model: claude-sonnet-4-6
tools: [${tools.join(", ")}]
status: GHOST
---

# ${name}

${description}

Trigger: ${trigger}
`;

  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(agentPath, body, "utf8");
    return {
      content: JSON.stringify({ name, description, tools, path: agentPath }),
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to write agent: ${message}`, isError: true };
  }
}
