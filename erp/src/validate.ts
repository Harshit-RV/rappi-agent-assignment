import type { Store } from './store';
import { getIncomingConfirmedQty } from './purchasing';

export type RuleStatus = 'pass' | 'fail' | 'warn';

export type RuleResult = {
  id: string;
  status: RuleStatus;
  expected: string;
  actual: string;
  message: string;
};

// Same shape for pre-flight (requestedQty) and post-execution (confirmedQty).
export type PurchasePlan = {
  productId: string;
  nodeId: string;
  supplierId: string;
  quantity: number;
};

export class ValidationInputError extends Error {}

export type ApprovalDecision = {
  autoApprove: boolean;
  reason: string;
};

// Auto-execute only when every rule passes; a warn still routes to human review.
export function decideApproval(results: RuleResult[]): ApprovalDecision {
  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length > 0) {
    return {
      autoApprove: false,
      reason: `${failed.length} rule(s) failed: ${failed.map((r) => r.id).join(', ')}.`,
    };
  }

  const warned = results.filter((r) => r.status === 'warn');
  if (warned.length > 0) {
    return {
      autoApprove: false,
      reason: `${warned.length} rule(s) need review: ${warned.map((r) => r.id).join(', ')}.`,
    };
  }

  return { autoApprove: true, reason: 'All rules passed.' };
}

type Loaded = {
  product: NonNullable<ReturnType<Store['getProduct']>>;
  node: NonNullable<ReturnType<Store['getNode']>>;
  supplier: NonNullable<ReturnType<Store['getSupplier']>>;
  inventory: ReturnType<Store['getInventory']>;
  forecast: ReturnType<Store['getDemandForecast']>;
  incomingConfirmedQty: number;
};

function availableBudget(store: Store): number {
  const budget = store.getBudget();
  if (!budget) return 0;
  return budget.allocated - budget.committed - budget.spent;
}

function load(store: Store, plan: PurchasePlan): Loaded {
  const product = store.getProduct(plan.productId);
  const node = store.getNode(plan.nodeId);
  const supplier = store.getSupplier(plan.supplierId);
  if (!product) throw new ValidationInputError(`Unknown product: ${plan.productId}`);
  if (!node) throw new ValidationInputError(`Unknown node: ${plan.nodeId}`);
  if (!supplier) throw new ValidationInputError(`Unknown supplier: ${plan.supplierId}`);
  if (supplier.productId !== plan.productId) {
    throw new ValidationInputError(
      `Supplier ${plan.supplierId} does not supply product ${plan.productId}`
    );
  }

  return {
    product,
    node,
    supplier,
    inventory: store.getInventory(plan.productId, plan.nodeId),
    forecast: store.getDemandForecast(plan.productId, plan.nodeId),
    incomingConfirmedQty: getIncomingConfirmedQty(store, plan.productId, plan.nodeId),
  };
}

function isNoBuy(plan: PurchasePlan): boolean {
  return plan.quantity === 0;
}

function moqSatisfied(plan: PurchasePlan, { supplier }: Loaded): RuleResult {
  if (isNoBuy(plan)) {
    return {
      id: 'MOQ_SATISFIED',
      status: 'pass',
      expected: `>= ${supplier.moq}`,
      actual: '0 (no purchase)',
      message: 'No purchase proposed; MOQ does not apply.',
    };
  }
  const pass = plan.quantity >= supplier.moq;
  return {
    id: 'MOQ_SATISFIED',
    status: pass ? 'pass' : 'fail',
    expected: `>= ${supplier.moq}`,
    actual: String(plan.quantity),
    message: pass
      ? `${plan.quantity} meets supplier MOQ of ${supplier.moq}.`
      : `${plan.quantity} is below supplier MOQ of ${supplier.moq}; supplier will not fulfil.`,
  };
}

