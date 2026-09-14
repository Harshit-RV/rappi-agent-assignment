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

export type AgentRunSummary = {
  stopReason: string;
  iterations: number;
  durationMs: number;
  finalText: string;
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
  | { type: 'done'; at: number; summary: AgentRunSummary }
  | { type: 'error'; at: number; message: string };

export type RunStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed';
