/**
 * End-to-end smoke: load a scenario and run the purchasing agent.
 * Requires ANTHROPIC_API_KEY (agent/.env or api/.env with cwd set appropriately).
 *
 *   yarn smoke:scenario
 *   yarn smoke:scenario s1-recommendation-review
 */
import { runPurchasingScenario } from '../src/index.js';

function truncate(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

async function main() {
  const scenarioId = process.argv[2] ?? 's1-recommendation-review';

  console.log(`=== Scenario: ${scenarioId} ===\n=== Agent trace ===`);

  const { summary, scenario, store } = await runPurchasingScenario({
    scenarioId,
    on: {
      onToolCall: (call) =>
        console.log(`  -> ${call.name}`, truncate(JSON.stringify(call.args), 160)),
      onToolResult: (result) =>
        console.log(
          `  <- ${result.name} ${result.isError ? 'ERROR' : 'ok'} (${result.durationMs}ms) ${truncate(result.content)}`
        ),
      onAssistantMessage: (text) => console.log(`  [assistant] ${truncate(text, 400)}`),
    },
  });

  console.log('\n=== Run summary ===');
  console.log(`Stop reason: ${summary.stopReason}`);
  console.log(`Iterations:  ${summary.iterations}`);
  console.log(`Duration:    ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`\nFinal answer:\n${summary.finalText}`);

  const open = store.listOpenPurchaseOrders(
    scenario.situation.productId,
    scenario.situation.nodeId
  );
  console.log('\n=== Open POs after run ===');
  console.log(JSON.stringify(open, null, 2));

  if (summary.stopReason !== 'SUCCESS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
