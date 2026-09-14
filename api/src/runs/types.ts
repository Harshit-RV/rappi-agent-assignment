import type { AgentRunSummary, ToolCall, ToolResult } from 'agent';

export type RunStatus = 'running' | 'completed' | 'failed';

export type RunEvent =
  | { type: 'tool_call'; at: number; id: string; name: string; args: unknown }
  | {
      type: 'tool_result';
      at: number;
      id: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs: number;
    }
  | { type: 'assistant_message'; at: number; text: string }
  | { type: 'done'; at: number; summary: AgentRunSummary }
  | { type: 'error'; at: number; message: string };

export type RunRecord = {
  id: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  events: RunEvent[];
  summary: AgentRunSummary | null;
  error: string | null;
};

export type CreateRunInput = {
  prompt: string;
};

export type { ToolCall, ToolResult, AgentRunSummary };
