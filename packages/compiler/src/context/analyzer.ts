import * as fs from "node:fs";
import * as path from "node:path";
import { generatePostcode } from "@swm/provenance";
import type {
  CodebaseContext,
  TypeRegistryEntry,
  TypeField,
  ConstantEntry,
  PackageBoundary,
} from "./types.js";

// Directory names that are always excluded when walking TypeScript source files.
// These prevent scanning of build artifacts, VCS data, and Ada's own generated
// context directories from contaminating a target project's type registry.
const DEFAULT_EXCLUDE_NAMES = new Set([
  "node_modules",
  "dist",
  ".ada",
  ".git",
  ".claude",
  ".next",
  ".turbo",
  ".svelte-kit",
  "coverage",
  "__pycache__",
]);

export function walkTs(
  dir: string,
  excludeNames: Set<string> = DEFAULT_EXCLUDE_NAMES,
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeNames.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full, excludeNames));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

// Finds Ada's own install root by walking up from the executing binary.
// Returns null if Ada can't identify itself (e.g. in test environments).
function findAdaInstallRoot(): string | null {
  try {
    const exePath = process.argv[1];
    if (!exePath) return null;
    let dir = path.resolve(path.dirname(exePath));
    for (let i = 0; i < 8; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
            string,
            unknown
          >;
          if (pkg["name"] === "ada") return dir;
        } catch {
          /* skip malformed */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* skip */
  }
  return null;
}

function extractTypes(
  source: string,
  sourcePath: string,
  sourcePackage: string,
): TypeRegistryEntry[] {
  const entries: TypeRegistryEntry[] = [];

  // Match exported interfaces with their field blocks
  const interfaceRe =
    /export\s+interface\s+(\w+)(?:\s+extends\s+\w+(?:\s*,\s*\w+)*)?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRe.exec(source)) !== null) {
    const name = match[1]!;
    const body = match[2]!;
    const fields = extractFields(body);
    entries.push({
      name,
      kind: "interface",
      fields,
      sourcePackage,
      sourcePath,
    });
  }

  // Match exported type aliases (no field extraction for aliases)
  const typeRe = /export\s+type\s+(\w+)\s*=/g;
  while ((match = typeRe.exec(source)) !== null) {
    const name = match[1]!;
    entries.push({ name, kind: "type", fields: [], sourcePackage, sourcePath });
  }

  return entries;
}

function extractFields(body: string): TypeField[] {
  const fields: TypeField[] = [];
  const fieldRe = /readonly\s+(\w+)\s*[?]?\s*:\s*([^;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(body)) !== null) {
    fields.push({ name: match[1]!, type: match[2]!.trim() });
  }
  return fields;
}

function extractClasses(source: string): string[] {
  const names: string[] = [];
  // export class X / export abstract class X
  const classRe = /export\s+(?:abstract\s+)?class\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = classRe.exec(source)) !== null) {
    names.push(match[1]!);
  }
  // export function X / export async function X
  const funcRe = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcRe.exec(source)) !== null) {
    names.push(match[1]!);
  }
  return names;
}

function extractConstants(
  source: string,
  sourcePath: string,
  sourcePackage: string,
): ConstantEntry[] {
  const entries: ConstantEntry[] = [];
  const constRe = /export\s+const\s+(\w+)\s*=\s*([^;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = constRe.exec(source)) !== null) {
    const name = match[1]!;
    const value = match[2]!.trim();
    // Skip function declarations and class-like expressions
    if (
      value.startsWith("(") ||
      value.startsWith("new ") ||
      value.startsWith("function")
    )
      continue;
    entries.push({ name, value, sourcePackage, sourcePath });
  }
  return entries;
}

function scanPackage(
  pkgRoot: string,
  pkgName: string,
  projectRoot: string,
  excludeNames: Set<string> = DEFAULT_EXCLUDE_NAMES,
): {
  types: TypeRegistryEntry[];
  constants: ConstantEntry[];
  deps: string[];
  classNames: string[];
} {
  // Try src/ first, then the package root itself
  const srcDir = path.join(pkgRoot, "src");
  const tsFiles = fs.existsSync(srcDir)
    ? walkTs(srcDir, excludeNames)
    : walkTs(pkgRoot, excludeNames);

  const types: TypeRegistryEntry[] = [];
  const constants: ConstantEntry[] = [];
  const classNames: string[] = [];
  let deps: string[] = [];

  // Read deps from package.json if present
  const pkgJsonPath = path.join(pkgRoot, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      const rawDeps = pkg["dependencies"] as Record<string, string> | undefined;
      const rawDev = pkg["devDependencies"] as
        | Record<string, string>
        | undefined;
      const all = { ...rawDeps, ...rawDev };
      deps = Object.keys(all).filter(
        (d) => !d.startsWith("@types/") && !d.startsWith("typescript"),
      );
    } catch {
      /* skip malformed */
    }
  }

  for (const filePath of tsFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relPath = path.relative(projectRoot, filePath);
    types.push(...extractTypes(source, relPath, pkgName));
    constants.push(...extractConstants(source, relPath, pkgName));
    classNames.push(...extractClasses(source));
  }

  // Deduplicate class names
  const uniqueClasses = [...new Set(classNames)];

  return { types, constants, deps, classNames: uniqueClasses };
}

function resolveProjectName(projectRoot: string): string {
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      if (typeof pkg["name"] === "string" && pkg["name"]) return pkg["name"];
    } catch {
      /* skip */
    }
  }
  return path.basename(projectRoot);
}

