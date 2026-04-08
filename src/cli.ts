#!/usr/bin/env node

import { program } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { stringify as yamlStringify } from "yaml";
import { buildWorldModel } from "./swm.js";
import { refineWorldModel } from "./agents/refinement.js";
import { mergeWorldModels, diffWorldModels } from "./utils/merge.js";
import {
  findEntity,
  findDependents,
  toMermaid,
  toDot,
  getStats,
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
import type { Timeline } from "./utils/timeline.js";
import type { PipelineInput } from "./pipeline/index.js";
import type { WorldModelType } from "./schema/index.js";

function detectSourceType(raw: string): PipelineInput["sourceType"] {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return "url";
  if (
    raw.includes("function ") ||
    raw.includes("class ") ||
    raw.includes("import ") ||
    raw.includes("def ") ||
    raw.includes("fn ")
  )
    return "code";
  if (raw.includes("?") && raw.includes(":")) return "conversation";
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

function readModel(path: string): WorldModelType {
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
  return {
    onStageStart: (name: string) => {
      if (!quiet) process.stderr.write(chalk.yellow(`  ▸ ${name}...`));
    },
    onStageEnd: (_name: string, ms: number) => {
      if (!quiet) process.stderr.write(chalk.green(` done (${ms}ms)\n`));
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
  .option("-f, --file <path>", "Read input from file")
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
  .option("--quiet", "Suppress progress output")
  .option(
    "-p, --passes <n>",
    "Number of extraction passes (1=standard, 2-3=deeper)",
    "1",
  )
  .action(
    async (
      inputArg: string | undefined,
      opts: Record<string, string | boolean | undefined>,
    ) => {
      try {
        const raw = readInput(inputArg, opts.file as string | undefined);
        if (!raw.trim()) {
          console.error(chalk.red("Error: No input provided"));
          process.exit(1);
        }

        const sourceType =
          (opts.type as PipelineInput["sourceType"]) || detectSourceType(raw);
        const input: PipelineInput = {
          raw,
          sourceType,
          name:
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
        const result = await buildWorldModel(input, {
          ...stageCallbacks(opts.quiet as boolean),
          passes,
        });
        const output = formatOutput(
          result.worldModel,
          (opts.format as string) ?? "json",
          (opts.pretty as boolean) ?? true,
        );

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
          console.error(chalk.gray(`\n  Total: ${result.totalDurationMs}ms`));
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
        const existing = readModel(modelPath);
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
    (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const a = readModel(pathA);
        const b = readModel(pathB);
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
  .action((beforePath: string, afterPath: string) => {
    try {
      const before = readModel(beforePath);
      const after = readModel(afterPath);
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
    (modelPath: string, opts: Record<string, string | boolean | undefined>) => {
      try {
        const model = readModel(modelPath);

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
  .action(async (file: string) => {
    try {
      const model = readModel(file);

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
        const model = readModel(modelPath);
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
    (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = intersection(readModel(pathA), readModel(pathB));
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
    (
      pathA: string,
      pathB: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = difference(readModel(pathA), readModel(pathB));
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
    (
      basePath: string,
      lensPath: string,
      opts: Record<string, string | undefined>,
    ) => {
      try {
        const result = overlay(readModel(basePath), readModel(lensPath));
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
  .action((modelPath: string, opts: Record<string, string | undefined>) => {
    try {
      const model = readModel(modelPath);
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
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

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
  .action((modelPath: string, opts: Record<string, string | undefined>) => {
    try {
      const model = readModel(modelPath);
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
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

// ─── timeline: history ────────────────────────────────────────
program
  .command("history")
  .description("Show timeline evolution or entity history")
  .argument("<timeline>", "Path to timeline JSON")
  .option("-e, --entity <name>", "Track a specific entity across snapshots")
  .action((tlPath: string, opts: Record<string, string | undefined>) => {
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

program.parse();
