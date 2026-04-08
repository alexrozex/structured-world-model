import Anthropic from "@anthropic-ai/sdk";

/**
 * ada.research — on-demand web discovery for Claude Code agents.
 *
 * Runs a targeted web search and returns structured findings.
 * Claude calls this when it encounters something it's uncertain about
 * mid-execution: unfamiliar APIs, security patterns, library versions, etc.
 */
export async function researchTopic(
  query: string,
  focus?: string,
): Promise<{ content: string; isError: boolean }> {
  if (!query || query.trim().length === 0) {
    return { content: "Query is required.", isError: true };
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return {
      content: "ANTHROPIC_API_KEY not set — web research unavailable.",
      isError: true,
    };
  }

  if (process.env["ADA_WEB_RESEARCH"] === "false") {
    return {
      content: "Web research is disabled (ADA_WEB_RESEARCH=false).",
      isError: true,
    };
  }

  try {
    const client = new Anthropic({ apiKey });

    const focusLine = focus ? `\nFocus specifically on: ${focus}` : "";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Research this question for a software engineering task:

QUERY: ${query.slice(0, 500)}${focusLine}

Provide:
1. Direct answer (current best practice / correct approach)
2. Key library/API names and current versions if relevant
3. Any critical gotchas or recent changes to be aware of
4. One concrete example if helpful

Be concise and specific. This is injected directly into an active coding session.`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? String(b.text) : ""))
      .join("\n")
      .trim();

    if (!text) {
      return { content: "No results returned.", isError: true };
    }

    return { content: text, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Research failed: ${msg}`, isError: true };
  }
}
