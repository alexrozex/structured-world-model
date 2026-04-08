#!/usr/bin/env node

import { program } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { stringify as yamlStringify } from "yaml";
import { buildWorldModel } from "./swm.js";
import { fetchUrl, isUrl } from "./utils/fetch.js";
import { refineWorldModel } from "./agents/refinement.js";
import { mergeWorldModels, diffWorldModels } from "./utils/merge.js";
import {
  findEntity,
  findDependents,
  toMermaid,
  toDot,
  getStats,
  summarize,
  subgraph,
  findClusters,
  analyzeImpact,
} from "./utils/graph.js";
import { queryWorldModel } from "./agents/query.js";
import { intersection, difference, overlay } from "./utils/algebra.js";
import { toClaudeMd } from "./export/claude-md.js";
import { toSystemPrompt } from "./export/system-prompt.js";
import { toMcpSchema } from "./export/mcp-schema.js";
import {
  createTimeline,
  addSnapshot,
  entityHistory,
  timelineSummary,
} from "./utils/timeline.js";
import { coverage as coverageFn } from "./utils/coverage.js";
import type { Timeline } from "./utils/timeline.js";
import type { PipelineInput } from "./pipeline/index.js";
import type { WorldModelType } from "./schema/index.js";

function detectSourceType(
  raw: string,
  filePath?: string,
): PipelineInput["sourceType"] {
  // Check file extension first
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const codeExts = new Set([
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "cs",
      "swift",
      "kt",
    ]);
    if (codeExts.has(ext ?? "")) return "code";
    if (
      ext === "json" ||
      ext === "yaml" ||
      ext === "yml" ||
      ext === "xml" ||
      ext === "csv" ||
      ext === "toml"
    )
      return "document";
    if (ext === "md" || ext === "txt" || ext === "rst") return "text";
  }

  const trimmed = raw.trimStart();

  // URL
  if (/^https?:\/\//i.test(trimmed)) return "url";

  // JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(raw);
      return "document";
    } catch {
      /* not valid JSON, continue */
    }
  }

  // YAML (multiple key: value lines, not code)
  const yamlLines = raw.split("\n").filter((l) => /^\w[\w\s]*:\s/.test(l));
  if (yamlLines.length >= 3 && !raw.includes("function ")) return "document";

  // XML/HTML-like structured data
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<root") ||
    trimmed.startsWith("<!DOCTYPE")
  )
    return "document";

  // Code heuristics (multiple signals needed to avoid false positives)
  const codeSignals = [
    /\bfunction\s+\w+\s*\(/.test(raw),
    /\bclass\s+\w+/.test(raw),
    /^import\s+/m.test(raw),
    /^from\s+\S+\s+import/m.test(raw),
    /\bdef\s+\w+\s*\(/.test(raw),
    /\bfn\s+\w+\s*\(/.test(raw),
    /^(const|let|var)\s+\w+\s*=/m.test(raw),
    /=>\s*\{/.test(raw),
  ];
  if (codeSignals.filter(Boolean).length >= 2) return "code";

  // Conversation (speaker patterns: "Name:", "Speaker 1:", "Q:", "A:")
  if (/^[A-Z][a-z]+\s*:/m.test(raw) && /\n[A-Z][a-z]+\s*:/m.test(raw))
    return "conversation";

  return "text";
}

function readInput(inputArg?: string, filePath?: string): string {
  if (filePath) return readFileSync(resolve(filePath), "utf-8");
  if (inputArg) {
    try {
      return readFileSync(resolve(inputArg), "utf-8");
    } catch {
      return inputArg;
    }
  }
  throw new Error(
    "No input provided. Pass text, a file path, or use -f <file>.",
  );
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "No input provided. Pass text, a file path, a URL, or pipe via stdin.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readInputAsync(
  inputArg?: string,
  filePaths?: string | string[],
): Promise<{ raw: string; detectedUrl?: string }> {
  // Multiple files — concatenate with headers
  if (Array.isArray(filePaths) && filePaths.length > 1) {
    const parts: string[] = [];
    for (const fp of filePaths) {
      const resolved = resolve(fp);
      if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
      const content = readFileSync(resolved, "utf-8");
      parts.push(`// === ${fp} ===\n${content}`);
    }
    return { raw: parts.join("\n\n") };
  }

  // Single file path (extract from array if needed)
  const filePath = Array.isArray(filePaths) ? filePaths[0] : filePaths;

  // Check if input is a URL — fetch it
  const candidate = filePath || inputArg || "";
  if (isUrl(candidate)) {
    process.stderr.write(chalk.gray(`  Fetching ${candidate}...\n`));
    const { text } = await fetchUrl(candidate);
    return { raw: text, detectedUrl: candidate };
  }
  // Try file/arg, fall back to stdin
  try {
    return { raw: readInput(inputArg, filePath) };
  } catch {
    return { raw: await readStdin() };
  }
}

async function readModel(path: string): Promise<WorldModelType> {
  if (path === "-" || (!process.stdin.isTTY && !existsSync(resolve(path)))) {
    const raw =
      path === "-"
        ? await readStdin()
        : (() => {
            throw new Error(`File not found: ${resolve(path)}`);
          })();
    try {
      return JSON.parse(raw) as WorldModelType;
    } catch {
      throw new Error("Invalid JSON from stdin — is this a world model?");
    }
  }
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, "utf-8");
  try {
    return JSON.parse(raw) as WorldModelType;
  } catch {
    throw new Error(`Invalid JSON in ${path} — is this a world model file?`);
  }
}

function formatOutput(
  model: WorldModelType,
  format: string,
  pretty: boolean,
): string {
  if (format === "yaml") return yamlStringify(model);
  if (format === "mermaid") return toMermaid(model);
  if (format === "dot") return toDot(model);
  return pretty ? JSON.stringify(model, null, 2) : JSON.stringify(model);
}

function stageCallbacks(quiet?: boolean) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stageStart = 0;
  return {
    onStageStart: (name: string) => {
      if (!quiet) {
        process.stderr.write(chalk.yellow(`  ▸ ${name}...`));
        stageStart = Date.now();
        timer = setInterval(() => {
          const elapsed = Math.round((Date.now() - stageStart) / 1000);
          process.stderr.write(
            `\r${chalk.yellow(`  ▸ ${name}... ${elapsed}s`)}`,
          );
        }, 2000);
      }
    },
    onStageEnd: (_name: string, ms: number, data?: unknown) => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!quiet) {
        let detail = "";
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          // After structuring or validation, show model stats
          if (d.worldModel && typeof d.worldModel === "object") {
            const wm = d.worldModel as Record<string, unknown[]>;
            detail = chalk.gray(
              ` (${wm.entities?.length ?? "?"}e ${wm.relations?.length ?? "?"}r ${wm.processes?.length ?? "?"}p ${wm.constraints?.length ?? "?"}c)`,
            );
          }
          // After extraction, show raw extraction counts
          if (d.extraction && typeof d.extraction === "object") {
            const ex = d.extraction as Record<string, unknown[]>;
            detail = chalk.gray(
              ` (${ex.entities?.length ?? "?"}e ${ex.relations?.length ?? "?"}r)`,
            );
          }
        }
        process.stderr.write(chalk.green(` done (${ms}ms)`) + detail + "\n");
      }
    },
  };
}

program
  .name("swm")
  .description(
    "Structured World Model — turn anything into a structured world model",
  )
  .version("0.1.0");

