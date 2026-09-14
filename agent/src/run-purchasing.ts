import { createApprovalGate, createPurchasingTools } from './tools/purchasing-tools.js';
import { loadScenarioFile, loadStore } from 'erp';
import type { Store, Scenario } from 'erp';
import { buildScenarioPrompt, PURCHASING_SYSTEM_PROMPT } from './prompt.js';
import { runAgent } from './run-agent.js';
import type { AgentEvents, AgentRunSummary, ApprovalResponse } from './types.js';
import type { ModelMessage } from 'ai';

export type RunPurchasingScenarioOptions = {
  scenarioId: string;
  // Extra buyer instructions appended to the scenario prompt
  prompt?: string;
  on?: AgentEvents;
};

export type ResumePurchasingScenarioOptions = {
  scenarioId: string;
  // Same Store instance the run paused on.
  store: Store;
  messages: ModelMessage[];
  approvalResponse: ApprovalResponse;
  on?: AgentEvents;
};

export type RunPurchasingScenarioResult = {
  summary: AgentRunSummary;
  scenario: Scenario;
  // Isolated store used for this run (includes any POs the agent created)
  store: Store;
};

// Load a scenario, bind purchasing tools to a fresh Store, and run the agent
export async function runPurchasingScenario(
  options: RunPurchasingScenarioOptions
): Promise<RunPurchasingScenarioResult> {
  const scenario = loadScenarioFile(options.scenarioId);
  const store = loadStore(options.scenarioId);
  const prompt = buildScenarioPrompt(scenario, options.prompt);
  const tools = createPurchasingTools(store);

  const summary = await runAgent({
    prompt,
    instructions: PURCHASING_SYSTEM_PROMPT,
    tools,
    toolApproval: createApprovalGate(store),
    on: options.on,
  });

  return { summary, scenario, store };
}

export async function resumePurchasingScenario(
  options: ResumePurchasingScenarioOptions
): Promise<Omit<RunPurchasingScenarioResult, 'scenario'>> {
  const tools = createPurchasingTools(options.store);

  const summary = await runAgent({
    instructions: PURCHASING_SYSTEM_PROMPT,
    tools,
    toolApproval: createApprovalGate(options.store),
    resume: {
      messages: options.messages,
      approvalResponse: options.approvalResponse,
    },
    on: options.on,
  });

  return { summary, store: options.store };
}
