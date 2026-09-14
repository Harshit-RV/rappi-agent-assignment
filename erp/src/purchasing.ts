import type { Store } from './store';
import type { PurchaseOrder, PurchaseOrderStatus } from './types';

export type CreatePurchaseOrderInput = {
  poId: string;
  productId: string;
  nodeId: string;
  supplierId: string;
  requestedQty: number;
};

export type CreatePurchaseOrderResult = {
  po: PurchaseOrder;
  // Why confirmedQty differs from requestedQty, in order applied. Empty when fully confirmed
  adjustments: string[];
};

export function getOpenPurchaseOrders(
  store: Store,
  productId: string,
  nodeId: string
): PurchaseOrder[] {
  return store.listOpenPurchaseOrders(productId, nodeId);
}

// Sum of confirmedQty across open POs — what's actually incoming
export function getIncomingConfirmedQty(
  store: Store,
  productId: string,
  nodeId: string
): number {
  return getOpenPurchaseOrders(store, productId, nodeId).reduce(
    (sum, po) => sum + po.confirmedQty,
    0
  );
}

/**
 * The feedback-loop crux: requestedQty vs. what the supplier actually
 * confirms. Applied in order, each step only shrinking the next's input:
 * allocation cap, then case-pack rounding, then MOQ. Never throws on a
 * mismatch — returns PARTIALLY_CONFIRMED and leaves the reaction to the
 * caller's validation/verify step.
 */
export function createPurchaseOrder(
  store: Store,
  input: CreatePurchaseOrderInput
): CreatePurchaseOrderResult {
  const { poId, productId, nodeId, supplierId, requestedQty } = input;

  if (requestedQty <= 0) {
    throw new Error(`requestedQty must be positive, got ${requestedQty}`);
  }

  const product = store.getProduct(productId);
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const supplier = store.getSupplier(supplierId);
  if (!supplier) throw new Error(`Unknown supplier: ${supplierId}`);
  if (supplier.productId !== productId) {
    throw new Error(
      `Supplier ${supplierId} does not supply product ${productId}`
    );
  }

  const adjustments: string[] = [];
  let qty = requestedQty;

  // 1. allocation cap
  if (qty > supplier.availableAllocation) {
    adjustments.push(
      `capped to available allocation (${supplier.availableAllocation} of ${qty} requested)`
    );
    qty = supplier.availableAllocation;
  }

  // 2. case-pack rounding
  if (product.casePack > 1) {
    const remainder = qty % product.casePack;
    if (remainder !== 0) {
      const rounded = qty - remainder;
      adjustments.push(
        `rounded down to a case-pack multiple of ${product.casePack} (${qty} -> ${rounded})`
      );
      qty = rounded;
    }
  }

  // 3. MOQ — below it, supplier confirms nothing
  if (qty > 0 && qty < supplier.moq) {
    adjustments.push(
      `below supplier MOQ of ${supplier.moq} after prior adjustments (${qty}) — supplier confirms 0`
    );
    qty = 0;
  }

  const confirmedQty = qty;
  const status: PurchaseOrderStatus =
    confirmedQty === requestedQty ? 'CONFIRMED' : 'PARTIALLY_CONFIRMED';

  const po = store.upsertPurchaseOrder({
    poId,
    productId,
    nodeId,
    supplierId,
    requestedQty,
    confirmedQty,
    unitPrice: supplier.unitPrice,
    status,
    expectedArrivalDays: supplier.leadTimeDays,
  });

  return { po, adjustments };
}
