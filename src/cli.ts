#!/usr/bin/env node

import { program } from "commander";
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { stringify as yamlStringify } from "yaml";
import { buildWorldModel } from "./swm.js";
import type { PipelineInput } from "./pipeline/index.js";

function detectSourceType(raw: string): PipelineInput["sourceType"] {
  // Simple heuristics
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

program
  .name("swm")
  .description(
    "Structured World Model — turn anything into a structured world model",
  )
  .version("0.1.0");

program
  .command("model")
  .description("Build a structured world model from input")
  .argument("[input]", "Text input or file path")
  .option("-f, --file <path>", "Read input from file")
  .option("-o, --output <path>", "Write output to file")
  .option(
    "-t, --type <type>",
    "Source type: text, code, document, url, conversation",
  )
  .option("--format <format>", "Output format: json or yaml", "json")
  .option("--pretty", "Pretty-print JSON output", true)
  .option("--quiet", "Suppress progress output")
  .action(
    async (
      inputArg: string | undefined,
      opts: {
        file?: string;
        output?: string;
        type?: string;
        format?: string;
        pretty?: boolean;
        quiet?: boolean;
      },
    ) => {
      try {
        // Resolve input
        let raw: string;
        if (opts.file) {
          raw = readFileSync(resolve(opts.file), "utf-8");
        } else if (inputArg) {
          // Check if it's a file path
          try {
            raw = readFileSync(resolve(inputArg), "utf-8");
          } catch {
            raw = inputArg;
          }
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          raw = Buffer.concat(chunks).toString("utf-8");
        }

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
            opts.file ||
            (inputArg && inputArg.length < 100 ? inputArg : undefined),
        };

        if (!opts.quiet) {
          console.error(chalk.blue("■ Structured World Model"));
          console.error(
            chalk.gray(`  Source: ${sourceType} (${raw.length} chars)\n`),
          );
        }

        const result = await buildWorldModel(input, {
          onStageStart: (name) => {
            if (!opts.quiet) {
              process.stderr.write(chalk.yellow(`  ▸ ${name}...`));
            }
          },
          onStageEnd: (_name, ms) => {
            if (!opts.quiet) {
              process.stderr.write(chalk.green(` done (${ms}ms)\n`));
            }
          },
        });

        // Format output
        let output: string;
        if (opts.format === "yaml") {
          output = yamlStringify(result.worldModel);
        } else {
          output = opts.pretty
            ? JSON.stringify(result.worldModel, null, 2)
            : JSON.stringify(result.worldModel);
        }

        // Write output
        if (opts.output) {
          writeFileSync(resolve(opts.output), output, "utf-8");
          if (!opts.quiet) {
            console.error(chalk.green(`\n  ✓ Written to ${opts.output}`));
          }
        } else {
          console.log(output);
        }

        // Print validation summary
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

program
  .command("validate")
  .description("Validate an existing world model JSON file")
  .argument("<file>", "Path to world model JSON")
  .action((file: string) => {
    try {
      const raw = readFileSync(resolve(file), "utf-8");
      const model = JSON.parse(raw);
      console.log(chalk.blue("■ Validating world model"));
      console.log(
        chalk.gray(
          `  ${model.entities?.length ?? 0} entities, ${model.relations?.length ?? 0} relations`,
        ),
      );
      // Basic structural check
      const required = [
        "id",
        "name",
        "entities",
        "relations",
        "processes",
        "constraints",
      ];
      const missing = required.filter((k) => !(k in model));
      if (missing.length > 0) {
        console.log(
          chalk.red(`  Missing required fields: ${missing.join(", ")}`),
        );
        process.exit(1);
      }
      console.log(chalk.green("  ✓ Structure valid"));
    } catch (err) {
      console.error(
        chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

program.parse();
