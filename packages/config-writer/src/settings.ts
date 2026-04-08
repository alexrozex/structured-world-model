import type { HookScript } from "./types.js";

interface HookEntry {
  readonly type: "command";
  readonly command: string;
}

interface MatcherEntry {
  readonly matcher: string;
  readonly hooks: readonly HookEntry[];
}

interface McpServerEntry {
  readonly type: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
}

interface Settings {
  readonly hooks: {
    readonly PreToolUse: readonly MatcherEntry[];
    readonly PostToolUse: readonly MatcherEntry[];
    readonly PreCompact: readonly { readonly hooks: readonly HookEntry[] }[];
    readonly SessionStart: readonly { readonly hooks: readonly HookEntry[] }[];
    readonly SessionEnd: readonly { readonly hooks: readonly HookEntry[] }[];
  };
  readonly mcpServers: Record<string, McpServerEntry>;
  readonly permissions: {
    readonly allow: readonly string[];
  };
  readonly env: Record<string, string>;
  readonly model: string;
}

export function buildSettings(hooks: readonly HookScript[]): Settings {
  const preToolByMatcher = new Map<string, HookEntry[]>();
  const postToolByMatcher = new Map<string, HookEntry[]>();

  for (const hook of hooks) {
    const entry: HookEntry = { type: "command", command: hook.path };
    if (hook.type === "pre-tool") {
      const existing = preToolByMatcher.get(hook.matcher) ?? [];
      existing.push(entry);
      preToolByMatcher.set(hook.matcher, existing);
    } else {
      const existing = postToolByMatcher.get(hook.matcher) ?? [];
      existing.push(entry);
      postToolByMatcher.set(hook.matcher, existing);
    }
  }

  const preToolUse: MatcherEntry[] = [];
  for (const [matcher, entries] of preToolByMatcher) {
    preToolUse.push({ matcher, hooks: entries });
  }

  const postToolUse: MatcherEntry[] = [];
  for (const [matcher, entries] of postToolByMatcher) {
    postToolUse.push({ matcher, hooks: entries });
  }

  return {
    hooks: {
      PreToolUse: preToolUse,
      PostToolUse: [
        ...postToolUse,
        {
          matcher: "Bash|Edit|Write|Read|MultiEdit",
          hooks: [{ type: "command", command: "hooks/post-tool-audit.sh" }],
        },
      ],
      PreCompact: [
        { hooks: [{ type: "command", command: "hooks/pre-compact.sh" }] },
      ],
      SessionStart: [
        { hooks: [{ type: "command", command: "hooks/session-start.sh" }] },
      ],
      SessionEnd: [
        { hooks: [{ type: "command", command: "hooks/session-end.sh" }] },
      ],
    },
    mcpServers: {
      ada: {
        type: "stdio",
        command: "ada",
        args: ["mcp"],
        env: { ADA_PROJECT_DIR: "${CLAUDE_PROJECT_DIR:-}" },
      },
    },
    permissions: {
      allow: [
        "Bash(pnpm *)",
        "Bash(tsc *)",
        "Bash(node *)",
        "Bash(git status)",
        "Bash(git diff *)",
        "Bash(git log *)",
        "mcp__ada__*",
      ],
    },
    env: {
      ADA_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}",
    },
    model: "claude-sonnet-4-6",
  };
}
