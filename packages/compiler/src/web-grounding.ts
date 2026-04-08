import Anthropic from "@anthropic-ai/sdk";

export interface DiscoveryContext {
  /** Current libraries, frameworks, tools for this domain */
  readonly currentEcosystem: string;
  /** Recent API changes, deprecations, new versions (last 6-12 months) */
  readonly recentChanges: string;
  /** Security considerations, CVEs, known vulnerabilities */
  readonly securityNotes: string;
  /** Production examples, comparable implementations */
  readonly comparableImplementations: string;
  /** Architecture patterns recommended for this domain */
  readonly recommendedPatterns: string;
  /** Raw research summary for injection into prompts */
  readonly summary: string;
}

const EMPTY_DISCOVERY: DiscoveryContext = {
  currentEcosystem: "",
  recentChanges: "",
  securityNotes: "",
  comparableImplementations: "",
  recommendedPatterns: "",
  summary: "",
};

/**
 * Runs 3 targeted discovery searches for the given intent.
 * Returns structured DiscoveryContext injected into INT and SYN stages.
 *
 * Enabled by default when ANTHROPIC_API_KEY is set.
 * Disable with ADA_WEB_RESEARCH=false.
 */
export async function discoverContext(
  rawIntent: string,
): Promise<DiscoveryContext> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return EMPTY_DISCOVERY;
  if (process.env["ADA_WEB_RESEARCH"] === "false") return EMPTY_DISCOVERY;

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
      messages: [
        {
          role: "user",
          content: buildDiscoveryPrompt(rawIntent),
        },
      ],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();

    if (!text) return EMPTY_DISCOVERY;

    return parseDiscoveryResponse(text, rawIntent);
  } catch {
    // Never crash the pipeline — discovery is best-effort
    return EMPTY_DISCOVERY;
  }
}

function buildDiscoveryPrompt(intent: string): string {
  const truncated = intent.slice(0, 600);
  return `You are the discovery phase of a semantic compiler. Given this software intent, research the current state of the art.

INTENT: "${truncated}"

Run web searches to answer ALL of these — use multiple searches if needed:

1. ECOSYSTEM: What are the current standard libraries, frameworks, and tools for this domain in 2025? What versions? Any major players changed?

2. RECENT CHANGES: What has changed in the last 12 months that a developer would need to know? Breaking changes, deprecated APIs, new capabilities?

3. SECURITY: What are the current security best practices and known vulnerabilities for this domain? Any CVEs or patterns to avoid?

4. COMPARABLE: What existing open-source implementations or production systems solve similar problems? What patterns do they use?

5. PATTERNS: What architectural patterns are recommended for this domain right now? What works at scale?

Structure your response EXACTLY like this:

ECOSYSTEM:
[2-4 sentences about current tools/libraries/versions]

RECENT_CHANGES:
[2-3 sentences about what changed in last 12 months]

SECURITY:
[2-3 sentences about current security considerations]

COMPARABLE:
[2-3 sentences about existing implementations]

PATTERNS:
[2-3 sentences about recommended architecture patterns]

Be specific. Name real libraries with real versions. This feeds directly into a compilation pipeline — vague answers waste tokens.`;
}

function parseDiscoveryResponse(
  text: string,
  intent: string,
): DiscoveryContext {
  const extract = (label: string): string => {
    const re = new RegExp(`${label}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, "i");
    const match = text.match(re);
    return match?.[1]?.trim() ?? "";
  };

  const ecosystem = extract("ECOSYSTEM");
  const recentChanges = extract("RECENT_CHANGES");
  const securityNotes = extract("SECURITY");
  const comparableImplementations = extract("COMPARABLE");
  const recommendedPatterns = extract("PATTERNS");

  const parts = [
    ecosystem && `Current ecosystem: ${ecosystem}`,
    recentChanges && `Recent changes: ${recentChanges}`,
    securityNotes && `Security: ${securityNotes}`,
    comparableImplementations &&
      `Comparable systems: ${comparableImplementations}`,
    recommendedPatterns && `Recommended patterns: ${recommendedPatterns}`,
  ].filter(Boolean);

  const summary =
    parts.length > 0
      ? `\n\n--- WEB DISCOVERY (current state of the art for: ${intent.slice(0, 100)}) ---\n${parts.join("\n\n")}\n--- END WEB DISCOVERY ---`
      : "";

  return {
    currentEcosystem: ecosystem,
    recentChanges,
    securityNotes,
    comparableImplementations,
    recommendedPatterns,
    summary,
  };
}

/**
 * Legacy compatibility — still works as a drop-in for the existing call site.
 * Returns the summary string (empty string if discovery is disabled).
 */
export async function groundIntent(rawIntent: string): Promise<string> {
  const ctx = await discoverContext(rawIntent);
  return ctx.summary;
}
