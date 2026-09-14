export { runAgent } from './run-agent.js';
export { runPurchasingScenario, resumePurchasingScenario } from './run-purchasing.js';
export type {
  RunPurchasingScenarioOptions,
  ResumePurchasingScenarioOptions,
  RunPurchasingScenarioResult,
} from './run-purchasing.js';

export {
  PURCHASING_SYSTEM_PROMPT,
  buildScenarioPrompt,
} from './prompt.js';

export { createPurchasingTools, createApprovalGate } from './tools/purchasing-tools.js';
export type { PurchasingTools } from './tools/purchasing-tools.js';

export type {
  AgentEvents,
  AgentRunSummary,
  ApprovalResponse,
  Escalation,
  PendingApproval,
  RunAgentOptions,
  StopReason,
  ToolCall,
  ToolResult,
} from './types.js';