function casePackMultiple(plan: PurchasePlan, { product }: Loaded): RuleResult {
  const casePack = product.casePack;
  const pass = plan.quantity % casePack === 0;
  return {
    id: 'CASE_PACK_MULTIPLE',
    status: pass ? 'pass' : 'fail',
    expected: `multiple of ${casePack}`,
    actual: String(plan.quantity),
    message: pass
      ? `${plan.quantity} is a multiple of the case pack (${casePack}).`
      : `${plan.quantity} is not a multiple of the case pack (${casePack}); supplier will round down.`,
  };
}

function storageCapacity(plan: PurchasePlan, { node, incomingConfirmedQty }: Loaded): RuleResult {
  const freeToday = node.capacityUnits - node.usedUnits;
  const projectedUsed = node.usedUnits + incomingConfirmedQty + plan.quantity;
  const pass = projectedUsed <= node.capacityUnits;
  return {
    id: 'STORAGE_CAPACITY',
    status: pass ? 'pass' : 'fail',
    expected: `<= ${node.capacityUnits} capacity units`,
    actual: `${projectedUsed} (used ${node.usedUnits} + incoming ${incomingConfirmedQty} + this order ${plan.quantity})`,
    message: pass
      ? `Fits within ${node.name}'s capacity (${freeToday} free before this order, incoming already counted).`
      : `Exceeds ${node.name}'s capacity by ${projectedUsed - node.capacityUnits} units once incoming stock and this order land.`,
  };
}

function budgetAvailable(plan: PurchasePlan, { supplier }: Loaded, store: Store): RuleResult {
  const cost = plan.quantity * supplier.unitPrice;
  const available = availableBudget(store);
  const pass = cost <= available;
  return {
    id: 'BUDGET_AVAILABLE',
    status: pass ? 'pass' : 'fail',
    expected: `cost <= ${available} available`,
    actual: `cost ${cost} (${plan.quantity} x ${supplier.unitPrice})`,
    message: pass
      ? `Cost of ${cost} fits within the ${available} still available this period.`
      : `Cost of ${cost} exceeds the ${available} still available this period by ${cost - available}.`,
  };
}

function demandCoverage(plan: PurchasePlan, loaded: Loaded): RuleResult {
  const { inventory, forecast, incomingConfirmedQty } = loaded;
  if (!inventory || !forecast) {
    return {
      id: 'DEMAND_COVERAGE',
      status: 'warn',
      expected: 'inventory and demand forecast on file',
      actual: !inventory ? 'no inventory row' : 'no demand forecast row',
      message:
        'Cannot assess demand coverage without both inventory and a forecast for this product/node.',
    };
  }

  const availableNow = inventory.onHand - inventory.reserved;
  const projected = availableNow + incomingConfirmedQty + plan.quantity;
  const pass = projected >= forecast.forecastUnits;
  return {
    id: 'DEMAND_COVERAGE',
    status: pass ? 'pass' : 'fail',
    expected: `projected stock >= ${forecast.forecastUnits} (forecast, ${forecast.horizonDays}d)`,
    actual: `${projected} (available ${availableNow} + incoming ${incomingConfirmedQty} + this order ${plan.quantity})`,
    message: pass
      ? `Projected stock of ${projected} covers the ${forecast.horizonDays}-day forecast of ${forecast.forecastUnits}.`
      : `Projected stock of ${projected} falls short of the ${forecast.horizonDays}-day forecast of ${forecast.forecastUnits} by ${forecast.forecastUnits - projected}.`,
  };
}

const OVERBUY_MULTIPLE = 1.5;

