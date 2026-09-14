export { runAgent } from './run-agent.js';
export { runPurchasingScenario } from './run-purchasing.js';
export type { RunPurchasingScenarioOptions, RunPurchasingScenarioResult } from './run-purchasing.js';

export {
  PURCHASING_SYSTEM_PROMPT,
  buildScenarioPrompt,
} from './prompt.js';

export { createPurchasingTools } from './tools/purchasing-tools.js';
export type { PurchasingTools } from './tools/purchasing-tools.js';

export type {
  AgentEvents,
  AgentRunSummary,
  RunAgentOptions,
  StopReason,
  ToolCall,
  ToolResult,
} from './types.js';
