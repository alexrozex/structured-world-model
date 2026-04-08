import * as fs from "node:fs";
import * as path from "node:path";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: "interface" | "type" | "class" | "function" | "const" | "enum";
  readonly filePath: string;
  readonly line: number;
  readonly body: string;
}

export interface CodebaseSnapshot {
  readonly symbols: readonly CodeSymbol[];
  readonly fileIndex: ReadonlyMap<string, string>;
}

function walkTs(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".ada"
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    } else if (entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function extractSymbols(source: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Exported interfaces
    const ifaceMatch = line.match(/^export\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      const body = extractBlock(lines, i);
      symbols.push({
        name: ifaceMatch[1]!,
        kind: "interface",
        filePath,
        line: i + 1,
        body,
      });
      continue;
    }

    // Exported types
    const typeMatch = line.match(/^export\s+type\s+(\w+)/);
    if (typeMatch) {
      symbols.push({
        name: typeMatch[1]!,
        kind: "type",
        filePath,
        line: i + 1,
        body: line,
      });
      continue;
    }

    // Exported classes
    const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      const body = extractBlock(lines, i);
      symbols.push({
        name: classMatch[1]!,
        kind: "class",
        filePath,
        line: i + 1,
        body,
      });
      continue;
    }

    // Exported functions
    const funcMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      const body = extractBlock(lines, i);
      symbols.push({
        name: funcMatch[1]!,
        kind: "function",
        filePath,
        line: i + 1,
        body,
      });
      continue;
    }

    // Exported consts
    const constMatch = line.match(/^export\s+const\s+(\w+)/);
    if (constMatch) {
      symbols.push({
        name: constMatch[1]!,
        kind: "const",
        filePath,
        line: i + 1,
        body: line,
      });
      continue;
    }

    // Exported enums
    const enumMatch = line.match(/^export\s+enum\s+(\w+)/);
    if (enumMatch) {
      const body = extractBlock(lines, i);
      symbols.push({
        name: enumMatch[1]!,
        kind: "enum",
        filePath,
        line: i + 1,
        body,
      });
      continue;
    }
  }

  return symbols;
}

function extractBlock(lines: string[], startIdx: number): string {
  let depth = 0;
  let started = false;
  const blockLines: string[] = [];

  for (let i = startIdx; i < lines.length && i < startIdx + 200; i++) {
    const line = lines[i]!;
    blockLines.push(line);

    for (const ch of line) {
      if (ch === "{") {
        depth++;
        started = true;
      }
      if (ch === "}") depth--;
    }

    if (started && depth <= 0) break;
  }

  return blockLines.join("\n");
}

export function scanCodebase(projectRoot: string): CodebaseSnapshot {
  const allFiles = walkTs(projectRoot);
  const symbols: CodeSymbol[] = [];
  const fileIndex = new Map<string, string>();

  for (const filePath of allFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relPath = path.relative(projectRoot, filePath);
    fileIndex.set(relPath, source);
    symbols.push(...extractSymbols(source, relPath));
  }

  return { symbols, fileIndex };
}

export function findSymbolByName(
  snapshot: CodebaseSnapshot,
  name: string,
): CodeSymbol | null {
  // Exact match first
  const exact = snapshot.symbols.find((s) => s.name === name);
  if (exact) return exact;

  // Case-insensitive fallback
  const lower = name.toLowerCase();
  return snapshot.symbols.find((s) => s.name.toLowerCase() === lower) ?? null;
}

export function searchInFiles(
  snapshot: CodebaseSnapshot,
  pattern: string,
): Array<{ filePath: string; line: number; content: string }> {
  const results: Array<{ filePath: string; line: number; content: string }> =
    [];
  const re = new RegExp(pattern, "gi");

  for (const [filePath, source] of snapshot.fileIndex) {
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        results.push({ filePath, line: i + 1, content: lines[i]! });
        re.lastIndex = 0;
      }
    }
  }

  return results;
}
