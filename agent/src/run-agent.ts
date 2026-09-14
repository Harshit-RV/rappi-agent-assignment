import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs } from 'ai';
import config from './config/index.js';
import { AgentRunSummary, RunAgentOptions } from './types.js';
import { PURCHASING_SYSTEM_PROMPT } from './prompt.js';

const MAX_ITERATIONS = 20;
const MAX_WALL_CLOCK_MS = 3 * 60 * 1000;

// Runs the agent loop until it produces a final answer or hits a bound.
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

  let timedOut = false;

  const controller = new AbortController();
  
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_WALL_CLOCK_MS);

  try {
    const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });

    const result = await generateText({
      model: anthropic(config.anthropicModel),
      instructions: options.instructions ?? PURCHASING_SYSTEM_PROMPT,
      prompt: options.prompt,
      tools: options.tools,
      stopWhen: stepCountIs(MAX_ITERATIONS),
      abortSignal: controller.signal,

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
