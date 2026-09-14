import { tool, type ToolApprovalConfiguration, type ToolSet } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { Store } from 'erp';
import { createPurchaseOrder, getIncomingConfirmedQty, decideApproval, validatePlan } from 'erp';

function notFound(entity: string, id: string) {
  return { error: `${entity} not found: ${id}` };
}

// Re-validates the plan before create_purchase_order can execute; anything
// short of a clean pass routes to 'user-approval' and pauses the run.
export function createApprovalGate(store: Store): ToolApprovalConfiguration<ToolSet, never> {
  return {
    create_purchase_order: ({ productId, nodeId, supplierId, requestedQty }) => {
      try {
        const results = validatePlan(store, {
          productId,
          nodeId,
          supplierId,
          quantity: requestedQty,
        });
        const { autoApprove, reason } = decideApproval(results);
        return autoApprove
          ? { type: 'approved', reason }
          : { type: 'user-approval', reason };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { type: 'user-approval', reason: `Could not validate plan: ${reason}` };
      }
    },
  };
}

/**
 * Tools bound to one scenario Store clone for a single agent run.
 * Reads investigate; validate_plan + create_purchase_order close the feedback loop.
 */
export function createPurchasingTools(store: Store) {
  return {
    get_product: tool({
      description: 'Get product master data (case pack, unit cost, shelf life).',
      inputSchema: z.object({
        productId: z.string(),
      }),
      execute: async ({ productId }) => {
        const product = store.getProduct(productId);
        return product ?? notFound('product', productId);
      },
    }),

    get_node: tool({
      description: 'Get fulfillment node / warehouse capacity and current used units.',
      inputSchema: z.object({
        nodeId: z.string(),
      }),
      execute: async ({ nodeId }) => {
        const node = store.getNode(nodeId);
        return node ?? notFound('node', nodeId);
      },
    }),

    get_inventory: tool({
      description: 'Get on-hand, reserved, and safety-stock inventory for a product at a node.',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
      }),
      execute: async ({ productId, nodeId }) => {
        const inventory = store.getInventory(productId, nodeId);
        if (!inventory) {
          return { error: `No inventory row for ${productId} at ${nodeId}` };
        }
        return {
          ...inventory,
          available: inventory.onHand - inventory.reserved,
        };
      },
    }),

    get_demand_forecast: tool({
      description: 'Get the demand forecast for a product at a node.',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
        horizonDays: z.number().optional(),
      }),
      execute: async ({ productId, nodeId, horizonDays }) => {
        const forecast = store.getDemandForecast(productId, nodeId, horizonDays);
        return (
          forecast ?? {
            error: `No demand forecast for ${productId} at ${nodeId}`,
          }
        );
      },
    }),

    get_sales_actuals: tool({
      description:
        'Get recent sales actuals vs the forecast for the same window (signal for demand change).',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
        lookbackDays: z.number().optional(),
      }),
      execute: async ({ productId, nodeId, lookbackDays }) => {
        const actuals = store.getSalesActuals(productId, nodeId, lookbackDays);
        return (
          actuals ?? {
            error: `No sales actuals for ${productId} at ${nodeId}`,
          }
        );
      },
    }),

    list_open_purchase_orders: tool({
      description:
        'List open purchase orders (DRAFT / CONFIRMED / PARTIALLY_CONFIRMED) for a product at a node, plus total incoming confirmed qty.',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
      }),
      execute: async ({ productId, nodeId }) => {
        const purchaseOrders = store.listOpenPurchaseOrders(productId, nodeId);
        return {
          purchaseOrders,
          incomingConfirmedQty: getIncomingConfirmedQty(store, productId, nodeId),
        };
      },
    }),

    list_suppliers: tool({
      description:
        'List suppliers that can supply a product, including MOQ, lead time, price, allocation, and reliability.',
      inputSchema: z.object({
        productId: z.string(),
      }),
      execute: async ({ productId }) => {
        return { suppliers: store.listSuppliersForProduct(productId) };
      },
    }),

    get_budget: tool({
      description: 'Get the current purchasing budget period and remaining availability.',
      inputSchema: z.object({}),
      execute: async () => {
        const budget = store.getBudget();
        if (!budget) return { error: 'No budget on file' };
        return {
          ...budget,
          available: budget.allocated - budget.committed - budget.spent,
        };
      },
    }),

    get_purchase_order: tool({
      description: 'Fetch a purchase order by id.',
      inputSchema: z.object({
        poId: z.string(),
      }),
      execute: async ({ poId }) => {
        const po = store.getPurchaseOrder(poId);
        return po ?? notFound('purchase order', poId);
      },
    }),

    validate_plan: tool({
      description:
        'Validate a purchase quantity against MOQ, case pack, storage, budget, demand coverage, overbuy, lead time, and supplier allocation. Pre-flight: pass the quantity you intend to request. Post-execution: after create_purchase_order, pass quantity 0 — the new PO is already in open/incoming, so validating confirmedQty again would double-count it.',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
        supplierId: z.string(),
        quantity: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'Pre-flight: intended request qty. Post-execution: 0 (PO already counted as incoming). Also 0 for an explicit no-buy.'
          ),
      }),
      execute: async ({ productId, nodeId, supplierId, quantity }) => {
        try {
          const results = validatePlan(store, {
            productId,
            nodeId,
            supplierId,
            quantity,
          });
          const approval = decideApproval(results);
          return { results, approval };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    create_purchase_order: tool({
      description:
        'Submit a purchase order to the supplier. Confirmed quantity may be lower than requested due to allocation caps, case-pack rounding, or MOQ. Always validate_plan on confirmedQty afterwards.',
      inputSchema: z.object({
        productId: z.string(),
        nodeId: z.string(),
        supplierId: z.string(),
        requestedQty: z.number().int().positive(),
        poId: z
          .string()
          .optional()
          .describe('Optional PO id; a PO-… id is generated when omitted.'),
      }),
      execute: async ({ productId, nodeId, supplierId, requestedQty, poId }) => {
        try {
          const result = createPurchaseOrder(store, {
            poId: poId ?? `PO-${randomUUID().slice(0, 8).toUpperCase()}`,
            productId,
            nodeId,
            supplierId,
            requestedQty,
          });
          return {
            po: result.po,
            adjustments: result.adjustments,
            diverged: result.po.confirmedQty !== result.po.requestedQty,
            hint:
              'Compare confirmedQty to requestedQty. Then call validate_plan with quantity 0 (the PO is already in open/incoming) to close the feedback loop.',
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    escalate_to_buyer: tool({
      description:
        'Stop and hand this situation to a human buyer instead of deciding or acting yourself. Use when the situation is ambiguous, evidence conflicts, or the right call depends on judgment/context you do not have (e.g. a supplier shortfall with no clear substitute, or a constraint violation with no safe fallback). This ends your turn — do not call further tools after this.',
      inputSchema: z.object({
        reason: z.string().describe('Why this needs a human, in one or two sentences.'),
        context: z
          .string()
          .optional()
          .describe('Key numbers/findings the buyer needs to pick up where you left off.'),
      }),
      execute: async ({ reason, context }) => {
        return { escalate: true, reason, context };
      },
    }),
  };
}

export type PurchasingTools = ReturnType<typeof createPurchasingTools>;
