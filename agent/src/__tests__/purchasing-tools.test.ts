import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadStore } from 'erp';
import { createPurchasingTools } from '../tools/purchasing-tools';

const SCENARIO_ID = 's1-recommendation-review';

// AI SDK tool.execute has a wide PromiseLike return type; call through unknown.
async function exec(tool: { execute?: Function }, input: unknown): Promise<unknown> {
  assert.ok(tool.execute, 'tool must have execute');
  return tool.execute(input, {});
}

describe('createPurchasingTools (scenario s1)', () => {
  it('reads inventory and flags the recommended qty as over capacity', async () => {
    const store = loadStore(SCENARIO_ID);
    const tools = createPurchasingTools(store);

    const inventory = (await exec(tools.get_inventory, {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
    })) as { onHand: number };
    assert.equal(inventory.onHand, 120);

    const validation = (await exec(tools.validate_plan, {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-VEND-01',
      quantity: 800,
    })) as {
      results: { id: string; status: string }[];
      approval: { autoApprove: boolean };
    };

    const storage = validation.results.find((r) => r.id === 'STORAGE_CAPACITY');
    assert.equal(storage?.status, 'fail');
    assert.equal(validation.approval.autoApprove, false);
  });

  it('creates a PO and surfaces confirmation divergence for the feedback loop', async () => {
    const store = loadStore(SCENARIO_ID);
    const tools = createPurchasingTools(store);

    // 100 is not a case-pack multiple of 24 → supplier confirms 96.
    const created = (await exec(tools.create_purchase_order, {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-VEND-01',
      requestedQty: 100,
      poId: 'PO-TEST-100',
    })) as {
      po: { requestedQty: number; confirmedQty: number };
      diverged: boolean;
    };

    assert.equal(created.po.requestedQty, 100);
    assert.equal(created.po.confirmedQty, 96);
    assert.equal(created.diverged, true);

    const post = (await exec(tools.validate_plan, {
      productId: 'P-COKE-500',
      nodeId: 'FC-BLR-01',
      supplierId: 'SUP-VEND-01',
      quantity: created.po.confirmedQty,
    })) as { results: unknown[] };

    assert.ok(Array.isArray(post.results));
  });
});
