import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: string;
  readonly frequency: number; // how many sessions showed this pattern
  readonly sessionIds: readonly string[];
  readonly observedPaths: readonly string[]; // representative file paths from pattern
  readonly suggestedSkillBody: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly proposedAt: number;
  readonly reviewedAt: number | null;
}

export interface SkillProposal {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: string;
  readonly skillBody: string; // full markdown body for SKILL.md
  readonly proposedBy: "extraction" | "human";
  readonly rationale: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly proposedAt: number;
  readonly reviewedAt: number | null;
}

// ─── Session log types ────────────────────────────────────────────────────────

interface LogEntry {
  ts: number;
  session: string;
  tool: string;
  path: string;
}

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

function sessionLogPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "session-log.jsonl");
}

function skillProposalsPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "skill-proposals.json");
}

function skillCandidatesPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "skill-candidates.json");
}

// ─── Session log reader ───────────────────────────────────────────────────────

function readLog(projectDir: string): LogEntry[] {
  try {
    const raw = fs.readFileSync(sessionLogPath(projectDir), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);
  } catch {
    return [];
  }
}

// ─── Pattern extraction ───────────────────────────────────────────────────────

/**
 * Groups log entries by session and extracts "write signatures" —
 * the ordered sequence of directory prefixes that were written.
 */
function extractSessionSignatures(entries: LogEntry[]): Map<string, string[]> {
  const bySession = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (!e.session) continue;
    const existing = bySession.get(e.session) ?? [];
    existing.push(e);
    bySession.set(e.session, existing);
  }

  const signatures = new Map<string, string[]>();
  for (const [sessionId, sessionEntries] of bySession) {
    const writes = sessionEntries
      .filter((e) => ["Write", "Edit", "MultiEdit"].includes(e.tool) && e.path)
      .map((e) => e.path);

    // Extract the top-level directory prefix for each path
    const prefixes = writes.map((p) => {
      const parts = p.split("/").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? p);
    });

    // Deduplicated ordered sequence
    const seen = new Set<string>();
    const sig: string[] = [];
    for (const p of prefixes) {
      if (!seen.has(p)) {
        seen.add(p);
        sig.push(p);
      }
    }

    if (sig.length >= 2) signatures.set(sessionId, sig);
  }

  return signatures;
}

/**
 * Finds patterns that appear in 2+ sessions (same top-level prefix sequence).
 */
function findRepeatedPatterns(
  signatures: Map<string, string[]>,
): Array<{ pattern: string; sessions: string[]; paths: string[] }> {
  // Canonicalize: join the top-2 prefixes as the pattern key
  const patternSessions = new Map<string, string[]>();
  const patternPaths = new Map<string, string[]>();

  for (const [sessionId, sig] of signatures) {
    const key = sig.slice(0, 3).join(" → ");
    const existing = patternSessions.get(key) ?? [];
    existing.push(sessionId);
    patternSessions.set(key, existing);

    const paths = patternPaths.get(key) ?? [];
    paths.push(...sig);
    patternPaths.set(key, paths);
  }

  const repeated: Array<{
    pattern: string;
    sessions: string[];
    paths: string[];
  }> = [];
  for (const [pattern, sessions] of patternSessions) {
    if (sessions.length >= 2) {
      repeated.push({
        pattern,
        sessions,
        paths: [...new Set(patternPaths.get(pattern) ?? [])].slice(0, 8),
      });
    }
  }

  return repeated;
}

/**
 * Converts a detected pattern into a skill candidate with a suggested SKILL.md body.
 */
function patternToCandidate(
  pattern: string,
  sessions: string[],
  paths: string[],
): SkillCandidate {
  const id = `sk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const slug = pattern
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 40);
  const name = `implement-${slug}`;
  const trigger = `Pattern: ${pattern}`;
  const description = `Extracted from ${sessions.length} sessions implementing ${pattern}`;

  const suggestedSkillBody = [
    "---",
    `name: ${name}`,
    `description: "Use when implementing the ${pattern} pattern (extracted from session evidence)."`,
    "---",
    "",
    `# ${name}`,
    "",
    `Trigger: implementation work matching the pattern ${pattern}`,
    "",
    "## Steps",
    "1. **read-contract**",
    `   - Pre: \`ada.get_contract(context) returns a valid contract\``,
    `   - Action: \`read delegation contract, note allowedPathGlobs and stop conditions\``,
    `   - Post: \`contract scope is understood before any file writes\``,
    "",
    "2. **check-drift-before-start**",
    `   - Pre: \`ada.check_drift(description) returns aligned=true\``,
    `   - Action: \`call ada.check_drift with description of what you are about to implement\``,
    `   - Post: \`implementation is aligned with compiled blueprint intent\``,
    "",
    "3. **implement-component**",
    `   - Pre: \`blueprint component for this context is understood via ada.get_blueprint\``,
    `   - Action: \`implement the component following blueprint interfaces and invariants\``,
    `   - Post: \`all declared interfaces are implemented; TypeScript compiles\``,
    "",
    "4. **verify-outcome**",
    `   - Pre: \`implementation files exist\``,
    `   - Action: \`call ada.verify(layer='outcome') to check postcondition coverage\``,
    `   - Post: \`verification score >= 80%; no critical findings\``,
    "",
    "## Evidence observed in sessions",
    ...paths.map((p) => `- ${p}`),
    "",
    "## Human review notes",
    "<!-- Add notes here before approving -->",
    "",
  ].join("\n");

  return {
    id,
    name,
    description,
    trigger,
    frequency: sessions.length,
    sessionIds: sessions,
    observedPaths: paths,
    suggestedSkillBody,
    status: "pending",
    proposedAt: Date.now(),
    reviewedAt: null,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadCandidates(projectDir: string): SkillCandidate[] {
  try {
    const raw = fs.readFileSync(skillCandidatesPath(projectDir), "utf8");
    return JSON.parse(raw) as SkillCandidate[];
  } catch {
    return [];
  }
}

function saveCandidates(
  projectDir: string,
  candidates: SkillCandidate[],
): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    skillCandidatesPath(projectDir),
    JSON.stringify(candidates, null, 2),
    "utf8",
  );
}

