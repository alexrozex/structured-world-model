import type { Blueprint } from "@swm/compiler";
import type { ClaudeEvent } from "@swm/orchestrator";
import { writeCheckpoint } from "@swm/orchestrator";
import type { GovernorSignal } from "./signals.js";
import { ConfidenceTracker } from "./confidence.js";
import { evaluateInvariants } from "./drift.js";

export async function* watch(
  blueprint: Blueprint,
  events: AsyncIterable<ClaudeEvent>,
  confidenceThreshold: number = 0.7,
): AsyncGenerator<GovernorSignal> {
  const confidence = new ConfidenceTracker(confidenceThreshold);
  let sessionId = "";
  let hasEmittedConfidence = false;
  let hasEmittedLowConfidence = false;

  try {
    for await (const event of events) {
      sessionId = event.session_id;

      // On PostToolUse — check invariants
      if (event.event.type === "content_block_stop") {
        const toolOutput = JSON.stringify(event.event);
        const drifts = evaluateInvariants(blueprint, toolOutput);

        for (const drift of drifts) {
          confidence.onDrift();
          yield {
            type: "DRIFT",
            severity: drift.severity,
            location: drift.location,
            detail: drift.detail,
          };
        }
      }

      // On SubagentStop — checkpoint + postcondition check
      if (
        event.event.type === "message_stop" &&
        event.parent_tool_use_id !== null
      ) {
        if (!hasEmittedConfidence) {
          hasEmittedConfidence = true;
          yield { type: "CONFIDENCE", value: confidence.current };
        }

        writeCheckpoint({
          sessionId,
          blueprint,
          iterationCount: 0,
          gateHistory: [],
          lastGovernorDecision: null,
          timestamp: Date.now(),
        });

        yield { type: "CHECKPOINT", sessionId, timestamp: Date.now() };
      }

      // Low confidence warning — emit once when threshold is crossed, not on every event
      if (confidence.isLow && !hasEmittedLowConfidence) {
        hasEmittedLowConfidence = true;
        yield {
          type: "LOW_CONFIDENCE",
          confidence: confidence.current,
          reason:
            "Accumulated drift signals reduced confidence below threshold",
        };
      }
    }
  } catch {
    // All errors become DRIFT signals — watch() never throws
    yield {
      type: "DRIFT",
      severity: "critical",
      location: "governor.watch",
      detail: "Event stream error",
    };
  }

  // Session complete
  const finalDecision =
    confidence.current >= 0.8
      ? ("ACCEPT" as const)
      : confidence.current >= 0.5
        ? ("DRIFT" as const)
        : ("HALT" as const);

  yield {
    type: "SESSION_COMPLETE",
    finalConfidence: confidence.current,
    decision: finalDecision,
  };
}
