export type PurchasingSituation = {
  productId: string;
  nodeId: string;
  recommendedQuantity: number;
  note?: string;
};

export type ScenarioSummary = {
  id: string;
  name: string;
  description: string;
  situation: PurchasingSituation;
};

export type ScenarioDetail = ScenarioSummary & {
  state: Record<string, unknown>;
};

export type PendingApproval = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  reason: string;
};

export type Escalation = {
  reason: string;
  context?: string;
};

export type AgentRunSummary = {
  stopReason: string;
  iterations: number;
  durationMs: number;
  finalText: string;
  pendingApproval?: PendingApproval;
  escalation?: Escalation;
};

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

export type RunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'escalated'
  | 'rejected';