function noOverbuy(plan: PurchasePlan, loaded: Loaded): RuleResult {
  const { inventory, forecast, incomingConfirmedQty } = loaded;
  if (!inventory || !forecast) {
    return {
      id: 'NO_OVERBUY',
      status: 'warn',
      expected: 'inventory and demand forecast on file',
      actual: !inventory ? 'no inventory row' : 'no demand forecast row',
      message:
        'Cannot assess overbuy risk without both inventory and a forecast for this product/node.',
    };
  }

  const availableNow = inventory.onHand - inventory.reserved;
  const projected = availableNow + incomingConfirmedQty + plan.quantity;
  const ceiling = forecast.forecastUnits * OVERBUY_MULTIPLE;
  const pass = projected <= ceiling;
  return {
    id: 'NO_OVERBUY',
    status: pass ? 'pass' : 'warn',
    expected: `projected stock <= ${ceiling} (${OVERBUY_MULTIPLE}x the ${forecast.horizonDays}d forecast)`,
    actual: `${projected} (available ${availableNow} + incoming ${incomingConfirmedQty} + this order ${plan.quantity})`,
    message: pass
      ? `Projected stock of ${projected} stays within ${OVERBUY_MULTIPLE}x the forecast.`
      : `Projected stock of ${projected} is ${(projected / forecast.forecastUnits).toFixed(1)}x the ${forecast.horizonDays}-day forecast — likely overbuying.`,
  };
}

function leadTimeFeasible(plan: PurchasePlan, loaded: Loaded): RuleResult {
  const { inventory, forecast, supplier, incomingConfirmedQty } = loaded;
  if (!inventory || !forecast || forecast.forecastUnits === 0) {
    return {
      id: 'LEAD_TIME_FEASIBLE',
      status: 'warn',
      expected: 'inventory and a nonzero demand forecast on file',
      actual: !inventory ? 'no inventory row' : 'no usable forecast',
      message: 'Cannot assess lead-time feasibility without inventory and a nonzero forecast.',
    };
  }

  const availableNow = inventory.onHand - inventory.reserved;
  const dailyRate = forecast.forecastUnits / forecast.horizonDays;
  const coverageDays = (availableNow + incomingConfirmedQty) / dailyRate;
  const pass = coverageDays >= supplier.leadTimeDays;
  return {
    id: 'LEAD_TIME_FEASIBLE',
    status: pass ? 'pass' : 'warn',
    expected: `coverage days (${coverageDays.toFixed(1)}) >= supplier lead time (${supplier.leadTimeDays}d)`,
    actual: `${coverageDays.toFixed(1)} days of stock on hand + incoming, supplier ships in ${supplier.leadTimeDays}d`,
    message: pass
      ? `Existing stock covers ${coverageDays.toFixed(1)} days, past the supplier's ${supplier.leadTimeDays}-day lead time.`
      : `Existing stock only covers ${coverageDays.toFixed(1)} days — a stockout is likely before the supplier's ${supplier.leadTimeDays}-day lead time elapses. This order should have been placed already.`,
  };
}

function supplierCanFulfil(plan: PurchasePlan, { supplier }: Loaded): RuleResult {
  if (isNoBuy(plan)) {
    return {
      id: 'SUPPLIER_CAN_FULFIL',
      status: 'pass',
      expected: `<= ${supplier.availableAllocation} available allocation`,
      actual: '0 (no purchase)',
      message: 'No purchase proposed; supplier allocation does not apply.',
    };
  }
  const pass = plan.quantity <= supplier.availableAllocation;
  return {
    id: 'SUPPLIER_CAN_FULFIL',
    status: pass ? 'pass' : 'fail',
    expected: `<= ${supplier.availableAllocation} available allocation`,
    actual: String(plan.quantity),
    message: pass
      ? `Supplier has ${supplier.availableAllocation} allocated, enough to cover ${plan.quantity}.`
      : `Supplier only has ${supplier.availableAllocation} allocated, short of the ${plan.quantity} requested by ${plan.quantity - supplier.availableAllocation}.`,
  };
}

// Same rules run pre-flight (requestedQty) and post-execution (confirmedQty).
export function validatePlan(store: Store, plan: PurchasePlan): RuleResult[] {
  const loaded = load(store, plan);
  return [
    moqSatisfied(plan, loaded),
    casePackMultiple(plan, loaded),
    storageCapacity(plan, loaded),
    budgetAvailable(plan, loaded, store),
    demandCoverage(plan, loaded),
    noOverbuy(plan, loaded),
    leadTimeFeasible(plan, loaded),
    supplierCanFulfil(plan, loaded),
  ];
}
