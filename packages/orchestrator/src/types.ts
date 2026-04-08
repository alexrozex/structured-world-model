import type { Blueprint, GovernorDecision, ProvenanceGate } from "@swm/compiler";

export interface SpawnConfig {
  readonly workingDir: string;
  readonly blueprintSummary?: string;
  readonly sessionId?: string;
  readonly outputFormat?: "stream-json" | "text";
}

export interface ClaudeEvent {
  readonly uuid: string;
  readonly session_id: string;
  readonly parent_tool_use_id: string | null;
  readonly event: RawAnthropicEvent;
}

export interface RawAnthropicEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface SessionCheckpoint {
  readonly sessionId: string;
  readonly blueprint: Blueprint;
  readonly iterationCount: number;
  readonly gateHistory: readonly ProvenanceGate[];
  readonly lastGovernorDecision: GovernorDecision | null;
  readonly timestamp: number;
}
