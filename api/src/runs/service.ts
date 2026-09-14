import { loadScenarioFile } from 'erp';
import { buildScenarioPrompt, resumePurchasingScenario, runPurchasingScenario } from 'agent';
import type { AgentEvents } from 'agent';
import * as registry from './registry';
import type { CreateRunInput, RunRecord, SubmitDecisionInput } from './types';

// Wires one run's agent callbacks to registry events. Shared by fresh runs
// and resumes so both produce the same event shape on the same run id.
function eventsFor(runId: string): AgentEvents {
  return {
    onToolCall: (call) => {
      registry.appendEvent(runId, {
        type: 'tool_call',
        at: Date.now(),
        id: call.id,
        name: call.name,
        args: call.args,
      });
    },
    onToolResult: (result) => {
      registry.appendEvent(runId, {
        type: 'tool_result',
        at: Date.now(),
        id: result.id,
        name: result.name,
        content: result.content,
        isError: result.isError,
        durationMs: result.durationMs,
      });
    },
    onAssistantMessage: (text) => {
      registry.appendEvent(runId, {
        type: 'assistant_message',
        at: Date.now(),
        text,
      });
    },
    onApprovalRequested: (pending) => {
      registry.appendEvent(runId, {
        type: 'approval_requested',
        at: Date.now(),
        pending,
      });
    },
    onEscalation: (escalation) => {
      registry.appendEvent(runId, {
        type: 'escalation',
        at: Date.now(),
        escalation,
      });
    },
    onDone: (summary) => {
      registry.appendEvent(runId, {
        type: 'done',
        at: Date.now(),
        summary,
      });
    },
  };
}

// Creates a run record and kicks off the purchasing agent in the background.
export function startRun(input: CreateRunInput): RunRecord {
  const scenarioId = input.scenarioId.trim();
  if (!scenarioId) {
    throw new Error('scenarioId is required');
  }

  const scenario = loadScenarioFile(scenarioId);
  const prompt = buildScenarioPrompt(scenario, input.prompt);

  const run = registry.createRun({
    scenarioId: scenario.id,
    prompt,
  });

  void runPurchasingScenario({
    scenarioId: scenario.id,
    prompt: input.prompt,
    on: eventsFor(run.id),
  })
    .then((result) => {
      if (result.summary.stopReason === 'AWAITING_APPROVAL' && result.summary.pendingApproval) {
        registry.setPendingResume(run.id, {
          store: result.store,
          resumeMessages: result.summary.resumeMessages ?? [],
          pendingApproval: result.summary.pendingApproval,
        });
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      registry.appendEvent(run.id, {
        type: 'error',
        at: Date.now(),
        message,
      });
    });

  return run;
}

/**
 * Apply a buyer's decision to a run paused on AWAITING_APPROVAL.
 *
 * Reject ends the run without touching the store — the gate already
 * stopped the write, so there is nothing to undo. Approve resumes the exact
 * same conversation and Store, feeding the decision back in as the tool
 * approval response the SDK's loop expects; the model then sees the outcome
 * and continues (e.g. reporting the executed PO, or reacting further).
 */
export function submitDecision(runId: string, input: SubmitDecisionInput): RunRecord {
  const run = registry.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.status !== 'awaiting_approval' || !run.pendingResume) {
    throw new Error(`Run ${runId} is not awaiting approval (status: ${run.status})`);
  }

  const { store, resumeMessages, pendingApproval } = run.pendingResume;

  registry.appendEvent(runId, {
    type: 'approval_decided',
    at: Date.now(),
    approved: input.approved,
    reason: input.reason,
  });

  if (!input.approved) {
    registry.clearPendingResume(runId);
    registry.markRejected(runId);
    return run;
  }

  registry.clearPendingResume(runId);
  registry.markRunning(runId);

  void resumePurchasingScenario({
    scenarioId: run.scenarioId,
    store,
    messages: resumeMessages,
    approvalResponse: {
      approvalId: pendingApproval.approvalId,
      toolCall: pendingApproval.toolCall,
      approved: true,
      reason: input.reason,
    },
    on: eventsFor(runId),
  })
    .then((result) => {
      if (result.summary.stopReason === 'AWAITING_APPROVAL' && result.summary.pendingApproval) {
        registry.setPendingResume(runId, {
          store: result.store,
          resumeMessages: result.summary.resumeMessages ?? [],
          pendingApproval: result.summary.pendingApproval,
        });
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      registry.appendEvent(runId, {
        type: 'error',
        at: Date.now(),
        message,
      });
    });

  return run;
}
