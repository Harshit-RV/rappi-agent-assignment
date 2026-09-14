import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../erp/store';
import type { StoreSnapshot } from '../erp/types';
import { validatePlan, ValidationInputError } from '../validate';
import type { PurchasePlan, RuleResult } from '../validate';

const PRODUCT_ID = 'P-TEST';
const NODE_ID = 'N-TEST';
const SUPPLIER_ID = 'SUP-1';

function baseSnapshot(): StoreSnapshot {
  return {
    products: [
      { productId: PRODUCT_ID, name: 'Test Widget', casePack: 24, unitCost: 10, shelfLifeDays: 90 },
    ],
    nodes: [{ nodeId: NODE_ID, name: 'Test Node', capacityUnits: 10000, usedUnits: 1000 }],
    inventory: [
      { productId: PRODUCT_ID, nodeId: NODE_ID, onHand: 100, reserved: 0, safetyStock: 50 },
    ],
    demandForecasts: [
      { productId: PRODUCT_ID, nodeId: NODE_ID, horizonDays: 14, forecastUnits: 300, confidence: 0.8 },
    ],
    salesActuals: [],
    suppliers: [
      {
        supplierId: SUPPLIER_ID,
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
    budgets: [{ periodId: 'PERIOD-1', currency: 'INR', allocated: 50000, committed: 0, spent: 0 }],
  };
}

function storeFrom(overrides: Partial<StoreSnapshot> = {}): Store {
  return Store.fromSnapshot({ ...baseSnapshot(), ...overrides });
}

function basePlan(quantity: number): PurchasePlan {
  return { productId: PRODUCT_ID, nodeId: NODE_ID, supplierId: SUPPLIER_ID, quantity };
}

function ruleFor(results: RuleResult[], id: string): RuleResult {
  const r = results.find((res) => res.id === id);
  assert.ok(r, `expected a result for rule ${id}`);
  return r!;
}

test('a well-formed plan (multiple of case-pack, covers demand, within every limit) passes every rule', () => {
  const store = storeFrom();
  // 240 = 10 cases, covers the 300 forecast alongside the 100 on hand, well within budget/allocation.
  const results = validatePlan(store, basePlan(240));
  for (const r of results) {
    assert.notEqual(r.status, 'fail', `${r.id} unexpectedly failed: ${r.message}`);
  }
});

test('MOQ_SATISFIED fails below the supplier minimum, passes at or above it', () => {
  const store = storeFrom();
  assert.equal(ruleFor(validatePlan(store, basePlan(48)), 'MOQ_SATISFIED').status, 'fail');
  assert.equal(ruleFor(validatePlan(store, basePlan(96)), 'MOQ_SATISFIED').status, 'pass');
});

test('MOQ_SATISFIED passes for a quantity of 0 — that is "don\'t buy", not an MOQ violation', () => {
  const store = storeFrom();
  assert.equal(ruleFor(validatePlan(store, basePlan(0)), 'MOQ_SATISFIED').status, 'pass');
});

test('CASE_PACK_MULTIPLE fails on a non-multiple, passes on a multiple', () => {
  const store = storeFrom();
  assert.equal(ruleFor(validatePlan(store, basePlan(100)), 'CASE_PACK_MULTIPLE').status, 'fail');
  assert.equal(ruleFor(validatePlan(store, basePlan(96)), 'CASE_PACK_MULTIPLE').status, 'pass');
});

test('STORAGE_CAPACITY fails once used + incoming + this order exceeds node capacity', () => {
  const store = storeFrom({
    nodes: [{ nodeId: NODE_ID, name: 'Test Node', capacityUnits: 1000, usedUnits: 900 }],
  });
  const result = ruleFor(validatePlan(store, basePlan(240)), 'STORAGE_CAPACITY');
  assert.equal(result.status, 'fail');
});

test('STORAGE_CAPACITY accounts for confirmedQty of open POs, not just usedUnits', () => {
  const store = storeFrom({
    nodes: [{ nodeId: NODE_ID, name: 'Test Node', capacityUnits: 1000, usedUnits: 500 }],
    purchaseOrders: [
      {
        poId: 'PO-OPEN',
        productId: PRODUCT_ID,
        nodeId: NODE_ID,
        supplierId: SUPPLIER_ID,
        requestedQty: 400,
        confirmedQty: 400,
        unitPrice: 10,
        status: 'CONFIRMED',
        expectedArrivalDays: 5,
      },
    ],
  });
  // 500 used + 400 incoming + 200 this order = 1100 > 1000 capacity.
  const result = ruleFor(validatePlan(store, basePlan(200)), 'STORAGE_CAPACITY');
  assert.equal(result.status, 'fail');
});

test('BUDGET_AVAILABLE fails once cost exceeds allocated minus committed minus spent', () => {
  const store = storeFrom({
    budgets: [{ periodId: 'PERIOD-1', currency: 'INR', allocated: 1000, committed: 0, spent: 0 }],
  });
  // 240 units x 10/unit = 2400 > 1000 available.
  const result = ruleFor(validatePlan(store, basePlan(240)), 'BUDGET_AVAILABLE');
  assert.equal(result.status, 'fail');
});

test('DEMAND_COVERAGE fails when projected stock falls short of the forecast', () => {
  const store = storeFrom();
  // available 100 + incoming 0 + this order 48 = 148, short of the 300 forecast.
  const result = ruleFor(validatePlan(store, basePlan(48)), 'DEMAND_COVERAGE');
  assert.equal(result.status, 'fail');
});

test('DEMAND_COVERAGE warns (does not throw) when there is no forecast on file', () => {
  const store = storeFrom({ demandForecasts: [] });
  const result = ruleFor(validatePlan(store, basePlan(240)), 'DEMAND_COVERAGE');
  assert.equal(result.status, 'warn');
});

test('NO_OVERBUY warns when projected stock is far past the forecast, without hard-failing', () => {
  const store = storeFrom();
  // available 100 + this order 960 = 1060, well past 1.5x the 300 forecast (450).
  const result = ruleFor(validatePlan(store, basePlan(960)), 'NO_OVERBUY');
  assert.equal(result.status, 'warn');
});

test('LEAD_TIME_FEASIBLE warns when on-hand coverage runs out before the supplier can deliver', () => {
  const store = storeFrom({
    inventory: [{ productId: PRODUCT_ID, nodeId: NODE_ID, onHand: 10, reserved: 0, safetyStock: 50 }],
    suppliers: [
      {
        supplierId: SUPPLIER_ID,
        name: 'Test Supplier',
        productId: PRODUCT_ID,
        unitPrice: 10,
        moq: 24,
        leadTimeDays: 30,
        availableAllocation: 5000,
        reliabilityScore: 0.9,
      },
    ],
  });
  // 10 units on hand at a rate of 300/14 = ~21.4/day -> covers < 1 day, supplier ships in 30.
  const result = ruleFor(validatePlan(store, basePlan(24)), 'LEAD_TIME_FEASIBLE');
  assert.equal(result.status, 'warn');
});

test('SUPPLIER_CAN_FULFIL fails when the requested quantity exceeds available allocation', () => {
  const store = storeFrom({
    suppliers: [
      {
        supplierId: SUPPLIER_ID,
        name: 'Test Supplier',
        productId: PRODUCT_ID,
        unitPrice: 10,
        moq: 24,
        leadTimeDays: 5,
        availableAllocation: 100,
        reliabilityScore: 0.9,
      },
    ],
  });
  const result = ruleFor(validatePlan(store, basePlan(240)), 'SUPPLIER_CAN_FULFIL');
  assert.equal(result.status, 'fail');
});

test('throws ValidationInputError for an unknown product/node/supplier rather than a rule failure', () => {
  const store = storeFrom();
  assert.throws(
    () => validatePlan(store, { ...basePlan(240), productId: 'NOPE' }),
    ValidationInputError
  );
});

test('the same rules run unchanged against a post-execution confirmedQty (partial fill)', () => {
  const store = storeFrom();
  const preFlight = validatePlan(store, basePlan(240));
  const postExecution = validatePlan(store, basePlan(96));

  assert.equal(ruleFor(preFlight, 'DEMAND_COVERAGE').status, 'pass');
  assert.equal(ruleFor(postExecution, 'DEMAND_COVERAGE').status, 'fail');
});