export function loadProposals(projectDir: string): SkillProposal[] {
  try {
    const raw = fs.readFileSync(skillProposalsPath(projectDir), "utf8");
    return JSON.parse(raw) as SkillProposal[];
  } catch {
    return [];
  }
}

function saveProposals(projectDir: string, proposals: SkillProposal[]): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    skillProposalsPath(projectDir),
    JSON.stringify(proposals, null, 2),
    "utf8",
  );
}

// ─── MCP tool: ada.extract_skills ────────────────────────────────────────────

export function extractSkills(): { content: string; isError: boolean } {
  const projectDir = getProjectDir();
  const entries = readLog(projectDir);

  if (entries.length === 0) {
    return {
      content:
        "No session log found. Run at least two sessions with tool call activity before extracting skills.\n" +
        `Expected: ${sessionLogPath(projectDir)}`,
      isError: false,
    };
  }

  const signatures = extractSessionSignatures(entries);
  const patterns = findRepeatedPatterns(signatures);

  if (patterns.length === 0) {
    return {
      content:
        `Analyzed ${signatures.size} sessions, ${entries.length} tool calls.\n` +
        "No repeated patterns found yet — patterns require the same sequence to appear in 2+ distinct sessions.\n" +
        "Continue building and re-run after more sessions accumulate.",
      isError: false,
    };
  }

  // Load existing candidates to avoid duplicates
  const existing = loadCandidates(projectDir);
  const existingPatterns = new Set(existing.map((c) => c.trigger));

  const newCandidates: SkillCandidate[] = [];
  for (const { pattern, sessions, paths } of patterns) {
    const trigger = `Pattern: ${pattern}`;
    if (!existingPatterns.has(trigger)) {
      newCandidates.push(patternToCandidate(pattern, sessions, paths));
    }
  }

  const allCandidates = [...existing, ...newCandidates];
  saveCandidates(projectDir, allCandidates);

  const lines = [
    `Skill extraction complete.`,
    `Sessions analyzed: ${signatures.size}`,
    `Tool calls processed: ${entries.length}`,
    `Patterns found: ${patterns.length}`,
    `New candidates: ${newCandidates.length}`,
    `Total candidates: ${allCandidates.length}`,
    "",
  ];

  if (newCandidates.length > 0) {
    lines.push("New skill candidates:");
    for (const c of newCandidates) {
      lines.push(`  [${c.id}] ${c.name}`);
      lines.push(`    Pattern: ${c.trigger}`);
      lines.push(`    Seen in ${c.frequency} sessions`);
    }
    lines.push("");
    lines.push("Review with: ada review-skills");
  } else {
    lines.push(
      "No new patterns — all detected patterns are already candidates.",
    );
  }

  return { content: lines.join("\n"), isError: false };
}

// ─── MCP tool: ada.propose_skill ─────────────────────────────────────────────

export function proposeSkill(
  name: string,
  description: string,
  trigger: string,
  skillBody: string,
  rationale: string,
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();
  const proposals = loadProposals(projectDir);

  const proposal: SkillProposal = {
    id: `sp-${Date.now()}`,
    name,
    description,
    trigger,
    skillBody,
    proposedBy: "human",
    rationale,
    status: "pending",
    proposedAt: Date.now(),
    reviewedAt: null,
  };

  proposals.push(proposal);
  saveProposals(projectDir, proposals);

  return {
    content:
      `Skill proposal queued: ${proposal.id}\n` +
      `Name: ${name}\n` +
      `Trigger: ${trigger}\n` +
      `Rationale: ${rationale}\n\n` +
      `Review with: ada review-skills\n` +
      `Approved skills are written to .claude/skills/${name}/SKILL.md`,
    isError: false,
  };
}

// ─── Skill promotion (called from CLI after human approval) ───────────────────

export function promoteSkill(
  proposal: SkillProposal | SkillCandidate,
  projectDir: string,
): string {
  const body =
    "skillBody" in proposal ? proposal.skillBody : proposal.suggestedSkillBody;
  const slug = proposal.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const skillDir = path.join(projectDir, ".claude", "skills", slug);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, body, "utf8");
  return skillPath;
}