export interface AnalyzeOptions {
  /** Extra directory names to exclude (merged with defaults). */
  readonly excludePatterns?: string[];
  /** When true, skips Ada install-path exclusion even if projectRoot !== adaRoot. */
  readonly selfCompile?: boolean;
}

export function analyzeCodebase(
  projectRoot: string,
  options: AnalyzeOptions = {},
): CodebaseContext {
  const resolvedRoot = path.resolve(projectRoot);

  // Build the exclusion set for walkTs
  const excludeNames = new Set(DEFAULT_EXCLUDE_NAMES);
  for (const p of options.excludePatterns ?? []) excludeNames.add(p);

  // Detect Ada's install root. If this compilation targets a different directory,
  // skip Ada's own packages/ dir to prevent Ada-internal types from leaking into
  // the target project's type registry.
  const adaRoot = findAdaInstallRoot();
  const isSelfCompile =
    options.selfCompile === true ||
    (adaRoot != null && path.resolve(adaRoot) === resolvedRoot);

  const packagesDir = path.join(resolvedRoot, "packages");

  const monorepoPackages = fs.existsSync(packagesDir)
    ? fs.readdirSync(packagesDir).filter((d) => {
        // When not self-compiling, skip Ada's own packages subdirectories if
        // they happen to appear under projectRoot (e.g. user runs `ada compile`
        // from Ada's own repo directory for a non-Ada intent).
        if (!isSelfCompile && adaRoot) {
          const fullPkgPath = path.join(packagesDir, d);
          const adaPkgsDir = path.join(path.resolve(adaRoot), "packages");
          if (
            fullPkgPath.startsWith(adaPkgsDir + path.sep) ||
            fullPkgPath === adaPkgsDir
          ) {
            return false;
          }
        }
        const p = path.join(packagesDir, d, "package.json");
        return (
          fs.existsSync(p) &&
          fs.statSync(path.join(packagesDir, d)).isDirectory()
        );
      })
    : [];

  const allTypes: TypeRegistryEntry[] = [];
  const allConstants: ConstantEntry[] = [];
  const boundaries: PackageBoundary[] = [];

  if (monorepoPackages.length > 0) {
    // ── Monorepo path: scan each package under packages/ ──────────────────
    for (const pkgDir of monorepoPackages) {
      const pkgRoot = path.join(packagesDir, pkgDir);
      const pkgJsonPath = path.join(pkgRoot, "package.json");
      let pkgName = `${pkgDir}`;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<
          string,
          unknown
        >;
        if (typeof pkg["name"] === "string") pkgName = pkg["name"];
      } catch {
        /* skip */
      }

      const { types, constants, deps, classNames } = scanPackage(
        pkgRoot,
        pkgName,
        resolvedRoot,
        excludeNames,
      );
      allTypes.push(...types);
      allConstants.push(...constants);
      boundaries.push({
        name: pkgName,
        types: types.map((t) => t.name),
        classNames,
        dependencies: deps.filter((d) =>
          monorepoPackages.some((p) => d.includes(p)),
        ),
      });
    }
  } else {
    // ── Standalone project: scan src/, app/, lib/, then root .ts files ────
    const projectName = resolveProjectName(resolvedRoot);
    const candidateDirs = ["src", "app", "lib", "pages", "components"].map(
      (d) => path.join(resolvedRoot, d),
    );

    const dirsToScan = candidateDirs.filter(
      (d) => fs.existsSync(d) && fs.statSync(d).isDirectory(),
    );

    // Fall back to root-level .ts files if no standard dirs found
    if (dirsToScan.length === 0) {
      const rootTs = fs
        .readdirSync(resolvedRoot)
        .filter(
          (f) =>
            f.endsWith(".ts") && !f.endsWith(".d.ts") && !excludeNames.has(f),
        )
        .map((f) => path.join(resolvedRoot, f));

      for (const filePath of rootTs) {
        const source = fs.readFileSync(filePath, "utf8");
        const relPath = path.relative(resolvedRoot, filePath);
        allTypes.push(...extractTypes(source, relPath, projectName));
        allConstants.push(...extractConstants(source, relPath, projectName));
      }
    } else {
      for (const dir of dirsToScan) {
        for (const filePath of walkTs(dir, excludeNames)) {
          const source = fs.readFileSync(filePath, "utf8");
          const relPath = path.relative(resolvedRoot, filePath);
          allTypes.push(...extractTypes(source, relPath, projectName));
          allConstants.push(...extractConstants(source, relPath, projectName));
        }
      }
    }

    if (allTypes.length > 0 || allConstants.length > 0) {
      const { deps, classNames } = scanPackage(
        resolvedRoot,
        projectName,
        resolvedRoot,
        excludeNames,
      );
      boundaries.push({
        name: projectName,
        types: allTypes.map((t) => t.name),
        classNames,
        dependencies: deps,
      });
    }
  }

  if (allTypes.length === 0 && allConstants.length === 0) {
    const postcode = generatePostcode("CTX", "empty");
    return {
      typeRegistry: [],
      vocabulary: [],
      constants: [],
      packageBoundaries: [],
      postcode,
    };
  }

  // Vocabulary: unique type names, sorted
  const vocabulary = [...new Set(allTypes.map((t) => t.name))].sort();

  const contentForHash = JSON.stringify({
    vocabulary,
    constants: allConstants.map((c) => c.name),
  });
  const postcode = generatePostcode("CTX", contentForHash);

  return {
    typeRegistry: allTypes,
    vocabulary,
    constants: allConstants,
    packageBoundaries: boundaries,
    postcode,
  };
}
