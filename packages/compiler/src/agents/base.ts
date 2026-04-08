import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ZodSchema, ZodError } from "zod";
import type { ModelId } from "../models.js";
import type {
  CompilerStageCode,
  Challenge,
  DeterminismMetadata,
  TokenUsage,
} from "../types.js";
import type { PostcodeAddress } from "@swm/provenance";
import { generatePostcode, type StageCode } from "@swm/provenance";
import type {
  CodebaseContext,
  PriorBlueprintContext,
} from "../context/types.js";
import { decorateWithContext } from "../context/prompt-decorator.js";

export interface AgentResult<T> {
  readonly output: T;
  readonly postcode: PostcodeAddress;
  readonly challenges: readonly Challenge[];
  readonly parseFailure: boolean;
  readonly metadata: DeterminismMetadata;
}

export interface AgentCallbacks {
  readonly onToken?: ((token: string) => void) | undefined;
  readonly onComplete?: ((fullText: string) => void) | undefined;
}

function extractJSON(text: string): string | null {
  const fenced = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith("{")) return candidate;
  }
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    const candidate = text.slice(braceStart, braceEnd + 1);
    const afterBrace = candidate.slice(1).trimStart();
    if (afterBrace.startsWith('"')) return candidate;
  }
  return null;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = normalizeKeys(value);
    }
    return result;
  }
  return obj;
}

function debugLog(stage: string, message: string, data?: unknown): void {
  try {
    fs.mkdirSync(".ada", { recursive: true });
    const entry = `[${new Date().toISOString()}] ${message}\n${data !== undefined ? JSON.stringify(data, null, 2).slice(0, 2000) + "\n" : ""}`;
    fs.appendFileSync(`.ada/debug-${stage.toLowerCase()}.log`, entry);
  } catch {
    /* never crash for logging */
  }
}

function fixAdditionalProperties(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };
  if (result["type"] === "object") {
    result["additionalProperties"] = false;
  }
  if (result["properties"] && typeof result["properties"] === "object") {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      result["properties"] as Record<string, unknown>,
    )) {
      props[key] =
        typeof value === "object" && value !== null
          ? fixAdditionalProperties(value as Record<string, unknown>)
          : value;
    }
    result["properties"] = props;
  }
  if (result["items"] && typeof result["items"] === "object") {
    result["items"] = fixAdditionalProperties(
      result["items"] as Record<string, unknown>,
    );
  }
  if (Array.isArray(result["anyOf"])) {
    result["anyOf"] = (result["anyOf"] as unknown[]).map((v) =>
      typeof v === "object" && v !== null
        ? fixAdditionalProperties(v as Record<string, unknown>)
        : v,
    );
  }
  if (Array.isArray(result["allOf"])) {
    result["allOf"] = (result["allOf"] as unknown[]).map((v) =>
      typeof v === "object" && v !== null
        ? fixAdditionalProperties(v as Record<string, unknown>)
        : v,
    );
  }
  return result;
}

function getApiKey(): string | undefined {
  return process.env["ANTHROPIC_API_KEY"];
}
function isApiMode(): boolean {
  return !!process.env["ANTHROPIC_API_KEY"];
}

