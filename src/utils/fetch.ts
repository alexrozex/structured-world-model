/**
 * Fetch text content from a URL. Strips HTML tags for cleaner extraction.
 */
export async function fetchUrl(
  url: string,
): Promise<{ text: string; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SWM/0.1.0 (Structured World Model)",
      Accept: "text/html,text/plain,application/json,*/*",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "text/plain";
  const raw = await response.text();

  // Strip HTML tags if it's an HTML page — keep text content for extraction
  if (contentType.includes("html")) {
    return { text: stripHtml(raw), contentType };
  }

  return { text: raw, contentType };
}

function stripHtml(html: string): string {
  return (
    html
      // Remove script and style blocks entirely
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      // Replace common block elements with newlines
      .replace(
        /<\/?(p|div|br|h[1-6]|li|tr|td|th|blockquote|pre|hr)[^>]*>/gi,
        "\n",
      )
      // Remove all remaining tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim()
  );
}

export function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}
