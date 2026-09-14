import { createPurchasingTools } from './tools/purchasing-tools.js';
import { loadScenarioFile, loadStore } from 'erp';
import type { Store, Scenario } from 'erp';
import { buildScenarioPrompt, PURCHASING_SYSTEM_PROMPT } from './prompt.js';
import { runAgent } from './run-agent.js';
import type { AgentEvents, AgentRunSummary } from './types.js';

export type RunPurchasingScenarioOptions = {
  scenarioId: string;
  // Extra buyer instructions appended to the scenario prompt
  prompt?: string;
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
    on: options.on,
  });

  return { summary, scenario, store };
}
