export type GovernorSignal =
  | { readonly type: "CONFIDENCE"; readonly value: number }
  | { readonly type: "DRIFT"; readonly severity: "critical" | "major" | "minor"; readonly location: string; readonly detail: string }
  | { readonly type: "POSTCONDITION_FAIL"; readonly agent: string; readonly missing: readonly string[] }
  | { readonly type: "LOW_CONFIDENCE"; readonly confidence: number; readonly reason: string }
  | { readonly type: "CAPABILITY_GAP"; readonly description: string; readonly suggestedAgent: SuggestedAgent }
  | { readonly type: "CHECKPOINT"; readonly sessionId: string; readonly timestamp: number }
  | { readonly type: "SESSION_COMPLETE"; readonly finalConfidence: number; readonly decision: "ACCEPT" | "DRIFT" | "HALT" };

export interface SuggestedAgent {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
}
