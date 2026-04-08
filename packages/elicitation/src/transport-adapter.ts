import type {
  ClarificationRequestRecord,
  ClarificationAnswerRecord,
  AdaProposal,
  CompilationReadinessAssessment,
  ProposalDisposition,
  SessionCommand,
} from "./types.js";
import type { ElicitationSessionManager } from "./session-manager.js";

// ─── ElicitationTransportAdapter ───
// Defines the port that CLI and MCP transport implementations plug into.
// Does NOT implement transport — concrete subclasses (e.g., CLITransportAdapter,
// MCPTransportAdapter) implement the presentX / collectX methods.
//
// Pattern: subclass and implement the abstract methods to adapt to your transport.
// The drive() method orchestrates the full elicitation dialogue loop.

export abstract class ElicitationTransportAdapter {
  constructor(protected readonly sessionManager: ElicitationSessionManager) {}

  // ─── Abstract port methods ───
  // Implementors must provide concrete transport behavior.

  abstract presentClarificationRequest(
    request: ClarificationRequestRecord,
  ): Promise<void>;

  abstract presentAdaProposal(proposal: AdaProposal): Promise<void>;

  abstract collectUserResponse(): Promise<
    ClarificationAnswerRecord | ProposalDisposition
  >;

  abstract presentReadinessStatus(
    assessment: CompilationReadinessAssessment,
  ): Promise<void>;

  abstract signalSessionCommand(command: SessionCommand): Promise<void>;

  // ─── drive ───
  // Orchestrates the full elicitation dialogue:
  //   1. Start session with raw intent
  //   2. Loop: present question/proposal → collect response → submit
  //   3. Terminate when handoff is emitted or session is abandoned
  async drive(rawIntentText: string): Promise<void> {
    const startResult = await this.sessionManager.startSession(rawIntentText);

    // Fast path: 0-question — classifier determined intent is compilable as-is.
    // Session is already complete; no dialogue loop needed.
    if (startResult.handoff) {
      if (startResult.assessment) {
        await this.presentReadinessStatus(startResult.assessment);
      }
      return;
    }

    // Present first turn
    if (startResult.clarificationRequest) {
      await this.presentClarificationRequest(startResult.clarificationRequest);
    } else if (startResult.proposal) {
      await this.presentAdaProposal(startResult.proposal);
    }

    const sessionId = startResult.session.sessionId;
    // turn is non-null here because we returned early above if handoff was set
    let currentTurnId = startResult.turn!.turnId;

    // Dialogue loop
    while (true) {
      let response: ClarificationAnswerRecord | ProposalDisposition;
      try {
        response = await this.collectUserResponse();
      } catch {
        // Transport error or user abandonment
        this.sessionManager.abandonSession(sessionId, "transport error");
        break;
      }

      // Check for session commands embedded in the response
      if (this._isSessionCommand(response)) {
        const command = response as unknown as { command: SessionCommand };
        await this.signalSessionCommand(command.command);
        if (command.command === "abandon") {
          this.sessionManager.abandonSession(
            sessionId,
            "user requested abandon",
          );
          break;
        }
        if (command.command === "force-handoff") {
          this.sessionManager.transitionState(sessionId, "ready_for_handoff");
          // Fall through — next iteration will attempt handoff
          continue;
        }
      }

      let result;

      if (this._isClarificationAnswer(response)) {
        const answer = response as ClarificationAnswerRecord;
        result = await this.sessionManager.submitAnswer(
          sessionId,
          currentTurnId,
          answer.answer,
        );
      } else {
        const disposition = response as ProposalDisposition;
        result = await this.sessionManager.submitProposalDisposition(
          sessionId,
          disposition.proposalId,
          disposition.disposition,
          disposition.modifiedText,
        );
      }

      // Stall warning — surface to transport
      if (result.stallWarning) {
        await this.presentReadinessStatus({
          assessmentId: "stall",
          sessionId,
          draftId: "",
          schemaConformanceResultId: "",
          openGapCount: -1,
          blockingGapCount: -1,
          contradictionCount: -1,
          compilationReady: false,
          terminationSignalEmitted: false,
          assessedAt: Date.now(),
        });
      }

      if (result.handoff) {
        // Session complete
        if (result.assessment) {
          await this.presentReadinessStatus(result.assessment);
        }
        break;
      }

      if (!result.nextTurn) {
        // No more turns and no handoff — session in assessment limbo
        if (result.assessment) {
          await this.presentReadinessStatus(result.assessment);
        }
        break;
      }

      // Present next question/proposal
      currentTurnId = result.nextTurn.turnId;

      if (result.clarificationRequest) {
        await this.presentClarificationRequest(result.clarificationRequest);
      } else if (result.proposal) {
        await this.presentAdaProposal(result.proposal);
      }
    }
  }

  // ─── helpers ───

  private _isClarificationAnswer(
    r: ClarificationAnswerRecord | ProposalDisposition,
  ): boolean {
    return "clarificationAnswerId" in r;
  }

  private _isSessionCommand(
    r: ClarificationAnswerRecord | ProposalDisposition,
  ): boolean {
    return "command" in r;
  }
}