// ─── model ────────────────────────────────────────────────────
program
  .command("model")
  .description("Build a structured world model from input")
  .argument("[input]", "Text input or file path")
  .option(
    "-f, --file <paths...>",
    "Read input from one or more files (concatenated)",
  )
  .option("-o, --output <path>", "Write output to file")
  .option(
    "-t, --type <type>",
    "Source type: text, code, document, url, conversation, mixed",
  )
  .option(
    "--format <format>",
    "Output format: json, yaml, mermaid, dot",
    "json",
  )
  .option("--pretty", "Pretty-print JSON output", true)
  .option("--full", "Output full result (model + validation + score + timings)")
  .option("--quiet", "Suppress progress output")
  .option(
    "-p, --passes <n>",
    "Number of extraction passes (1=standard, 2-3=deeper)",
    "1",
  )
  .option(
    "-m, --model <model>",
    "Claude model to use (e.g. claude-opus-4-20250514, claude-haiku-4-5-20251001)",
  )
  .option(
    "--fix",
    "Auto-fix validation issues before outputting (remove orphans, dangling refs, duplicates)",
  )
  .option(
    "--min-score <n>",
    "Exit non-zero if quality score is below this threshold (0-100)",
  )
  .option("--watch", "Watch input file and rebuild on change")
  .option(
    "--merge-files",
    "Extract each file separately then merge (better for multi-file input)",
  )
  .option(
    "-n, --name <name>",
    "Set the world model name (overrides LLM-generated name)",
  )
  .option("-d, --description <desc>", "Set the world model description")
  .action(
    async (
      inputArg: string | undefined,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const { raw, detectedUrl } = await readInputAsync(
          inputArg,
          opts.file as string | string[] | undefined,
        );
        if (!raw.trim()) {
          console.error(chalk.red("Error: No input provided"));
          process.exit(1);
        }

        const sourceType =
          (opts.type as PipelineInput["sourceType"]) ||
          (detectedUrl
            ? "url"
            : detectSourceType(
                raw,
                (Array.isArray(opts.file)
                  ? opts.file[0]
                  : (opts.file as string)) ?? inputArg,
              ));
        const input: PipelineInput = {
          raw,
          sourceType,
          name:
            detectedUrl ||
            (opts.file as string) ||
            (inputArg && inputArg.length < 100 ? inputArg : undefined),
        };

        if (!opts.quiet) {
          console.error(chalk.blue("■ Structured World Model"));
          console.error(
            chalk.gray(`  Source: ${sourceType} (${raw.length} chars)\n`),
          );
        }

        const passes = parseInt((opts.passes as string) ?? "1", 10) || 1;
        const buildOpts = {
          ...stageCallbacks(opts.quiet as boolean),
          passes,
          model: opts.model as string | undefined,
        };

        let result: Awaited<ReturnType<typeof buildWorldModel>>;

        // Multi-file merge mode: extract each file separately, then merge
        const filePaths = opts.file;
        if (
          opts.mergeFiles &&
          Array.isArray(filePaths) &&
          filePaths.length > 1
        ) {
          if (!opts.quiet)
            console.error(
              chalk.gray(
                `  Merge mode: extracting ${filePaths.length} files separately\n`,
              ),
            );

          let merged: WorldModelType | null = null;
          for (const fp of filePaths) {
            const fileContent = readFileSync(resolve(fp as string), "utf-8");
            const fileType =
              (opts.type as PipelineInput["sourceType"]) ||
              detectSourceType(fileContent, fp as string);
            if (!opts.quiet)
              console.error(
                chalk.gray(
                  `  ── ${fp} (${fileType}, ${fileContent.length} chars)`,
                ),
              );

            const fileResult = await buildWorldModel(
              { raw: fileContent, sourceType: fileType, name: fp as string },
              buildOpts,
            );

            if (!merged) {
              merged = fileResult.worldModel;
            } else {
              const { mergeWorldModels: mwm } =
                await import("./utils/merge.js");
              merged = mwm(merged, fileResult.worldModel, {
                name: merged.name,
                description: merged.description,
              });
            }
          }

          // Re-validate the merged model
          const { validationAgent: va } =
            await import("./agents/validation.js");
          const { worldModel: finalMerged, validation } = await va({
            input,
            worldModel: merged!,
          });

          result = {
            worldModel: finalMerged,
            validation,
            stages: [],
            totalDurationMs: 0,
          };
        } else {
          result = await buildWorldModel(input, buildOpts);
        }

        let finalModel = result.worldModel;
        if (opts.name) {
          finalModel = { ...finalModel, name: opts.name as string };
        }
        if (opts.description) {
          finalModel = {
            ...finalModel,
            description: opts.description as string,
          };
        }
        if (opts.fix) {
          const { fixWorldModel } = await import("./utils/fix.js");
          const { model: fixed, fixes } = fixWorldModel(finalModel);
          finalModel = fixed;
          if (!opts.quiet && fixes.length > 0) {
            console.error(chalk.yellow(`\n  Auto-fixed: ${fixes.join(", ")}`));
          }
          // Re-validate after fix to get accurate score
          const { validationAgent: va } =
            await import("./agents/validation.js");
          const { validation: revalidation } = await va({
            input,
            worldModel: finalModel,
          });
          result = {
            ...result,
            worldModel: finalModel,
            validation: revalidation,
          };
        }

        let output: string;
        if (opts.full) {
          const fullResult = {
            worldModel: finalModel,
            validation: result.validation,
            totalDurationMs: result.totalDurationMs,
          };
          output = JSON.stringify(fullResult, null, 2);
        } else {
          output = formatOutput(
            finalModel,
            (opts.format as string) ?? "json",
            (opts.pretty as boolean) ?? true,
          );
        }

        if (opts.output) {
          writeFileSync(resolve(opts.output as string), output, "utf-8");
          if (!opts.quiet)
            console.error(chalk.green(`\n  ✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }

        if (!opts.quiet) {
          const v = result.validation;
          const statusColor = v.valid ? chalk.green : chalk.red;
          console.error(
            statusColor(
              `\n  Validation: ${v.valid ? "PASSED" : "FAILED"} — ${v.stats.entities} entities, ${v.stats.relations} relations, ${v.stats.processes} processes, ${v.stats.constraints} constraints`,
            ),
          );
          if (v.issues.length > 0) {
            console.error(chalk.gray(`  Issues:`));
            for (const issue of v.issues) {
              const icon =
                issue.type === "error"
                  ? chalk.red("✗")
                  : issue.type === "warning"
                    ? chalk.yellow("!")
                    : chalk.blue("i");
              console.error(`    ${icon} ${issue.message}`);
            }
          }
          if (v.score !== undefined) {
            const sc =
              v.score >= 80
                ? chalk.green
                : v.score >= 50
                  ? chalk.yellow
                  : chalk.red;
            console.error(sc(`  Quality: ${v.score}/100`));
          }
          console.error(chalk.gray(`  Summary: ${summarize(finalModel)}`));
          console.error(chalk.gray(`\n  Total: ${result.totalDurationMs}ms`));
        } else {
          // Quiet mode: still emit score to stderr for CI logging
          const v = result.validation;
          if (v.score !== undefined) {
            console.error(
              `score=${v.score} entities=${v.stats.entities} relations=${v.stats.relations}`,
            );
          }
        }

        // Quality gate
        const minScore = opts.minScore
          ? parseInt(opts.minScore as string, 10)
          : undefined;
        if (minScore !== undefined && result.validation.score !== undefined) {
          if (result.validation.score < minScore) {
            console.error(
              chalk.red(
                `\n  Quality gate FAILED: score ${result.validation.score} < threshold ${minScore}`,
              ),
            );
            process.exit(1);
          }
        }
        // Watch mode
        if (opts.watch) {
          const watchPaths = Array.isArray(opts.file)
            ? opts.file
            : opts.file
              ? [opts.file as string]
              : inputArg
                ? [inputArg]
                : [];
          if (
            watchPaths.length === 0 ||
            !watchPaths.every((p) => existsSync(resolve(p as string)))
          ) {
            console.error(
              chalk.yellow("  --watch requires a file path (-f or argument)"),
            );
            return;
          }
          const { watch } = await import("node:fs");
          console.error(
            chalk.blue(
              `\n  Watching ${watchPaths.length} file(s) for changes... (Ctrl+C to stop)\n`,
            ),
          );
          let rebuilding = false;
          for (const wp of watchPaths) {
            watch(resolve(wp as string), async (eventType) => {
              if (eventType !== "change" || rebuilding) return;
              rebuilding = true;
              console.error(
                chalk.gray(
                  `\n  [${new Date().toLocaleTimeString()}] Change detected, rebuilding...`,
                ),
              );
              try {
                const { raw: newRaw } = await readInputAsync(
                  inputArg,
                  opts.file as string | string[] | undefined,
                );
                const newInput: PipelineInput = {
                  raw: newRaw,
                  sourceType: sourceType,
                  name: input.name,
                };
                const newResult = await buildWorldModel(newInput, {
                  ...stageCallbacks(opts.quiet as boolean),
                  passes,
                  model: opts.model as string | undefined,
                });
                let newFinal = newResult.worldModel;
                if (opts.fix) {
                  const { fixWorldModel } = await import("./utils/fix.js");
                  const { model: fixed } = fixWorldModel(newFinal);
                  newFinal = fixed;
                }
                const newOutput = formatOutput(
                  newFinal,
                  (opts.format as string) ?? "json",
                  (opts.pretty as boolean) ?? true,
                );
                if (opts.output) {
                  writeFileSync(
                    resolve(opts.output as string),
                    newOutput,
                    "utf-8",
                  );
                  console.error(
                    chalk.green(
                      `  ✓ Updated ${opts.output} — ${newResult.validation.stats.entities} entities, score: ${newResult.validation.score}/100`,
                    ),
                  );
                } else {
                  console.log(newOutput);
                }
              } catch (e) {
                console.error(
                  chalk.red(
                    `  Rebuild error: ${e instanceof Error ? e.message : String(e)}`,
                  ),
                );
              }
              rebuilding = false;
            });
          }
          // Keep process alive
          await new Promise(() => {});
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── refine ───────────────────────────────────────────────────
program
  .command("refine")
  .description(
    "Refine an existing world model with new input (incremental extraction)",
  )
  .argument("<model>", "Path to existing world model JSON")
  .argument("[input]", "New text input or file path")
  .option("-f, --file <path>", "Read new input from file")
  .option("-o, --output <path>", "Write refined model to file")
  .option("-t, --type <type>", "Source type of new input")
  .option(
    "--format <format>",
    "Output format: json, yaml, mermaid, dot",
    "json",
  )
  .option("--quiet", "Suppress progress output")
  .action(
    async (
      modelPath: string,
      inputArg: string | undefined,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const existing = await readModel(modelPath);
        const raw = readInput(inputArg, opts.file as string | undefined);
        const sourceType =
          (opts.type as PipelineInput["sourceType"]) || detectSourceType(raw);

        if (!opts.quiet) {
          console.error(chalk.blue("■ Refining World Model"));
          console.error(
            chalk.gray(
              `  Existing: ${existing.entities.length} entities, ${existing.relations.length} relations`,
            ),
          );
          console.error(
            chalk.gray(`  New input: ${sourceType} (${raw.length} chars)\n`),
          );
        }

        const { worldModel, delta } = await refineWorldModel(
          existing,
          { raw, sourceType },
          stageCallbacks(opts.quiet as boolean),
        );

        const output = formatOutput(
          worldModel,
          (opts.format as string) ?? "json",
          true,
        );

        if (opts.output) {
          writeFileSync(resolve(opts.output as string), output, "utf-8");
          if (!opts.quiet)
            console.error(chalk.green(`\n  ✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }

        if (!opts.quiet) {
          console.error(
            chalk.gray(
              `\n  Delta: +${delta.entities.length} entities, +${delta.relations.length} relations, +${delta.processes.length} processes`,
            ),
          );
          console.error(
            chalk.gray(
              `  Result: ${worldModel.entities.length} entities, ${worldModel.relations.length} relations total`,
            ),
          );
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── merge ────────────────────────────────────────────────────
program
  .command("merge")
  .description("Merge two world models into one")
  .argument("<modelA>", "Path to first world model JSON")
  .argument("<modelB>", "Path to second world model JSON")
  .option("-o, --output <path>", "Write merged model to file")
  .option("--format <format>", "Output format: json, yaml", "json")
  .action(
    async (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const a = await readModel(pathA);
        const b = await readModel(pathB);
        const merged = mergeWorldModels(a, b);
        const output = formatOutput(merged, opts.format ?? "json", true);

        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(
            chalk.green(`✓ Merged model written to ${opts.output}`),
          );
        } else {
          console.log(output);
        }

        console.error(
          chalk.gray(
            `  ${merged.entities.length} entities, ${merged.relations.length} relations`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── diff ─────────────────────────────────────────────────────
program
  .command("diff")
  .description("Diff two world models")
  .argument("<before>", "Path to before world model JSON")
  .argument("<after>", "Path to after world model JSON")
  .action(async (beforePath: string, afterPath: string) => {
    try {
      const before = await readModel(beforePath);
      const after = await readModel(afterPath);
      const diff = diffWorldModels(before, after);

      console.log(chalk.blue("■ World Model Diff\n"));
      console.log(chalk.white(`  Summary: ${diff.summary}\n`));

      if (diff.entities.added.length) {
        console.log(chalk.green("  + Entities added:"));
        for (const name of diff.entities.added)
          console.log(chalk.green(`    + ${name}`));
      }
      if (diff.entities.removed.length) {
        console.log(chalk.red("  - Entities removed:"));
        for (const name of diff.entities.removed)
          console.log(chalk.red(`    - ${name}`));
      }
      if (diff.entities.modified.length) {
        console.log(chalk.yellow("  ~ Entities modified:"));
        for (const name of diff.entities.modified)
          console.log(chalk.yellow(`    ~ ${name}`));
      }
      if (diff.relations.added.length) {
        console.log(
          chalk.green(`  + ${diff.relations.added.length} relations added`),
        );
      }
      if (diff.relations.removed.length) {
        console.log(
          chalk.red(`  - ${diff.relations.removed.length} relations removed`),
        );
      }
      if (diff.processes.added.length) {
        console.log(
          chalk.green(`  + ${diff.processes.added.length} processes added`),
        );
      }
      if (diff.constraints.added.length) {
        console.log(
          chalk.green(`  + ${diff.constraints.added.length} constraints added`),
        );
      }

      // Score comparison
      const { validationAgent: va } = await import("./agents/validation.js");
      const { validation: vBefore } = await va({
        input: { raw: "", sourceType: "text" },
        worldModel: before,
      });
      const { validation: vAfter } = await va({
        input: { raw: "", sourceType: "text" },
        worldModel: after,
      });
      if (vBefore.score !== undefined && vAfter.score !== undefined) {
        const delta = vAfter.score - vBefore.score;
        const arrow =
          delta > 0
            ? chalk.green(`+${delta}`)
            : delta < 0
              ? chalk.red(`${delta}`)
              : chalk.gray("±0");
        console.log(
          `\n  Quality: ${vBefore.score} → ${vAfter.score} (${arrow})`,
        );
      }
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── inspect ──────────────────────────────────────────────────
program
  .command("inspect")
  .description("Inspect a world model — stats, entity lookup, graph export")
  .argument("<model>", "Path to world model JSON")
  .option(
    "-e, --entity <name>",
    "Look up a specific entity and show its relations",
  )
  .option("--stats", "Show detailed statistics")
  .option("--format <format>", "Export format: mermaid, dot")
  .action(
    async (
      modelPath: string,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);

        if (opts.format) {
          console.log(formatOutput(model, opts.format as string, true));
          return;
        }

        if (opts.entity) {
          const entity = findEntity(model, opts.entity as string);
          if (!entity) {
            console.error(chalk.red(`Entity "${opts.entity}" not found`));
            process.exit(1);
          }

          console.log(
            chalk.blue(`■ ${entity.name}`) + chalk.gray(` (${entity.type})`),
          );
          console.log(chalk.white(`  ${entity.description}`));
          if (entity.properties) {
            console.log(
              chalk.gray(`  Properties: ${JSON.stringify(entity.properties)}`),
            );
          }

          const deps = findDependents(model, entity.id);
          if (deps.incoming.length) {
            console.log(chalk.gray("\n  Incoming:"));
            for (const d of deps.incoming) {
              console.log(
                `    ${d.entity.name} —[${d.relation.type}]→ ${entity.name}`,
              );
            }
          }
          if (deps.outgoing.length) {
            console.log(chalk.gray("\n  Outgoing:"));
            for (const d of deps.outgoing) {
              console.log(
                `    ${entity.name} —[${d.relation.type}]→ ${d.entity.name}`,
              );
            }
          }
          return;
        }

        // Default: show stats
        const stats = getStats(model);
        console.log(chalk.blue(`■ ${model.name}`));
        console.log(chalk.gray(`  ${model.description}\n`));
        console.log(`  Entities:    ${stats.entities.total}`);
        for (const [type, count] of Object.entries(stats.entities.byType)) {
          console.log(chalk.gray(`    ${type}: ${count}`));
        }
        console.log(`  Relations:   ${stats.relations.total}`);
        for (const [type, count] of Object.entries(stats.relations.byType)) {
          console.log(chalk.gray(`    ${type}: ${count}`));
        }
        console.log(
          `  Processes:   ${stats.processes.total} (${stats.processes.totalSteps} steps)`,
        );
        console.log(
          `  Constraints: ${stats.constraints.total} (${stats.constraints.hard} hard, ${stats.constraints.soft} soft)`,
        );
        console.log(`  Confidence:  ${stats.confidence}`);

        if (stats.mostConnected.length) {
          console.log(chalk.gray("\n  Most connected:"));
          for (const mc of stats.mostConnected) {
            console.log(`    ${mc.entity}: ${mc.connections} connections`);
          }
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── validate ─────────────────────────────────────────────────
program
  .command("validate")
  .description("Validate a world model JSON file with full integrity checks")
  .argument("<file>", "Path to world model JSON")
  .option("--strict", "Exit non-zero on any warning (not just errors)")
  .action(async (file: string, opts: Record<string, boolean | undefined>) => {
    try {
      const model = await readModel(file);

      console.log(chalk.blue("■ Validating world model"));
      console.log(
        chalk.gray(
          `  ${model.entities.length} entities, ${model.relations.length} relations\n`,
        ),
      );

      const { validationAgent } = await import("./agents/validation.js");
      const { validation } = await validationAgent({
        input: { raw: "", sourceType: "text" },
        worldModel: model,
      });

      const statusColor = validation.valid ? chalk.green : chalk.red;
      console.log(
        statusColor(`  ${validation.valid ? "✓ VALID" : "✗ INVALID"}`),
      );

      if (validation.issues.length > 0) {
        for (const issue of validation.issues) {
          const icon =
            issue.type === "error"
              ? chalk.red("✗")
              : issue.type === "warning"
                ? chalk.yellow("!")
                : chalk.blue("i");
          console.log(`  ${icon} [${issue.code}] ${issue.message}`);
        }
      } else {
        console.log(chalk.green("  No issues found"));
      }

      console.log(
        chalk.gray(
          `\n  Stats: ${validation.stats.entities} entities, ${validation.stats.relations} relations, ${validation.stats.processes} processes, ${validation.stats.constraints} constraints`,
        ),
      );

      if (validation.score !== undefined) {
        const scoreColor =
          validation.score >= 80
            ? chalk.green
            : validation.score >= 50
              ? chalk.yellow
              : chalk.red;
        console.log(scoreColor(`  Quality score: ${validation.score}/100`));
      }

      if (!validation.valid) process.exit(1);
      if (opts.strict && validation.issues.length > 0) {
        console.error(
          chalk.red(
            `  Strict mode: ${validation.issues.length} issue(s) found`,
          ),
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── query ────────────────────────────────────────────────────
program
  .command("query")
  .description("Ask a question about a world model")
  .argument("<model>", "Path to world model JSON")
  .argument("<question>", "Natural language question")
  .option("--json", "Output result as JSON")
  .action(
    async (
      modelPath: string,
      question: string,
      opts: Record<string, boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        const result = await queryWorldModel(model, question);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.answer);
          console.error(
            chalk.gray(
              `\n  Method: ${result.method} | Confidence: ${result.confidence} | Entities: ${result.entities_referenced.join(", ") || "none"}`,
            ),
          );
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── algebra: intersect ───────────────────────────────────────
program
  .command("intersect")
  .description("Compute the intersection of two world models (shared entities)")
  .argument("<modelA>", "Path to first world model JSON")
  .argument("<modelB>", "Path to second world model JSON")
  .option("-o, --output <path>", "Write result to file")
  .action(
    async (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = intersection(
          await readModel(pathA),
          await readModel(pathB),
        );
        const output = JSON.stringify(result, null, 2);
        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(chalk.green(`✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }
        console.error(
          chalk.gray(
            `  ${result.entities.length} shared entities, ${result.relations.length} shared relations`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── algebra: subtract ───────────────────────────────────────
program
  .command("subtract")
  .description("Compute A \\ B — entities in A that are not in B")
  .argument("<modelA>", "Path to base world model JSON")
  .argument("<modelB>", "Path to model to subtract")
  .option("-o, --output <path>", "Write result to file")
  .action(
    async (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = difference(
          await readModel(pathA),
          await readModel(pathB),
        );
        const output = JSON.stringify(result, null, 2);
        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(chalk.green(`✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }
        console.error(
          chalk.gray(`  ${result.entities.length} unique entities remaining`),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── algebra: overlay ────────────────────────────────────────
program
  .command("overlay")
  .description(
    "Apply a lens model on top of a base model (constraints, relations overlay)",
  )
  .argument("<base>", "Path to base world model JSON")
  .argument("<lens>", "Path to lens model to overlay")
  .option("-o, --output <path>", "Write result to file")
  .action(
    async (
      basePath: string,
      lensPath: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = overlay(
          await readModel(basePath),
          await readModel(lensPath),
        );
        const output = JSON.stringify(result, null, 2);
        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(chalk.green(`✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }
        console.error(
          chalk.gray(
            `  ${result.entities.length} entities, ${result.constraints.length} constraints after overlay`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── export ──────────────────────────────────────────────────
program
  .command("export")
  .description("Export a world model as AI-consumable context")
  .argument("<model>", "Path to world model JSON")
  .option(
    "--as <format>",
    "Export format: claude-md, system-prompt, mcp",
    "claude-md",
  )
  .option("-o, --output <path>", "Write to file")
  .action(
    async (modelPath: string, opts: Record<string, string | undefined>) => {
      try {
        const model = await readModel(modelPath);
        let output: string;

        switch (opts.as) {
          case "claude-md":
            output = toClaudeMd(model);
            break;
          case "system-prompt":
            output = toSystemPrompt(model);
            break;
          case "mcp":
            output = JSON.stringify(toMcpSchema(model), null, 2);
            break;
          default:
            console.error(
              chalk.red(
                `Unknown export format: ${opts.as}. Use: claude-md, system-prompt, mcp`,
              ),
            );
            process.exit(1);
        }

        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(
            chalk.green(`✓ Exported as ${opts.as} to ${opts.output}`),
          );
        } else {
          console.log(output);
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── timeline: snapshot ───────────────────────────────────────
program
  .command("snapshot")
  .description("Add a world model as a snapshot to a timeline")
  .argument("<model>", "Path to world model JSON")
  .option(
    "--timeline <path>",
    "Path to timeline JSON (created if missing)",
    "timeline.json",
  )
  .option("-l, --label <label>", "Label for this snapshot")
  .action(
    async (modelPath: string, opts: Record<string, string | undefined>) => {
      try {
        const model = await readModel(modelPath);
        const tlPath = resolve(opts.timeline ?? "timeline.json");

        let timeline: Timeline;
        try {
          const raw = readFileSync(tlPath, "utf-8");
          timeline = JSON.parse(raw) as Timeline;
        } catch {
          timeline = createTimeline(model.name);
          console.error(chalk.gray(`  Creating new timeline: ${tlPath}`));
        }

        timeline = addSnapshot(timeline, model, opts.label);
        writeFileSync(tlPath, JSON.stringify(timeline, null, 2), "utf-8");

        const snap = timeline.snapshots[timeline.snapshots.length - 1];
        console.error(chalk.green(`✓ Snapshot ${snap.id} added to ${tlPath}`));
        console.error(
          chalk.gray(
            `  ${snap.stats.entities} entities, ${snap.stats.relations} relations`,
          ),
        );
        if (snap.diff_from_previous) {
          console.error(
            chalk.gray(`  Changes: ${snap.diff_from_previous.summary}`),
          );
        }
        console.error(
          chalk.gray(`  Total snapshots: ${timeline.snapshots.length}`),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── timeline: history ────────────────────────────────────────
program
  .command("history")
  .description("Show timeline evolution or entity history")
  .argument("<timeline>", "Path to timeline JSON")
  .option("-e, --entity <name>", "Track a specific entity across snapshots")
  .action(async (tlPath: string, opts: Record<string, string | undefined>) => {
    try {
      const raw = readFileSync(resolve(tlPath), "utf-8");
      const timeline = JSON.parse(raw) as Timeline;

      if (opts.entity) {
        const history = entityHistory(timeline, opts.entity);
        if (history.length === 0) {
          console.log(
            chalk.yellow(`Entity "${opts.entity}" not found in any snapshot.`),
          );
          return;
        }
        console.log(
          chalk.blue(
            `■ History of "${opts.entity}" across ${timeline.snapshots.length} snapshots\n`,
          ),
        );
        for (const entry of history) {
          const icon =
            entry.event === "appeared"
              ? chalk.green("+")
              : entry.event === "disappeared"
                ? chalk.red("-")
                : entry.event === "modified"
                  ? chalk.yellow("~")
                  : chalk.gray("=");
          const label = entry.label ? ` (${entry.label})` : "";
          console.log(`  ${icon} ${entry.timestamp}${label}: ${entry.event}`);
          if (entry.description)
            console.log(chalk.gray(`    ${entry.description}`));
        }
      } else {
        console.log(timelineSummary(timeline));
      }
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── serve ────────────────────────────────────────────────────
program
  .command("serve")
  .description(
    "Start an MCP server that serves a world model as live, queryable tools",
  )
  .argument("<model>", "Path to world model JSON")
  .action(async (modelPath: string) => {
    try {
      const resolved = resolve(modelPath);
      if (!existsSync(resolved)) {
        console.error(chalk.red(`File not found: ${resolved}`));
        process.exit(1);
      }
      const model = await readModel(modelPath);
      console.error(chalk.blue(`■ SWM MCP Server`));
      console.error(chalk.gray(`  Model: ${model.name}`));
      console.error(
        chalk.gray(
          `  Entities: ${model.entities.length}, Relations: ${model.relations.length}`,
        ),
      );
      console.error(
        chalk.gray(
          `  Tools: get_entity, get_relations, find_path, get_process, check_constraint, query, get_stats, get_diagram`,
        ),
      );
      console.error(chalk.green(`  Listening on stdio...\n`));

      const { startMcpServer } = await import("./serve/mcp-server.js");
      await startMcpServer(modelPath);
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── schema ───────────────────────────────────────────────────
program
  .command("schema")
  .description(
    "Output the WorldModel JSON Schema (for validation or code generation)",
  )
  .action(async () => {
    const { getWorldModelJsonSchema } = await import("./schema/json-schema.js");
    console.log(JSON.stringify(getWorldModelJsonSchema(), null, 2));
  });

// ─── summary ──────────────────────────────────────────────────
program
  .command("summary")
  .description("One-line natural language summary of a world model (no LLM)")
  .argument("<model>", "Path to world model JSON")
  .action(async (modelPath: string) => {
    try {
      const model = await readModel(modelPath);
      console.log(summarize(model));
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── entities ─────────────────────────────────────────────────
program
  .command("entities")
  .description("List all entities in a world model")
  .argument("<model>", "Path to world model JSON")
  .option(
    "-t, --type <type>",
    "Filter by entity type (actor, system, object, ...)",
  )
  .option("--json", "Output as JSON array")
  .action(
    async (
      modelPath: string,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        let entities = model.entities;
        if (opts.type) {
          entities = entities.filter((e) => e.type === opts.type);
        }
        if (opts.json) {
          console.log(JSON.stringify(entities, null, 2));
        } else {
          for (const e of entities) {
            const conf =
              e.confidence !== undefined
                ? chalk.gray(` (${Math.round(e.confidence * 100)}%)`)
                : "";
            console.log(`  [${e.type}] ${chalk.bold(e.name)}${conf}`);
            console.log(chalk.gray(`    ${e.description}`));
          }
          console.error(
            chalk.gray(
              `\n  ${entities.length} entities${opts.type ? ` of type "${opts.type}"` : ""}`,
            ),
          );
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── relations ────────────────────────────────────────────────
program
  .command("relations")
  .description("List all relations in a world model")
  .argument("<model>", "Path to world model JSON")
  .option(
    "-t, --type <type>",
    "Filter by relation type (uses, depends_on, ...)",
  )
  .option("--json", "Output as JSON array")
  .action(
    async (
      modelPath: string,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        let relations = model.relations;
        if (opts.type) {
          relations = relations.filter((r) => r.type === opts.type);
        }
        if (opts.json) {
          console.log(JSON.stringify(relations, null, 2));
        } else {
          for (const r of relations) {
            const src =
              model.entities.find((e) => e.id === r.source)?.name ?? r.source;
            const tgt =
              model.entities.find((e) => e.id === r.target)?.name ?? r.target;
            console.log(`  ${src} ${chalk.yellow(`—[${r.type}]→`)} ${tgt}`);
            if (r.label) console.log(chalk.gray(`    ${r.label}`));
          }
          console.error(
            chalk.gray(
              `\n  ${relations.length} relations${opts.type ? ` of type "${opts.type}"` : ""}`,
            ),
          );
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── coverage ─────────────────────────────────────────────────
program
  .command("coverage")
  .description("Measure how much of model A is covered by model B")
  .argument(
    "<reference>",
    "Path to reference model (the spec / source of truth)",
  )
  .argument("<target>", "Path to target model (what's being measured)")
  .option("--json", "Output as JSON")
  .action(
    async (
      refPath: string,
      tgtPath: string,
      opts: Record<string, boolean | undefined>,
    ) => {
      try {
        const ref = await readModel(refPath);
        const tgt = await readModel(tgtPath);
        const result = coverageFn(ref, tgt);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const bar = (pct: number) => {
          const filled = Math.round(pct * 20);
          return (
            chalk.green("█".repeat(filled)) +
            chalk.gray("░".repeat(20 - filled))
          );
        };

        console.log(chalk.blue(`■ Coverage: ${ref.name} → ${tgt.name}\n`));
        console.log(
          `  Overall:     ${bar(result.overall)} ${Math.round(result.overall * 100)}%`,
        );
        console.log(
          `  Entities:    ${bar(result.entityCoverage)} ${Math.round(result.entityCoverage * 100)}%`,
        );
        console.log(
          `  Relations:   ${bar(result.relationCoverage)} ${Math.round(result.relationCoverage * 100)}%`,
        );
        console.log(
          `  Processes:   ${bar(result.processCoverage)} ${Math.round(result.processCoverage * 100)}%`,
        );
        console.log(
          `  Constraints: ${bar(result.constraintCoverage)} ${Math.round(result.constraintCoverage * 100)}%`,
        );

        if (result.missingEntities.length > 0) {
          console.log(
            chalk.red(
              `\n  Missing entities (${result.missingEntities.length}):`,
            ),
          );
          for (const name of result.missingEntities)
            console.log(chalk.red(`    - ${name}`));
        }
        if (result.extraEntities.length > 0) {
          console.log(
            chalk.yellow(
              `\n  Extra entities in target (${result.extraEntities.length}):`,
            ),
          );
          for (const name of result.extraEntities)
            console.log(chalk.yellow(`    + ${name}`));
        }
        if (result.missingProcesses.length > 0) {
          console.log(
            chalk.red(
              `\n  Missing processes: ${result.missingProcesses.join(", ")}`,
            ),
          );
        }
        if (result.missingConstraints.length > 0) {
          console.log(
            chalk.red(
              `\n  Missing constraints: ${result.missingConstraints.join(", ")}`,
            ),
          );
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── processes ────────────────────────────────────────────────
program
  .command("processes")
  .description("List all processes with their steps")
  .argument("<model>", "Path to world model JSON")
  .option("--json", "Output as JSON array")
  .action(
    async (modelPath: string, opts: Record<string, boolean | undefined>) => {
      try {
        const model = await readModel(modelPath);
        if (opts.json) {
          console.log(JSON.stringify(model.processes, null, 2));
          return;
        }
        if (model.processes.length === 0) {
          console.log(chalk.gray("  No processes in this model."));
          return;
        }
        for (const proc of model.processes) {
          console.log(chalk.bold(`  ${proc.name}`));
          console.log(chalk.gray(`  ${proc.description}`));
          if (proc.trigger)
            console.log(chalk.gray(`  Trigger: ${proc.trigger}`));
          console.log("");
          for (const step of proc.steps) {
            const actor = step.actor
              ? (model.entities.find((e) => e.id === step.actor)?.name ?? "?")
              : "system";
            console.log(
              `    ${step.order}. ${chalk.cyan(actor)}: ${step.action}`,
            );
          }
          if (proc.outcomes.length > 0) {
            console.log(
              chalk.gray(`\n    Outcomes: ${proc.outcomes.join(", ")}`),
            );
          }
          console.log("");
        }
        console.error(
          chalk.gray(
            `  ${model.processes.length} processes, ${model.processes.reduce((a, p) => a + p.steps.length, 0)} total steps`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── subgraph ─────────────────────────────────────────────────
program
  .command("subgraph")
  .description("Extract a subgraph centered on an entity (zoom in)")
  .argument("<model>", "Path to world model JSON")
  .argument("<entity>", "Entity name to center on")
  .option("-n, --hops <n>", "Max hops from center entity", "2")
  .option("-o, --output <path>", "Write subgraph to file")
  .option(
    "--format <format>",
    "Output format: json, yaml, mermaid, dot",
    "json",
  )
  .action(
    async (
      modelPath: string,
      entityName: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        const entity = findEntity(model, entityName);
        if (!entity) {
          console.error(chalk.red(`Entity "${entityName}" not found.`));
          process.exit(1);
        }
        const hops = parseInt(opts.hops ?? "2", 10) || 2;
        const sub = subgraph(model, entity.id, hops);
        const output = formatOutput(sub, opts.format ?? "json", true);

        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(chalk.green(`✓ Subgraph written to ${opts.output}`));
        } else {
          console.log(output);
        }
        console.error(
          chalk.gray(
            `  ${sub.entities.length} entities, ${sub.relations.length} relations within ${hops} hops of "${entity.name}"`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── fix ──────────────────────────────────────────────────────
program
  .command("fix")
  .description(
    "Auto-fix validation issues (remove orphans, dangling refs, duplicates)",
  )
  .argument("<model>", "Path to world model JSON")
  .option(
    "-o, --output <path>",
    "Write fixed model to file (default: overwrite input)",
  )
  .option("--dry-run", "Show what would be fixed without writing")
  .action(
    async (
      modelPath: string,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        const { fixWorldModel } = await import("./utils/fix.js");
        const { model: fixed, fixes } = fixWorldModel(model);

        if (fixes.length === 0) {
          console.log(chalk.green("  No issues to fix."));
          return;
        }

        console.log(chalk.blue("■ Fixes applied:\n"));
        for (const fix of fixes) console.log(chalk.yellow(`  ✓ ${fix}`));

        console.log(
          chalk.gray(
            `\n  Before: ${model.entities.length} entities, ${model.relations.length} relations`,
          ),
        );
        console.log(
          chalk.gray(
            `  After:  ${fixed.entities.length} entities, ${fixed.relations.length} relations`,
          ),
        );

        if (opts.dryRun) {
          console.log(chalk.gray("\n  (dry run — no files written)"));
          return;
        }

        const outPath = (opts.output as string) ?? modelPath;
        writeFileSync(
          resolve(outPath),
          JSON.stringify(fixed, null, 2),
          "utf-8",
        );
        console.log(chalk.green(`\n  ✓ Written to ${outPath}`));
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── constraints ──────────────────────────────────────────────
program
  .command("constraints")
  .description("List all constraints with scoped entities")
  .argument("<model>", "Path to world model JSON")
  .option("-s, --severity <severity>", "Filter by severity: hard or soft")
  .option("--json", "Output as JSON array")
  .action(
    async (
      modelPath: string,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        let constraints = model.constraints;
        if (opts.severity) {
          constraints = constraints.filter((c) => c.severity === opts.severity);
        }
        if (opts.json) {
          console.log(JSON.stringify(constraints, null, 2));
          return;
        }
        if (constraints.length === 0) {
          console.log(chalk.gray("  No constraints in this model."));
          return;
        }
        for (const c of constraints) {
          const icon =
            c.severity === "hard" ? chalk.red("■") : chalk.yellow("□");
          const scopeNames = c.scope
            .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
            .join(", ");
          console.log(
            `  ${icon} ${chalk.bold(c.name)} ${chalk.gray(`[${c.severity}]`)}`,
          );
          console.log(chalk.white(`    ${c.description}`));
          if (scopeNames)
            console.log(chalk.gray(`    Applies to: ${scopeNames}`));
        }
        const hard = constraints.filter((c) => c.severity === "hard").length;
        const soft = constraints.filter((c) => c.severity === "soft").length;
        console.error(
          chalk.gray(
            `\n  ${constraints.length} constraints (${hard} hard, ${soft} soft)`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── search ───────────────────────────────────────────────────
program
  .command("search")
  .description("Full-text search across all elements of a world model")
  .argument("<model>", "Path to world model JSON")
  .argument("<query>", "Search term (case-insensitive)")
  .action(async (modelPath: string, query: string) => {
    try {
      const model = await readModel(modelPath);
      const q = query.toLowerCase();
      let found = 0;

      const matchingEntities = model.entities.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      );
      if (matchingEntities.length > 0) {
        console.log(chalk.blue(`\n  Entities (${matchingEntities.length}):`));
        for (const e of matchingEntities) {
          console.log(
            `    [${e.type}] ${chalk.bold(e.name)}: ${e.description}`,
          );
        }
        found += matchingEntities.length;
      }

      const matchingRelations = model.relations.filter((r) => {
        const src = model.entities.find((e) => e.id === r.source)?.name ?? "";
        const tgt = model.entities.find((e) => e.id === r.target)?.name ?? "";
        return (
          r.label.toLowerCase().includes(q) ||
          r.type.includes(q) ||
          src.toLowerCase().includes(q) ||
          tgt.toLowerCase().includes(q)
        );
      });
      if (matchingRelations.length > 0) {
        console.log(chalk.blue(`\n  Relations (${matchingRelations.length}):`));
        for (const r of matchingRelations) {
          const src =
            model.entities.find((e) => e.id === r.source)?.name ?? r.source;
          const tgt =
            model.entities.find((e) => e.id === r.target)?.name ?? r.target;
          console.log(`    ${src} —[${r.type}]→ ${tgt}: ${r.label}`);
        }
        found += matchingRelations.length;
      }

      const matchingProcesses = model.processes.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.steps.some((s) => s.action.toLowerCase().includes(q)),
      );
      if (matchingProcesses.length > 0) {
        console.log(chalk.blue(`\n  Processes (${matchingProcesses.length}):`));
        for (const p of matchingProcesses) {
          console.log(`    ${chalk.bold(p.name)}: ${p.description}`);
        }
        found += matchingProcesses.length;
      }

      const matchingConstraints = model.constraints.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      );
      if (matchingConstraints.length > 0) {
        console.log(
          chalk.blue(`\n  Constraints (${matchingConstraints.length}):`),
        );
        for (const c of matchingConstraints) {
          console.log(
            `    [${c.severity}] ${chalk.bold(c.name)}: ${c.description}`,
          );
        }
        found += matchingConstraints.length;
      }

      if (found === 0) {
        console.log(chalk.gray(`  No matches for "${query}".`));
      } else {
        console.error(chalk.gray(`\n  ${found} matches for "${query}"`));
      }
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── clusters ─────────────────────────────────────────────────
program
  .command("clusters")
  .description("Find natural clusters (connected components) in a world model")
  .argument("<model>", "Path to world model JSON")
  .option("--json", "Output as JSON array")
  .action(
    async (modelPath: string, opts: Record<string, boolean | undefined>) => {
      try {
        const model = await readModel(modelPath);
        const clusters = findClusters(model);

        if (opts.json) {
          console.log(
            JSON.stringify(
              clusters.map((c) => ({
                name: c.name,
                entities: c.entities.map((e) => e.name),
                internalRelations: c.internalRelations,
                externalRelations: c.externalRelations,
              })),
              null,
              2,
            ),
          );
          return;
        }

        if (clusters.length === 0) {
          console.log(chalk.gray("  No entities to cluster."));
          return;
        }

        console.log(
          chalk.blue(
            `■ ${clusters.length} cluster${clusters.length > 1 ? "s" : ""} found\n`,
          ),
        );
        for (const cluster of clusters) {
          console.log(
            chalk.bold(
              `  ${cluster.name} (${cluster.entities.length} entities)`,
            ),
          );
          console.log(
            chalk.gray(
              `    Internal relations: ${cluster.internalRelations} | External: ${cluster.externalRelations}`,
            ),
          );
          for (const e of cluster.entities) {
            console.log(`    - [${e.type}] ${e.name}`);
          }
          console.log("");
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── transform ────────────────────────────────────────────────
program
  .command("transform")
  .description("Apply a natural language transformation to a world model")
  .argument("<model>", "Path to world model JSON")
  .argument("<instruction>", "What to change (natural language)")
  .option("-o, --output <path>", "Write transformed model to file")
  .action(
    async (
      modelPath: string,
      instruction: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        console.error(chalk.blue("■ Transforming world model"));
        console.error(chalk.gray(`  Instruction: ${instruction}\n`));

        const { transformWorldModel } = await import("./agents/transform.js");
        const { model: transformed, changes } = await transformWorldModel(
          model,
          instruction,
        );

        if (changes.length === 0) {
          console.error(chalk.yellow("  No changes applied."));
        } else {
          for (const c of changes) console.error(chalk.yellow(`  ✓ ${c}`));
        }

        console.error(
          chalk.gray(
            `\n  Before: ${model.entities.length} entities, ${model.relations.length} relations`,
          ),
        );
        console.error(
          chalk.gray(
            `  After:  ${transformed.entities.length} entities, ${transformed.relations.length} relations`,
          ),
        );

        const output = JSON.stringify(transformed, null, 2);
        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          console.error(chalk.green(`\n  ✓ Written to ${opts.output}`));
        } else {
          console.log(output);
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── stats ────────────────────────────────────────────────────
program
  .command("stats")
  .description("Quick dashboard comparing one or more world models")
  .argument("<models...>", "Paths to world model JSON files")
  .action(async (modelPaths: string[]) => {
    try {
      const pad = (s: string, n: number) =>
        s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

      const { validationAgent: va } = await import("./agents/validation.js");

      console.log(chalk.blue("■ World Model Dashboard\n"));
      console.log(
        chalk.gray(
          `  ${pad("Model", 30)} ${pad("Ent", 6)} ${pad("Rel", 6)} ${pad("Proc", 6)} ${pad("Cstr", 6)} ${pad("Conf", 6)} ${pad("Score", 6)}`,
        ),
      );
      console.log(chalk.gray("  " + "─".repeat(72)));

      for (const p of modelPaths) {
        const model = await readModel(p);
        const { validation } = await va({
          input: { raw: "", sourceType: "text" },
          worldModel: model,
        });
        const name =
          model.name.length > 28 ? model.name.slice(0, 27) + "…" : model.name;
        const conf =
          model.metadata?.confidence !== undefined
            ? `${Math.round(model.metadata.confidence * 100)}%`
            : "—";
        const scoreStr =
          validation.score !== undefined ? `${validation.score}` : "—";
        console.log(
          `  ${pad(name, 30)} ${pad(String(model.entities.length), 6)} ${pad(String(model.relations.length), 6)} ${pad(String(model.processes.length), 6)} ${pad(String(model.constraints.length), 6)} ${pad(conf, 6)} ${pad(scoreStr, 6)}`,
        );
      }
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── help ─────────────────────────────────────────────────────
program
  .command("help")
  .description("Show grouped command reference")
  .action(() => {
    const g = chalk.gray;
    const b = chalk.bold;
    const c = chalk.cyan;
    console.log(b("\n  Structured World Model — Command Reference\n"));
    console.log(b("  Build"));
    console.log(
      `    ${c("model")} [input]         Build a world model from text, file, URL, or stdin`,
    );
    console.log(
      `    ${c("refine")} <model> [input] Incrementally refine with new input`,
    );
    console.log(
      `    ${c("transform")} <model> <instruction>  Apply natural language transformation`,
    );
    console.log("");
    console.log(b("  Inspect"));
    console.log(
      `    ${c("inspect")} <model>        Stats, entity lookup, graph export`,
    );
    console.log(
      `    ${c("summary")} <model>        One-line natural language summary`,
    );
    console.log(
      `    ${c("entities")} <model>       List entities (filterable by type)`,
    );
    console.log(
      `    ${c("relations")} <model>      List relations (filterable by type)`,
    );
    console.log(`    ${c("processes")} <model>      List processes with steps`);
    console.log(
      `    ${c("constraints")} <model>    List constraints with scoped entities`,
    );
    console.log(
      `    ${c("search")} <model> <query> Full-text search across all elements`,
    );
    console.log(
      `    ${c("clusters")} <model>       Find natural entity groups`,
    );
    console.log(
      `    ${c("subgraph")} <model> <entity>  Extract neighborhood around an entity`,
    );
    console.log(
      `    ${c("validate")} <model>       Full integrity check (exits 1 on errors)`,
    );
    console.log(
      `    ${c("fix")} <model>            Auto-fix validation issues`,
    );
    console.log(
      `    ${c("impact")} <model> <entity>  What breaks if you remove an entity`,
    );
    console.log(
      `    ${c("stats")} <models...>      Multi-model comparison table with scores`,
    );
    console.log(
      `    ${c("schema")}                 Output WorldModel JSON Schema`,
    );
    console.log("");
    console.log(b("  Compose"));
    console.log(
      `    ${c("merge")} <a> <b>          Union two models (dedup entities)`,
    );
    console.log(
      `    ${c("diff")} <before> <after>  What changed between two models`,
    );
    console.log(
      `    ${c("compare")} <a> <b>        Find semantic conflicts (type/severity disagreements)`,
    );
    console.log(
      `    ${c("intersect")} <a> <b>      Entities shared by both models`,
    );
    console.log(
      `    ${c("subtract")} <a> <b>       Entities in A but not in B`,
    );
    console.log(
      `    ${c("overlay")} <base> <lens>  Apply constraints/relations from lens onto base`,
    );
    console.log(
      `    ${c("coverage")} <ref> <target>  How much of ref is covered by target`,
    );
    console.log("");
    console.log(b("  Track"));
    console.log(
      `    ${c("snapshot")} <model>       Add to timeline (auto-diffs from previous)`,
    );
    console.log(
      `    ${c("history")} <timeline>     Show evolution or entity history`,
    );
    console.log("");
    console.log(b("  Export"));
    console.log(
      `    ${c("export")} <model> --as <fmt>  Export as claude-md, system-prompt, or mcp`,
    );
    console.log(
      `    ${c("mcp-config")} <model>     Generate MCP client config snippet`,
    );
    console.log("");
    console.log(b("  Serve"));
    console.log(
      `    ${c("serve")} <model>          Start MCP server with 9 live queryable tools`,
    );
    console.log("");
    console.log(b("  Query"));
    console.log(
      `    ${c("query")} <model> <question>  Natural language queries (10 graph patterns + LLM)`,
    );
    console.log("");
    console.log(
      g(
        "  All commands accepting <model> support - for stdin: cat m.json | swm summary -",
      ),
    );
    console.log(g("  Use swm <command> --help for detailed options\n"));
  });

// ─── impact ───────────────────────────────────────────────────
program
  .command("impact")
  .description("Analyze what breaks if an entity is removed")
  .argument("<model>", "Path to world model JSON")
  .argument("<entity>", "Entity name to analyze")
  .option("--json", "Output as JSON")
  .action(
    async (
      modelPath: string,
      entityName: string,
      opts: Record<string, boolean | undefined>,
    ) => {
      try {
        const model = await readModel(modelPath);
        const entity = findEntity(model, entityName);
        if (!entity) {
          console.error(chalk.red(`Entity "${entityName}" not found.`));
          process.exit(1);
        }

        const result = analyzeImpact(model, entity.id);
        if (!result) {
          console.error(chalk.red("Analysis failed."));
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const sevColor =
          result.severity === "critical"
            ? chalk.red
            : result.severity === "high"
              ? chalk.red
              : result.severity === "medium"
                ? chalk.yellow
                : chalk.green;
        console.log(
          chalk.blue(`■ Impact Analysis: removing "${entity.name}"\n`),
        );
        console.log(sevColor(`  Severity: ${result.severity.toUpperCase()}\n`));

        if (result.brokenRelations.length > 0) {
          console.log(
            chalk.gray(
              `  Broken relations (${result.brokenRelations.length}):`,
            ),
          );
          for (const r of result.brokenRelations) {
            const src =
              model.entities.find((e) => e.id === r.source)?.name ?? r.source;
            const tgt =
              model.entities.find((e) => e.id === r.target)?.name ?? r.target;
            console.log(`    ${src} —[${r.type}]→ ${tgt}`);
          }
        }
        if (result.dependents.length > 0) {
          console.log(
            chalk.gray(`\n  Dependents (${result.dependents.length}):`),
          );
          for (const d of result.dependents)
            console.log(`    ${d.name} (${d.type})`);
        }
        if (result.affectedProcesses.length > 0) {
          console.log(
            chalk.gray(
              `\n  Affected processes (${result.affectedProcesses.length}):`,
            ),
          );
          for (const ap of result.affectedProcesses)
            console.log(`    ${ap.process.name} (${ap.role})`);
        }
        if (result.affectedConstraints.length > 0) {
          console.log(
            chalk.gray(
              `\n  Affected constraints (${result.affectedConstraints.length}):`,
            ),
          );
          for (const c of result.affectedConstraints)
            console.log(`    [${c.severity}] ${c.name}`);
        }
        console.log(chalk.gray(`\n  ${result.summary}`));
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── compare ──────────────────────────────────────────────────
program
  .command("compare")
  .description("Find semantic conflicts between two models of the same domain")
  .argument("<modelA>", "Path to first world model JSON")
  .argument("<modelB>", "Path to second world model JSON")
  .option("--json", "Output as JSON")
  .action(
    async (
      pathA: string,
      pathB: string,
      opts: Record<string, boolean | undefined>,
    ) => {
      try {
        const a = await readModel(pathA);
        const b = await readModel(pathB);
        const { compare } = await import("./utils/compare.js");
        const result = compare(a, b);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(
          chalk.blue(`■ Semantic Comparison: ${a.name} vs ${b.name}\n`),
        );
        console.log(`  ${result.summary}\n`);

        if (result.conflicts.length > 0) {
          for (const c of result.conflicts) {
            console.log(
              chalk.yellow(`  ✗ ${c.kind.replace(/_/g, " ")}: ${c.element}`),
            );
            console.log(chalk.gray(`    ${a.name}: ${c.modelA}`));
            console.log(chalk.gray(`    ${b.name}: ${c.modelB}`));
          }
        }
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    },
  );

// ─── mcp-config ───────────────────────────────────────────────
program
  .command("mcp-config")
  .description(
    "Generate MCP client config snippet for Claude Desktop / VS Code",
  )
  .argument("<model>", "Path to world model JSON")
  .action(async (modelPath: string) => {
    try {
      const absModel = resolve(modelPath);
      if (!existsSync(absModel)) {
        console.error(chalk.red(`File not found: ${absModel}`));
        process.exit(1);
      }
      const model = await readModel(modelPath);
      const serverName = `swm-${model.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")}`;

      const config = {
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["tsx", resolve("src/cli.ts"), "serve", absModel],
          },
        },
      };

      console.log(chalk.blue(`■ MCP Configuration for "${model.name}"\n`));
      console.log(
        chalk.gray(
          "  Add to claude_desktop_config.json or .vscode/mcp.json:\n",
        ),
      );
      console.log(JSON.stringify(config, null, 2));
      console.log(chalk.gray(`\n  Server: ${serverName}`));
      console.log(
        chalk.gray(
          `  Tools: get_entity, get_relations, find_path, get_process, check_constraint, query, get_stats, get_diagram, analyze_impact`,
        ),
      );
      console.log(
        chalk.gray(
          `  Model: ${model.entities.length} entities, ${model.relations.length} relations`,
        ),
      );
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

program.parse();