export abstract class Agent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly stageCode: CompilerStageCode;
  abstract readonly model: ModelId;
  abstract readonly lens: string;

  private _codebaseContext: CodebaseContext | null = null;
  private _priorBlueprint: PriorBlueprintContext | null = null;

  setCodebaseContext(ctx: CodebaseContext): void {
    this._codebaseContext = ctx;
  }

  setPriorBlueprint(prior: PriorBlueprintContext): void {
    this._priorBlueprint = prior;
  }

  protected abstract buildPrompt(input: TInput): string;
  protected abstract getSchema(): ZodSchema;
  protected abstract getDefaultOutput(input: TInput): TOutput;

  protected get useExtendedThinking(): boolean {
    return false;
  }

  // ─── API path: stream reasoning (glass box), then extract JSON ───
  // If text extraction fails, fall back to a structured output call.
  private async callAPI(
    prompt: string,
    callbacks?: AgentCallbacks,
  ): Promise<{
    parsed: TOutput | null;
    reasoning: string;
    error?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
  }> {
    const client = new Anthropic({ apiKey: getApiKey()! });
    let reasoning = "";

    // Phase 1: stream with visible reasoning (glass box)
    const stream = client.messages.stream({
      model: this.model,
      max_tokens: 16384,
      messages: [{ role: "user", content: prompt }],
    });

    stream.on("text", (text) => {
      reasoning += text;
      callbacks?.onToken?.(text);
    });

    const finalMsg = await stream.finalMessage();
    callbacks?.onComplete?.(reasoning);

    // Phase 2: try to extract JSON from the reasoning text
    const textResult = this.tryParseText(reasoning);
    if (textResult.success) {
      debugLog(this.stageCode, "TEXT EXTRACTION SUCCESS");
      return { parsed: textResult.parsed, reasoning, usage: finalMsg.usage };
    }

    // Phase 3: fallback — structured output call (no streaming, guaranteed JSON)
    debugLog(
      this.stageCode,
      `TEXT EXTRACTION FAILED: ${textResult.error}, falling back to structured output`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSchema = (zodToJsonSchema as any)(this.getSchema(), {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    const jsonSchema = fixAdditionalProperties(rawSchema);

    try {
      const structured = await client.messages.create({
        model: this.model,
        max_tokens: 16384,
        messages: [{ role: "user", content: prompt }],
        output_config: {
          format: {
            type: "json_schema" as const,
            schema: jsonSchema,
          },
        },
      });

      const textBlock = structured.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const raw = JSON.parse(textBlock.text) as Record<string, unknown>;
        delete raw["postcode"];
        delete raw["rawIntent"];
        const normalized = normalizeKeys(raw) as Record<string, unknown>;
        const result = this.getSchema().parse(normalized) as TOutput;
        debugLog(this.stageCode, "STRUCTURED FALLBACK SUCCESS");
        return { parsed: result, reasoning, usage: finalMsg.usage };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      debugLog(this.stageCode, `STRUCTURED FALLBACK FAILED: ${errMsg}`);
      return { parsed: null, reasoning, error: errMsg, usage: finalMsg.usage };
    }

    return {
      parsed: null,
      reasoning,
      error: "structured fallback produced no content",
      usage: finalMsg.usage,
    };
  }

  // ─── CLI fallback: uses OAuth, streams reasoning tokens via stream-json ───
  private callCLI(prompt: string, callbacks?: AgentCallbacks): Promise<string> {
    return new Promise((resolve) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ada-"));
      const promptFile = path.join(tmpDir, "prompt.txt");
      fs.writeFileSync(promptFile, prompt, "utf8");

      const input = fs.createReadStream(promptFile);
      const proc = spawn(
        "claude",
        [
          "--print",
          "--verbose",
          "--output-format",
          "stream-json",
          "--model",
          this.model,
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ],
        {
          cwd: tmpDir,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let accumulated = "";
      let stderr = "";

      let lineBuffer = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;
            const inner = (event["event"] ?? event) as Record<string, unknown>;
            if (inner["type"] === "assistant") {
              // stream-json --verbose: text lives in message.content[n].text
              const msg = inner["message"] as
                | Record<string, unknown>
                | undefined;
              const content = msg?.["content"] as
                | Array<Record<string, unknown>>
                | undefined;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block["type"] === "text") {
                    const text = String(block["text"] ?? "");
                    if (text) {
                      accumulated += text;
                      callbacks?.onToken?.(text);
                    }
                  }
                }
              }
            }
          } catch {
            // Non-JSON line — ignore (hooks produce non-JSON preamble)
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      input.pipe(proc.stdin);

      proc.on("close", (code) => {
        try {
          fs.unlinkSync(promptFile);
          fs.rmdirSync(tmpDir);
        } catch {
          /* cleanup */
        }
        if (stderr)
          debugLog(
            this.stageCode,
            `CLI stderr (exit ${code}): ${stderr.slice(0, 500)}`,
          );
        if (!accumulated)
          debugLog(this.stageCode, `CLI empty output (exit ${code})`);
        callbacks?.onComplete?.(accumulated);
        resolve(accumulated);
      });

      proc.on("error", (err) => {
        try {
          fs.unlinkSync(promptFile);
          fs.rmdirSync(tmpDir);
        } catch {
          /* cleanup */
        }
        debugLog(this.stageCode, `CLI spawn error: ${err.message}`);
        resolve(accumulated || "");
      });

      setTimeout(() => {
        proc.kill();
        resolve(accumulated || "");
      }, 300_000);
    });
  }

  private tryParseText(rawText: string): {
    parsed: TOutput;
    success: boolean;
    error?: string;
  } {
    const jsonStr = extractJSON(rawText);
    if (!jsonStr) {
      debugLog(this.stageCode, "NO JSON FOUND", rawText.slice(0, 500));
      return {
        parsed: null as TOutput,
        success: false,
        error: "no JSON found",
      };
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch (e) {
      debugLog(this.stageCode, "JSON.parse FAILED", {
        error: String(e),
        json: jsonStr.slice(0, 500),
      });
      return {
        parsed: null as TOutput,
        success: false,
        error: `JSON.parse: ${String(e)}`,
      };
    }

    delete raw["postcode"];
    delete raw["rawIntent"];
    const normalized = normalizeKeys(raw) as Record<string, unknown>;

    try {
      const result = this.getSchema().parse(normalized) as TOutput;
      debugLog(this.stageCode, "PARSE SUCCESS", {
        keys: Object.keys(normalized),
      });
      return { parsed: result, success: true };
    } catch (e) {
      const zodError = e as ZodError;
      const issues =
        zodError.issues
          ?.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ") ?? String(e);
      debugLog(this.stageCode, "ZOD FAILED", {
        issues,
        keys: Object.keys(normalized),
      });
      return { parsed: null as TOutput, success: false, error: issues };
    }
  }

  async run(
    input: TInput,
    callbacks?: AgentCallbacks,
  ): Promise<AgentResult<TOutput>> {
    let prompt = this.buildPrompt(input);
    if (this._codebaseContext) {
      prompt = decorateWithContext(
        prompt,
        this._codebaseContext,
        this.stageCode,
        this._priorBlueprint ?? undefined,
      );
    }
    debugLog(
      this.stageCode,
      `CALLING ${isApiMode() ? "API" : "CLI"} — model: ${this.model}`,
    );

    const startTime = Date.now();
    let retryCount = 0;
    let parsed: TOutput | null = null;
    let parseFailure = false;
    let error: string | undefined;
    let apiUsage: TokenUsage | undefined;

    if (isApiMode()) {
      // ─── API: stream reasoning (glass box) → extract JSON → structured fallback ───
      const result = await this.callAPI(prompt, callbacks);
      parsed = result.parsed;
      error = result.error;
      if (result.usage) {
        apiUsage = {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: result.usage.cache_creation_input_tokens ?? 0,
        };
      }
      if (parsed === null) retryCount++;
      parseFailure = parsed === null;
    } else {
      // ─── CLI fallback: stream-json text extraction ───
      let rawText = await this.callCLI(prompt, callbacks);
      let textResult = this.tryParseText(rawText);
      parsed = textResult.success ? textResult.parsed : null;
      error = textResult.error;

      if (!textResult.success) {
        retryCount++;
        debugLog(this.stageCode, `RETRY — failed: ${error}`);
        const retryPrompt =
          prompt +
          "\n\nIMPORTANT: Return ONLY a valid JSON object inside a ```json code fence. No other text.";
        rawText = await this.callCLI(retryPrompt);
        textResult = this.tryParseText(rawText);
        parsed = textResult.success ? textResult.parsed : null;
        error = textResult.success ? undefined : textResult.error;
      }

      parseFailure = parsed === null;
    }

    if (parseFailure) {
      debugLog(this.stageCode, `FINAL FAILURE: ${error}`);
      parsed = this.getDefaultOutput(input);
    }

    const callDurationMs = Date.now() - startTime;
    const content = JSON.stringify(parsed);
    const postcode = generatePostcode(this.stageCode as StageCode, content);

    const metadata: DeterminismMetadata = {
      modelId: this.model,
      temperature: this.useExtendedThinking ? 1 : 0,
      extendedThinking: this.useExtendedThinking,
      maxTokens: 16384,
      retryCount,
      callDurationMs,
      ...(apiUsage !== undefined ? { tokensUsed: apiUsage } : {}),
    };

    const challenges: Challenge[] = [];
    if (parseFailure) {
      challenges.push({
        id: `${this.stageCode}-parse-failure`,
        description: `${this.name} failed: ${error ?? "unknown"}`,
        severity: "blocking",
        resolved: false,
      });
    }

    return { output: parsed!, postcode, challenges, parseFailure, metadata };
  }
}
