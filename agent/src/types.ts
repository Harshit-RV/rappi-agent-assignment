import type { ToolSet } from 'ai';

export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
};

export type ToolResult = {
  // Matches the originating ToolCall's id.
  id: string;
  name: string;
  content: string;
  isError: boolean;
  durationMs: number;
};

export type StopReason = 'SUCCESS' | 'MAX_ITERATIONS' | 'TIMEOUT';

export type AgentRunSummary = {
  stopReason: StopReason;
  iterations: number;
  durationMs: number;
  finalText: string;
};

export type AgentEvents = {
  onAssistantMessage?(text: string): void | Promise<void>;
  onToolCall?(call: ToolCall): void | Promise<void>;
  onToolResult?(result: ToolResult): void | Promise<void>;
  onDone?(summary: AgentRunSummary): void | Promise<void>;
};

export type RunAgentOptions = {
  prompt: string;
  // Defaults to PURCHASING_SYSTEM_PROMPT when omitted.
  instructions?: string;
  // Purchasing tools from createPurchasingTools(store). Required.
  tools: ToolSet;
  on?: AgentEvents;
};
