/**
 * Dump a scenario store to stdout.
 *
 *   yarn scenario:dump
 *   yarn scenario:dump s1-recommendation-review
 */
import {
  listScenarioIds,
  loadScenarioFile,
  loadStore,
  scenariosDir,
} from '../src/erp';

const scenarioId = process.argv[2] ?? 's1-recommendation-review';

function main() {
  console.log(`scenarios dir: ${scenariosDir()}`);
  console.log(`available:     ${listScenarioIds().join(', ') || '(none)'}`);
  console.log(`loading:       ${scenarioId}\n`);

  const meta = loadScenarioFile(scenarioId);
  const store = loadStore(scenarioId);
  const snap = store.snapshot();

  console.log('=== Situation ===');
  console.log(JSON.stringify(meta.situation, null, 2));

  console.log('\n=== Derived checks (S1 sanity) ===');
  const inv = store.getInventory(
    meta.situation.productId,
    meta.situation.nodeId
  );
  const node = store.getNode(meta.situation.nodeId);
  const open = store.listOpenPurchaseOrders(
    meta.situation.productId,
    meta.situation.nodeId
  );
  const incoming = open.reduce((sum, po) => sum + po.confirmedQty, 0);
  const free =
    node && inv
      ? node.capacityUnits - node.usedUnits - incoming
      : null;

  console.log(
    JSON.stringify(
      {
        onHand: inv?.onHand,
        reserved: inv?.reserved,
        availableNow: inv ? inv.onHand - inv.reserved : null,
        incomingConfirmed: incoming,
        freeStorageUnits: free,
        recommendedQuantity: meta.situation.recommendedQuantity,
      },
      null,
      2
    )
  );

  console.log('\n=== Full snapshot ===');
  console.log(JSON.stringify(snap, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
