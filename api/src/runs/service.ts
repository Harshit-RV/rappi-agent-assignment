import { runAgent } from 'agent';
import * as registry from './registry';
import type { CreateRunInput, RunRecord } from './types';

/**
 * Creates a run record and kicks off the agent in the background.
 * Observer callbacks become RunEvents on the registry (and SSE stream).
 */
export function startRun(input: CreateRunInput): RunRecord {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const run = registry.createRun({ prompt });

  // Fire-and-forget: the HTTP response already returned { runId }.
  void runAgent({
    prompt,
    on: {
      onToolCall: (call) => {
        registry.appendEvent(run.id, {
          type: 'tool_call',
          at: Date.now(),
          id: call.id,
          name: call.name,
          args: call.args,
        });
      },
      onToolResult: (result) => {
        registry.appendEvent(run.id, {
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
        registry.appendEvent(run.id, {
          type: 'assistant_message',
          at: Date.now(),
          text,
        });
      },
      onDone: (summary) => {
        registry.appendEvent(run.id, {
          type: 'done',
          at: Date.now(),
          summary,
        });
      },
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    
    registry.appendEvent(run.id, {
      type: 'error',
      at: Date.now(),
      message,
    });
  });

  return run;
}
