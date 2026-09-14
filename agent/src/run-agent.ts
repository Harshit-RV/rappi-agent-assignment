import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs } from 'ai';
import config from './config/index.js';
import { AgentRunSummary, RunAgentOptions } from './types.js';
import { PURCHASING_SYSTEM_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 20;
const MAX_WALL_CLOCK_MS = 3 * 60 * 1000;

type EscalationSignal = { reason: string; context?: string };

function asEscalationSignal(output: unknown): EscalationSignal | undefined {
  if (
    output &&
    typeof output === 'object' &&
    'escalate' in output &&
    (output as { escalate?: unknown }).escalate === true
  ) {
    const { reason, context } = output as { reason?: string; context?: string };
    return { reason: reason ?? 'Escalated to buyer.', context };
  }
  return undefined;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunSummary> {
  const startedAt = Date.now();

  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is missing. Copy .env.example to .env and set it.');
  }

  if (!options.tools) {
    throw new Error(
      'tools are required. Pass createPurchasingTools(store) or use runPurchasingScenario().'
    );
  }

  if (!options.resume && !options.prompt) {
    throw new Error('Either prompt (fresh run) or resume (continue a paused run) is required.');
  }

  let timedOut = false;
  let escalation: EscalationSignal | undefined;

  const controller = new AbortController();

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_WALL_CLOCK_MS);

  try {
    const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });

    const messages = options.resume
      ? [
          ...options.resume.messages,
          {
            role: 'tool' as const,
            content: [
              {
                type: 'tool-approval-response' as const,
                approvalId: options.resume.approvalResponse.approvalId,
                toolCall: options.resume.approvalResponse.toolCall,
                approved: options.resume.approvalResponse.approved,
                reason: options.resume.approvalResponse.reason,
              },
            ],
          },
        ]
      : undefined;

    const result = await generateText({
      model: anthropic(config.anthropicModel),
      instructions: options.instructions ?? PURCHASING_SYSTEM_PROMPT,
      ...(messages ? { messages } : { prompt: options.prompt! }),
      tools: options.tools,
      stopWhen: stepCountIs(MAX_ITERATIONS),
      abortSignal: controller.signal,

      toolApproval: options.toolApproval,

      onToolExecutionStart: async ({ toolCall }) => {
        await options.on?.onToolCall?.({
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          args: 'input' in toolCall ? toolCall.input : undefined,
        });
      },

      onToolExecutionEnd: async ({ toolCall, toolOutput, toolExecutionMs }) => {
        const isError = toolOutput.type === 'tool-error';

        const content = isError
          ? String(toolOutput.error)
          : typeof toolOutput.output === 'string'
            ? toolOutput.output
            : JSON.stringify(toolOutput.output);

        if (!isError && toolCall.toolName === 'escalate_to_buyer') {
          escalation = asEscalationSignal(toolOutput.output);
          if (escalation) {
            await options.on?.onEscalation?.(escalation);
          }
        }

        await options.on?.onToolResult?.({
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          content,
          isError,
          durationMs: toolExecutionMs,
        });
      },

      onStepEnd: async (step) => {
        if (step.text.trim()) {
          await options.on?.onAssistantMessage?.(step.text);
        }
      },
    });

    if (escalation) {
      const summary: AgentRunSummary = {
        stopReason: 'ESCALATED',
        iterations: result.steps.length,
        durationMs: Date.now() - startedAt,
        finalText: result.text,
        escalation,
      };
      await options.on?.onDone?.(summary);
      return summary;
    }

    // Only the final step can hold a still-pending request — earlier steps'
    // requests are already auto-resolved (paired with a tool-approval-response).
    const finalStepContent = result.finalStep.content;
    const respondedApprovalIds = new Set(
      finalStepContent
        .filter((part) => part.type === 'tool-approval-response')
        .map((part) => part.approvalId)
    );
    const approvalRequest = finalStepContent.find(
      (part) => part.type === 'tool-approval-request' && !respondedApprovalIds.has(part.approvalId)
    );

    if (approvalRequest && approvalRequest.type === 'tool-approval-request') {
      const pendingApproval = {
        approvalId: approvalRequest.approvalId,
        toolCall: approvalRequest.toolCall,
        toolCallId: approvalRequest.toolCall.toolCallId,
        toolName: approvalRequest.toolCall.toolName,
        args: 'input' in approvalRequest.toolCall ? approvalRequest.toolCall.input : undefined,
        reason: approvalRequest.reason ?? 'This action needs human approval before it can run.',
      };

      await options.on?.onApprovalRequested?.(pendingApproval);

      const summary: AgentRunSummary = {
        stopReason: 'AWAITING_APPROVAL',
        iterations: result.steps.length,
        durationMs: Date.now() - startedAt,
        finalText: result.text,
        pendingApproval,
        resumeMessages: result.responseMessages,
      };
      await options.on?.onDone?.(summary);
      return summary;
    }

    const summary: AgentRunSummary = {
      stopReason: result.steps.length >= MAX_ITERATIONS ? 'MAX_ITERATIONS' : 'SUCCESS',
      iterations: result.steps.length,
      durationMs: Date.now() - startedAt,
      finalText: result.text,
    };

    await options.on?.onDone?.(summary);
    return summary;

  } catch (error) {
    if (timedOut) {
      const summary: AgentRunSummary = {
        stopReason: 'TIMEOUT',
        iterations: 0,
        durationMs: Date.now() - startedAt,
        finalText: '',
      };

      await options.on?.onDone?.(summary);
      return summary;
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}
