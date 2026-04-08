import { randomUUID } from "node:crypto";
import { generatePostcode } from "@swm/provenance";
import type { IntentGraph } from "@swm/compiler";
import type { ElicitationStore } from "./store.js";
import type { HandoffRecord } from "./types.js";

export class HandoffEmitter {
  constructor(private readonly store: ElicitationStore) {}

  // ─── emitHandoff ───
  // Produces the final HandoffRecord. May only be called when:
  //   - session.status = ready_for_handoff
  //   - assessment.compilationReady = true
  //   - assessment.terminationSignalEmitted = true
  // The HandoffRecord is immutable once created.
  emitHandoff(
    sessionId: string,
    assessmentId: string,
    finalIntentGraph: IntentGraph,
  ): HandoffRecord {
    // Idempotency: if a HandoffRecord already exists for this session, reject
    for (const hr of this.store.handoffs.values()) {
      if (hr.sessionId === sessionId) {
        throw new Error(
          `Duplicate handoff attempted for session ${sessionId}. ` +
            `Existing handoffId: ${hr.handoffId}`,
        );
      }
    }

    const assessment = this.store.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error(`Assessment not found: ${assessmentId}`);
    }
    if (!assessment.compilationReady) {
      throw new Error(
        `Cannot emit handoff: assessment ${assessmentId} is not compilationReady`,
      );
    }
    if (!assessment.terminationSignalEmitted) {
      throw new Error(
        `Cannot emit handoff: assessment ${assessmentId} has not emitted terminationSignal`,
      );
    }

    // Invariant: finalIntentGraph must have rawIntent
    if (
      !finalIntentGraph.rawIntent ||
      finalIntentGraph.rawIntent.trim().length === 0
    ) {
      throw new Error(
        "HandoffRecord invariant violated: finalIntentGraph.rawIntent must be non-empty",
      );
    }

    const turnCount = this.store.getTurnCount(sessionId);
    const postcode = generatePostcode(
      "ELI",
      sessionId + assessmentId + finalIntentGraph.rawIntent,
    );

    const handoff: HandoffRecord = Object.freeze({
      handoffId: randomUUID(),
      sessionId,
      assessmentId,
      finalIntentGraph,
      postcode,
      targetPipelineStage: "INT\u2192GOV",
      emittedAt: Date.now(),
      turnCount,
    });

    this.store.handoffs.set(handoff.handoffId, handoff);

    // Transition session to handed_off
    const session = this.store.sessions.get(sessionId);
    if (session) {
      session.status = "handed_off";
      session.terminatedAt = Date.now();
      session.handoffId = handoff.handoffId;
    }

    return handoff;
  }

  // ─── getHandoffRecord ───
  getHandoffRecord(handoffId: string): HandoffRecord {
    const record = this.store.handoffs.get(handoffId);
    if (!record) throw new Error(`HandoffRecord not found: ${handoffId}`);
    return record;
  }
}
