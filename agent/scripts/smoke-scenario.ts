/**
 * End-to-end smoke: load a scenario and run the purchasing agent.
 * Requires ANTHROPIC_API_KEY (agent/.env or api/.env with cwd set appropriately).
 *
 *   yarn smoke:scenario
 *   yarn smoke:scenario s1-recommendation-review
 *   yarn smoke:scenario s1-recommendation-review --approve   # auto-approve any pause
 *   yarn smoke:scenario s1-recommendation-review --reject    # auto-reject any pause
 *
 * --force-pause makes the agent submit a plan known to fail validation
 * (S2's 250-unit top-up busts the budget), forcing AWAITING_APPROVAL:
 *
 *   yarn smoke:scenario s2-supplier-shortfall --force-pause --approve
 *   yarn smoke:scenario s2-supplier-shortfall --force-pause --reject
 */
import { resumePurchasingScenario, runPurchasingScenario } from '../src/index.js';
import type { AgentEvents, AgentRunSummary } from '../src/index.js';

const FORCE_PAUSE_INSTRUCTION =
  'A human buyer has already reviewed this and explicitly authorized ordering exactly 250 units from SUP-GRAIN-02 to fully cover the PO-9001 shortfall, regardless of budget impact — this is a deliberate, pre-approved exception. Do not escalate and do not ask for further confirmation: call create_purchase_order once with productId P-RICE-5KG, nodeId FC-BLR-01, supplierId SUP-GRAIN-02, requestedQty 250. The system will handle any gating on its own; your job is just to submit it.';

function truncate(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function traceEvents(): AgentEvents {
  return {
    onToolCall: (call) =>
      console.log(`  -> ${call.name}`, truncate(JSON.stringify(call.args), 160)),
    onToolResult: (result) =>
      console.log(
        `  <- ${result.name} ${result.isError ? 'ERROR' : 'ok'} (${result.durationMs}ms) ${truncate(result.content)}`
      ),
    onAssistantMessage: (text) => console.log(`  [assistant] ${truncate(text, 400)}`),
    onApprovalRequested: (pending) =>
      console.log(`  [gate] needs approval -> ${pending.toolName}: ${pending.reason}`),
    onEscalation: (escalation) =>
      console.log(`  [escalated] ${escalation.reason} ${escalation.context ?? ''}`),
  };
}

function printSummary(summary: AgentRunSummary) {
  console.log('\n=== Run summary ===');
  console.log(`Stop reason: ${summary.stopReason}`);
  console.log(`Iterations:  ${summary.iterations}`);
  console.log(`Duration:    ${(summary.durationMs / 1000).toFixed(1)}s`);
  if (summary.finalText) console.log(`\nFinal answer:\n${summary.finalText}`);
}

async function main() {
  const scenarioId = process.argv[2] ?? 's1-recommendation-review';
  const decisionFlag = process.argv.includes('--reject')
    ? false
    : process.argv.includes('--approve')
      ? true
      : null;

  const forcePause = process.argv.includes('--force-pause');

  console.log(`=== Scenario: ${scenarioId} ===\n=== Agent trace ===`);

  let { summary, scenario, store } = await runPurchasingScenario({
    scenarioId,
    prompt: forcePause ? FORCE_PAUSE_INSTRUCTION : undefined,
    on: traceEvents(),
  });

  printSummary(summary);

  if (summary.stopReason === 'AWAITING_APPROVAL' && summary.pendingApproval) {
    if (decisionFlag === null) {
      console.log(
        '\nRun paused for human approval — pass --approve or --reject to continue past the gate.'
      );
    } else {
      console.log(`\n=== Resuming with decision: ${decisionFlag ? 'approve' : 'reject'} ===`);
      const resumed = await resumePurchasingScenario({
        scenarioId,
        store,
        messages: summary.resumeMessages ?? [],
        approvalResponse: {
          approvalId: summary.pendingApproval.approvalId,
          toolCall: summary.pendingApproval.toolCall,
          approved: decisionFlag,
        },
        on: traceEvents(),
      });
      summary = resumed.summary;
      store = resumed.store;
      printSummary(summary);
    }
  }

  const open = store.listOpenPurchaseOrders(
    scenario.situation.productId,
    scenario.situation.nodeId
  );
  console.log('\n=== Open POs after run ===');
  console.log(JSON.stringify(open, null, 2));

  if (summary.stopReason === 'TIMEOUT') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
