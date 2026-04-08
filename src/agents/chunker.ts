import { estimateTokens } from "../utils/llm.js";

const MAX_CHUNK_TOKENS = 80_000; // Leave room for system prompt + output
const OVERLAP_CHARS = 500; // Overlap between chunks to preserve context at boundaries

export interface Chunk {
  index: number;
  total: number;
  text: string;
  tokenEstimate: number;
}

/**
 * Split text into chunks that fit within LLM context limits.
 * Splits on paragraph boundaries when possible, with overlap.
 */
export function chunkInput(text: string): Chunk[] {
  const totalTokens = estimateTokens(text);

  if (totalTokens <= MAX_CHUNK_TOKENS) {
    return [{ index: 0, total: 1, text, tokenEstimate: totalTokens }];
  }

  const maxCharsPerChunk = MAX_CHUNK_TOKENS * 4; // reverse of token estimate
  const chunks: Chunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxCharsPerChunk, text.length);

    // Try to split on a paragraph boundary
    if (end < text.length) {
      const searchRegion = text.slice(Math.max(end - 2000, offset), end);
      const lastParagraph = searchRegion.lastIndexOf("\n\n");
      if (lastParagraph > 0) {
        end = Math.max(end - 2000, offset) + lastParagraph + 2;
      } else {
        // Fall back to line boundary
        const lastLine = searchRegion.lastIndexOf("\n");
        if (lastLine > 0) {
          end = Math.max(end - 2000, offset) + lastLine + 1;
        }
      }
    }

    const chunkText = text.slice(offset, end);
    chunks.push({
      index: chunks.length,
      total: 0, // filled in below
      text: chunkText,
      tokenEstimate: estimateTokens(chunkText),
    });

    // Advance with overlap
    offset = end - (end < text.length ? OVERLAP_CHARS : 0);
  }

  // Set total count
  for (const chunk of chunks) {
    chunk.total = chunks.length;
  }

  return chunks;
}
