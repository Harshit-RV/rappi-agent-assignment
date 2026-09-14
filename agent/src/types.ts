import type { ModelMessage, ToolApprovalConfiguration, ToolSet } from 'ai';

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

export type StopReason =
  | 'SUCCESS'
  | 'MAX_ITERATIONS'
  | 'TIMEOUT'
  | 'AWAITING_APPROVAL'
  | 'ESCALATED';

export type PendingApproval = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  reason: string;
  // Round-tripped verbatim into the resume's tool-approval-response.
  toolCall: unknown;
};

export type Escalation = {
  reason: string;
  context?: string;
};

export type AgentRunSummary = {
  stopReason: StopReason;
  iterations: number;
  durationMs: number;
  finalText: string;
  pendingApproval?: PendingApproval;
  escalation?: Escalation;
  resumeMessages?: ModelMessage[];
};

export type AgentEvents = {
  onAssistantMessage?(text: string): void | Promise<void>;
  onToolCall?(call: ToolCall): void | Promise<void>;
  onToolResult?(result: ToolResult): void | Promise<void>;
  onApprovalRequested?(pending: PendingApproval): void | Promise<void>;
  onEscalation?(escalation: Escalation): void | Promise<void>;
  onDone?(summary: AgentRunSummary): void | Promise<void>;
};

// toolCall must be the exact PendingApproval.toolCall for the same approvalId.
export type ApprovalResponse = {
  approvalId: string;
  toolCall: unknown;
  approved: boolean;
  reason?: string;
};

export type RunAgentOptions = {
  // Omit when resuming (pass `resume` instead).
  prompt?: string;
  instructions?: string;
  tools: ToolSet;
  toolApproval?: ToolApprovalConfiguration<ToolSet, never>;
  on?: AgentEvents;
  resume?: {
    messages: ModelMessage[];
    approvalResponse: ApprovalResponse;
  };
};
