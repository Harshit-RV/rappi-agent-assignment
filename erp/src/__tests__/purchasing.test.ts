import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store';
import { createPurchaseOrder, getIncomingConfirmedQty } from '../purchasing';
import type { StoreSnapshot } from '../types';

const PRODUCT_ID = 'P-TEST';
const NODE_ID = 'N-TEST';

function baseSnapshot(): StoreSnapshot {
  return {
    products: [
      { productId: PRODUCT_ID, name: 'Test Widget', casePack: 24, unitCost: 10, shelfLifeDays: 90 },
    ],
    nodes: [{ nodeId: NODE_ID, name: 'Test Node', capacityUnits: 10000, usedUnits: 0 }],
    inventory: [
      { productId: PRODUCT_ID, nodeId: NODE_ID, onHand: 0, reserved: 0, safetyStock: 0 },
    ],
    demandForecasts: [],
    salesActuals: [],
    suppliers: [
      {
        supplierId: 'SUP-1',
        name: 'Test Supplier',
        productId: PRODUCT_ID,
        unitPrice: 10,
        moq: 96,
        leadTimeDays: 5,
        availableAllocation: 5000,
        reliabilityScore: 0.9,
      },
    ],
    purchaseOrders: [],
    budgets: [],
  };
}

function storeWithSupplier(overrides: Partial<StoreSnapshot['suppliers'][0]>): Store {
  const snap = baseSnapshot();
  snap.suppliers[0] = { ...snap.suppliers[0]!, ...overrides };
  return Store.fromSnapshot(snap);
}

test('fully confirms a request that already fits allocation, case-pack, and MOQ', () => {
  const store = storeWithSupplier({});
  const { po, adjustments } = createPurchaseOrder(store, {
    poId: 'PO-1',
    productId: PRODUCT_ID,
    nodeId: NODE_ID,
    supplierId: 'SUP-1',
    requestedQty: 240, // 10 cases, well above MOQ, well under allocation
  });

  assert.equal(po.status, 'CONFIRMED');
  assert.equal(po.confirmedQty, 240);
  assert.deepEqual(adjustments, []);
});

test('caps confirmedQty to the supplier\'s available allocation', () => {
  const store = storeWithSupplier({ availableAllocation: 100, moq: 24 });
  const { po, adjustments } = createPurchaseOrder(store, {
    poId: 'PO-2',
    productId: PRODUCT_ID,
    nodeId: NODE_ID,
    supplierId: 'SUP-1',
    requestedQty: 240,
  });

  // 240 requested -> capped to 100 -> rounded down to nearest case-pack (24) = 96
  assert.equal(po.status, 'PARTIALLY_CONFIRMED');
  assert.equal(po.confirmedQty, 96);
  assert.ok(adjustments.some((a) => a.includes('allocation')));
  assert.ok(adjustments.some((a) => a.includes('case-pack')));
});

test('rounds down to a case-pack multiple even when allocation is not the binding constraint', () => {
  const store = storeWithSupplier({ moq: 24 });
  const { po, adjustments } = createPurchaseOrder(store, {
    poId: 'PO-3',
    productId: PRODUCT_ID,
    nodeId: NODE_ID,
    supplierId: 'SUP-1',
    requestedQty: 250, // not a multiple of 24
  });

  assert.equal(po.status, 'PARTIALLY_CONFIRMED');
  assert.equal(po.confirmedQty, 240); // 250 -> 240 (10 cases)
  assert.equal(adjustments.length, 1);
  assert.ok(adjustments[0]!.includes('case-pack'));
});

test('confirms 0 when the post-adjustment quantity falls below MOQ', () => {
  const store = storeWithSupplier({ availableAllocation: 50, moq: 96 });
  const { po, adjustments } = createPurchaseOrder(store, {
    poId: 'PO-4',
    productId: PRODUCT_ID,
    nodeId: NODE_ID,
    supplierId: 'SUP-1',
    requestedQty: 200,
  });

  // 200 -> capped to 50 -> rounded down to 48 (2 cases) -> below MOQ 96 -> 0
  assert.equal(po.status, 'PARTIALLY_CONFIRMED');
  assert.equal(po.confirmedQty, 0);
  assert.equal(adjustments.length, 3);
});

test('getIncomingConfirmedQty sums confirmedQty across open POs only', () => {
  const snap = baseSnapshot();
  snap.purchaseOrders = [
    {
      poId: 'PO-OPEN',
      productId: PRODUCT_ID,
      nodeId: NODE_ID,
      supplierId: 'SUP-1',
      requestedQty: 100,
      confirmedQty: 100,
      unitPrice: 10,
      status: 'CONFIRMED',
      expectedArrivalDays: 5,
    },
    {
      poId: 'PO-CANCELLED',
      productId: PRODUCT_ID,
      nodeId: NODE_ID,
      supplierId: 'SUP-1',
      requestedQty: 500,
      confirmedQty: 500,
      unitPrice: 10,
      status: 'CANCELLED',
      expectedArrivalDays: 5,
    },
  ];
  const store = Store.fromSnapshot(snap);

  assert.equal(getIncomingConfirmedQty(store, PRODUCT_ID, NODE_ID), 100);
});

test('rejects a request for a product that does not exist', () => {
  const store = storeWithSupplier({});
  assert.throws(
    () =>
      createPurchaseOrder(store, {
        poId: 'PO-5',
        productId: 'P-OTHER',
        nodeId: NODE_ID,
        supplierId: 'SUP-1',
        requestedQty: 100,
      }),
    /Unknown product/
  );
});

test('rejects a request when the supplier does not carry the requested product', () => {
  const snap = baseSnapshot();
  snap.products.push({
    productId: 'P-OTHER',
    name: 'Other Widget',
    casePack: 1,
    unitCost: 5,
    shelfLifeDays: 30,
  });
  const store = Store.fromSnapshot(snap);

  assert.throws(
    () =>
      createPurchaseOrder(store, {
        poId: 'PO-6',
        productId: 'P-OTHER',
        nodeId: NODE_ID,
        supplierId: 'SUP-1',
        requestedQty: 100,
      }),
    /does not supply/
  );
});
