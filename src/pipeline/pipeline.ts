import type { WorldModelType, ValidationResultType } from "../schema/index.js";

export interface PipelineInput {
  raw: string;
  sourceType: "text" | "document" | "url" | "code" | "conversation" | "mixed";
  name?: string;
}

export interface PipelineStageResult<T> {
  stage: string;
  data: T;
  durationMs: number;
}

export interface PipelineResult {
  worldModel: WorldModelType;
  validation: ValidationResultType;
  stages: PipelineStageResult<unknown>[];
  totalDurationMs: number;
}

export type StageHandler<TIn, TOut> = (input: TIn) => Promise<TOut>;

export interface PipelineStage<TIn = unknown, TOut = unknown> {
  name: string;
  run: StageHandler<TIn, TOut>;
}

export class Pipeline {
  private stages: PipelineStage[] = [];
  private onStageStart?: (name: string) => void;
  private onStageEnd?: (name: string, durationMs: number) => void;

  constructor(options?: {
    onStageStart?: (name: string) => void;
    onStageEnd?: (name: string, durationMs: number) => void;
  }) {
    this.onStageStart = options?.onStageStart;
    this.onStageEnd = options?.onStageEnd;
  }

  addStage<TIn, TOut>(name: string, run: StageHandler<TIn, TOut>): Pipeline {
    this.stages.push({ name, run: run as StageHandler<unknown, unknown> });
    return this;
  }

  async execute(input: PipelineInput): Promise<PipelineResult> {
    const stageResults: PipelineStageResult<unknown>[] = [];
    let current: unknown = input;
    const totalStart = Date.now();

    for (const stage of this.stages) {
      this.onStageStart?.(stage.name);
      const start = Date.now();

      current = await stage.run(current);

      const durationMs = Date.now() - start;
      this.onStageEnd?.(stage.name, durationMs);

      stageResults.push({
        stage: stage.name,
        data: current,
        durationMs,
      });
    }

    const finalResult = current as {
      worldModel: WorldModelType;
      validation: ValidationResultType;
    };

    return {
      worldModel: finalResult.worldModel,
      validation: finalResult.validation,
      stages: stageResults,
      totalDurationMs: Date.now() - totalStart,
    };
  }
}
