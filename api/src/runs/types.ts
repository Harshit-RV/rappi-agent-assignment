import type { AgentRunSummary, ApprovalResponse, Escalation, PendingApproval, ToolCall, ToolResult } from 'agent';
import type { Store } from 'erp';
import type { ModelMessage } from 'ai';

export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'escalated'
  | 'rejected';

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
  | { type: 'approval_requested'; at: number; pending: PendingApproval }
  | { type: 'approval_decided'; at: number; approved: boolean; reason?: string }
  | { type: 'escalation'; at: number; escalation: Escalation }
  | { type: 'done'; at: number; summary: AgentRunSummary }
  | { type: 'error'; at: number; message: string };

// Server-side only — never sent over SSE.
export type PendingResumeState = {
  store: Store;
  resumeMessages: ModelMessage[];
  pendingApproval: PendingApproval;
};

export type RunRecord = {
  id: string;
  scenarioId: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  events: RunEvent[];
  summary: AgentRunSummary | null;
  error: string | null;
  pendingResume: PendingResumeState | null;
};

export type CreateRunInput = {
  scenarioId: string;
  // Optional extra buyer instructions appended to the scenario prompt.
  prompt?: string;
};

export type SubmitDecisionInput = {
  approved: boolean;
  reason?: string;
};

export type { ToolCall, ToolResult, AgentRunSummary, ApprovalResponse, PendingApproval, Escalation };
