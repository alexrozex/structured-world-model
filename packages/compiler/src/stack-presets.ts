// ─── Stack Presets ────────────────────────────────────────────────────────────
// Each preset maps a named tech stack to file conventions, entry points,
// and package responsibility keywords. BLD uses these for deterministic
// file tree and dependency derivation.

export interface StackPreset {
  readonly id: string; // machine identifier
  readonly label: string; // human label, appears in BUILD.md
  readonly patterns: readonly string[]; // keywords in architecture pattern / summary that trigger auto-selection
  readonly fileExtension: string; // default source file extension
  readonly testExtension: string; // test file extension
  readonly entryPoints: readonly string[]; // project-level entry files (relative to root)
  readonly basePackages: readonly string[]; // always present for this stack
  readonly baseDevPackages: readonly string[]; // always dev-present for this stack
  readonly responsibilityKeywords: ReadonlyMap<string, readonly string[]>; // keyword → npm packages
  readonly directoryLayout: (boundedContext: string) => string; // bc name → directory path
}

// ─── Keyword → Package Mappings ───

const webKeywords = new Map<string, readonly string[]>([
  ["hash", ["bcrypt"]],
  ["password", ["bcrypt"]],
  ["session", []],
  ["token", []],
  ["jwt", ["jsonwebtoken"]],
  ["email", ["nodemailer"]],
  ["validate", ["zod"]],
  ["schema", ["zod"]],
  ["repository", ["@prisma/client"]],
  ["database", ["@prisma/client"]],
  ["persist", ["@prisma/client"]],
  ["query", ["@prisma/client"]],
  ["middleware", []],
  ["route", []],
  ["request", []],
  ["response", []],
  ["upload", ["multer"]],
  ["file", ["multer"]],
  ["cache", ["ioredis"]],
  ["queue", ["bullmq"]],
  ["log", ["pino"]],
  ["observ", ["pino"]],
]);

const cliKeywords = new Map<string, readonly string[]>([
  ["parse", ["commander"]],
  ["argument", ["commander"]],
  ["prompt", ["inquirer"]],
  ["interact", ["inquirer"]],
  ["color", ["chalk"]],
  ["output", ["chalk"]],
  ["file", ["fs-extra"]],
  ["read", ["fs-extra"]],
  ["write", ["fs-extra"]],
  ["config", ["conf"]],
  ["log", ["consola"]],
]);

// ─── Presets ───

export const STACK_PRESETS: readonly StackPreset[] = [
  {
    id: "nextjs-prisma-postgres",
    label: "Next.js + Prisma + PostgreSQL",
    patterns: [
      "web",
      "spa",
      "ssr",
      "frontend",
      "fullstack",
      "full-stack",
      "next",
    ],
    fileExtension: ".ts",
    testExtension: ".test.ts",
    entryPoints: [
      "src/app/page.tsx",
      "src/app/layout.tsx",
      "src/app/api/auth/route.ts",
    ],
    basePackages: ["next", "react", "react-dom", "@prisma/client", "zod"],
    baseDevPackages: [
      "typescript",
      "prisma",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "vitest",
      "@vitejs/plugin-react",
    ],
    responsibilityKeywords: webKeywords,
    directoryLayout: (bc) => `src/${bc.toLowerCase().replace(/\s+/g, "-")}`,
  },
  {
    id: "express-prisma-postgres",
    label: "Express + Prisma + PostgreSQL",
    patterns: ["api", "rest", "microservice", "backend", "service"],
    fileExtension: ".ts",
    testExtension: ".test.ts",
    entryPoints: ["src/index.ts", "src/app.ts"],
    basePackages: ["express", "@prisma/client", "zod", "cors", "helmet"],
    baseDevPackages: [
      "typescript",
      "prisma",
      "@types/node",
      "@types/express",
      "@types/cors",
      "vitest",
      "tsx",
    ],
    responsibilityKeywords: webKeywords,
    directoryLayout: (bc) => `src/${bc.toLowerCase().replace(/\s+/g, "-")}`,
  },
  {
    id: "cli-node",
    label: "Node.js CLI",
    patterns: ["cli", "command", "terminal", "tool", "script"],
    fileExtension: ".ts",
    testExtension: ".test.ts",
    entryPoints: ["src/index.ts", "src/cli.ts"],
    basePackages: ["commander", "chalk"],
    baseDevPackages: ["typescript", "@types/node", "vitest", "tsx"],
    responsibilityKeywords: cliKeywords,
    directoryLayout: (bc) => `src/${bc.toLowerCase().replace(/\s+/g, "-")}`,
  },
  {
    id: "library-ts",
    label: "TypeScript Library",
    patterns: ["library", "package", "sdk", "module", "utility"],
    fileExtension: ".ts",
    testExtension: ".test.ts",
    entryPoints: ["src/index.ts"],
    basePackages: [],
    baseDevPackages: ["typescript", "@types/node", "vitest", "tsup"],
    responsibilityKeywords: new Map(),
    directoryLayout: (bc) => `src/${bc.toLowerCase().replace(/\s+/g, "-")}`,
  },
];

export const DEFAULT_STACK = STACK_PRESETS[0]!;

export function selectStack(
  architecturePattern: string,
  summary: string,
): StackPreset {
  const haystack = `${architecturePattern} ${summary}`.toLowerCase();
  for (const preset of STACK_PRESETS) {
    if (preset.patterns.some((p) => haystack.includes(p))) {
      return preset;
    }
  }
  return DEFAULT_STACK;
}
