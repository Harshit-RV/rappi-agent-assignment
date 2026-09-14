import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadStore } from 'erp';
import { createApprovalGate, createPurchasingTools } from '../tools/purchasing-tools';

const SCENARIO_ID = 's1-recommendation-review';

// Single-tool approval functions have a wide PromiseLike return type; call through unknown.
async function callGate(
  gate: Record<string, unknown>,
  toolName: string,
  input: unknown
): Promise<{ type: string; reason?: string }> {
  const fn = gate[toolName];
  assert.equal(typeof fn, 'function', `${toolName} must have an approval function`);
  return (fn as Function)(input, {});
}

describe('createApprovalGate (orchestrator-enforced write gate)', () => {
  it('routes an over-capacity plan to user-approval, never auto-approving a failing plan', async () => {
    const store = loadStore(SCENARIO_ID);
    const gate = createApprovalGate(store) as Record<string, unknown>;

    const decision = await callGate(gate, 'create_purchase_order', {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-VEND-01',
      requestedQty: 800,
      poId: 'PO-TEST-GATE-1',
    });

    assert.equal(decision.type, 'user-approval');
  });

  it('auto-approves a plan that cleanly passes every validation rule', async () => {
    const store = loadStore(SCENARIO_ID);
    const gate = createApprovalGate(store) as Record<string, unknown>;

    const decision = await callGate(gate, 'create_purchase_order', {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-VEND-01',
      requestedQty: 96,
      poId: 'PO-TEST-GATE-2',
    });

    assert.equal(decision.type, 'approved');
  });

  it('routes to user-approval (never throws) on an unknown supplier rather than silently approving', async () => {
    const store = loadStore(SCENARIO_ID);
    const gate = createApprovalGate(store) as Record<string, unknown>;

    const decision = await callGate(gate, 'create_purchase_order', {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-DOES-NOT-EXIST',
      requestedQty: 96,
      poId: 'PO-TEST-GATE-3',
    });

    assert.equal(decision.type, 'user-approval');
  });
});

describe('escalate_to_buyer tool', () => {
  it('is a terminal, always-succeeding tool that reports back to the orchestrator', async () => {
    const store = loadStore(SCENARIO_ID);
    const tools = createPurchasingTools(store) as Record<
      string,
      { execute?: Function }
    >;

    assert.ok(tools.escalate_to_buyer?.execute, 'escalate_to_buyer must have execute');

    const result = (await tools.escalate_to_buyer.execute(
      {
        reason: 'Supplier shortfall with no clear substitute.',
        context: 'Requested 500, supplier confirmed 250.',
      },
      {}
    )) as { escalate: boolean; reason: string; context?: string };

    assert.equal(result.escalate, true);
    assert.equal(result.reason, 'Supplier shortfall with no clear substitute.');
    assert.equal(result.context, 'Requested 500, supplier confirmed 250.');
  });
});
