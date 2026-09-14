import type {
  Budget,
  DemandForecast,
  Inventory,
  Node,
  Product,
  PurchaseOrder,
  PurchaseOrderStatus,
  SalesActuals,
  StoreSnapshot,
  Supplier,
} from './types';

const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_CONFIRMED',
];

function inventoryKey(productId: string, nodeId: string): string {
  return `${productId}::${nodeId}`;
}

function supplierKey(supplierId: string, productId: string): string {
  return `${supplierId}::${productId}`;
}

/**
 * A row keyed by (productId, nodeId) can have several entries — e.g. demand
 * forecasts at different horizons. Match on productId/nodeId, then prefer
 * the row matching `want` if given, else fall back to the first match.
 */
function pickByProductNode<T extends { productId: string; nodeId: string }>(
  rows: T[],
  productId: string,
  nodeId: string,
  want?: (row: T) => boolean
): T | undefined {
  const matches = rows.filter(
    (r) => r.productId === productId && r.nodeId === nodeId
  );
  if (matches.length === 0) return undefined;
  if (!want) return matches[0];
  return matches.find(want) ?? matches[0];
}

/**
 * Keyed collection used for every entity type below. Look up by key, list
 * all rows, defensively copy in and out so callers can't mutate store state
 * through a returned object — once, instead of once per entity.
 */
class Table<T> {
  private rows = new Map<string, T>();

  get(key: string): T | undefined {
    const row = this.rows.get(key);
    return row ? { ...row } : undefined;
  }

  list(): T[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  /** Rows in insertion order, undefined-safe for an empty table. */
  first(): T | undefined {
    const row = this.rows.values().next().value as T | undefined;
    return row ? { ...row } : undefined;
  }

  set(key: string, row: T): T {
    const copy = { ...row };
    this.rows.set(key, copy);
    return { ...copy };
  }

  find(predicate: (row: T) => boolean): T[] {
    return this.list().filter(predicate);
  }
}

/**
 * The mock ERP's persistence layer: one JSON scenario, seeded into Maps.
 *
 * Tools and services depend on this class directly — there's exactly one
 * implementation, so an ErpStore interface would just be indirection with
 * nothing on the other side of it. If a real DB-backed store shows up later,
 * add the interface then, extracted from this class's actual shape.
 *
 * clone() deep-copies so each agent run can mutate without contaminating
 * others or the seeded template.
 */
export class Store {
  private products = new Table<Product>();
  private nodes = new Table<Node>();
  private inventory = new Table<Inventory>();
  private demandForecasts = new Table<DemandForecast>();
  private salesActuals = new Table<SalesActuals>();
  private suppliers = new Table<Supplier>();
  private purchaseOrders = new Table<PurchaseOrder>();
  private budgets = new Table<Budget>();

  static fromSnapshot(snap: StoreSnapshot): Store {
    const store = new Store();
    for (const p of snap.products) store.products.set(p.productId, p);
    for (const n of snap.nodes) store.nodes.set(n.nodeId, n);
    for (const i of snap.inventory) {
      store.inventory.set(inventoryKey(i.productId, i.nodeId), i);
    }
    // One product+node can have several forecast/actuals rows (different
    // horizons/lookbacks), so these are keyed by a running index, not by
    // productId/nodeId — lookups filter via pickByProductNode() instead.
    snap.demandForecasts.forEach((d, i) => store.demandForecasts.set(String(i), d));
    snap.salesActuals.forEach((s, i) => store.salesActuals.set(String(i), s));
    for (const s of snap.suppliers) {
      // Key by supplierId+productId so one supplier can cover multiple SKUs later.
      store.suppliers.set(supplierKey(s.supplierId, s.productId), s);
    }
    for (const po of snap.purchaseOrders) store.purchaseOrders.set(po.poId, po);
    for (const b of snap.budgets) store.budgets.set(b.periodId, b);
    return store;
  }

  getProduct(productId: string): Product | undefined {
    return this.products.get(productId);
  }

  listProducts(): Product[] {
    return this.products.list();
  }

  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(): Node[] {
    return this.nodes.list();
  }

  getInventory(productId: string, nodeId: string): Inventory | undefined {
    return this.inventory.get(inventoryKey(productId, nodeId));
  }

  listInventory(): Inventory[] {
    return this.inventory.list();
  }

  getDemandForecast(
    productId: string,
    nodeId: string,
    horizonDays?: number
  ): DemandForecast | undefined {
    return pickByProductNode(
      this.demandForecasts.list(),
      productId,
      nodeId,
      horizonDays === undefined
        ? undefined
        : (d) => d.horizonDays === horizonDays
    );
  }

  listDemandForecasts(): DemandForecast[] {
    return this.demandForecasts.list();
  }

  getSalesActuals(
    productId: string,
    nodeId: string,
    lookbackDays?: number
  ): SalesActuals | undefined {
    return pickByProductNode(
      this.salesActuals.list(),
      productId,
      nodeId,
      lookbackDays === undefined
        ? undefined
        : (s) => s.lookbackDays === lookbackDays
    );
  }

  listSalesActuals(): SalesActuals[] {
    return this.salesActuals.list();
  }

  getSupplier(supplierId: string): Supplier | undefined {
    return this.suppliers.find((s) => s.supplierId === supplierId)[0];
  }

  listSuppliersForProduct(productId: string): Supplier[] {
    return this.suppliers.find((s) => s.productId === productId);
  }

  listSuppliers(): Supplier[] {
    return this.suppliers.list();
  }

  getPurchaseOrder(poId: string): PurchaseOrder | undefined {
    return this.purchaseOrders.get(poId);
  }

  listOpenPurchaseOrders(productId: string, nodeId: string): PurchaseOrder[] {
    return this.purchaseOrders.find(
      (po) =>
        po.productId === productId &&
        po.nodeId === nodeId &&
        OPEN_PO_STATUSES.includes(po.status)
    );
  }

  listPurchaseOrders(): PurchaseOrder[] {
    return this.purchaseOrders.list();
  }

  getBudget(periodId?: string): Budget | undefined {
    if (periodId) return this.budgets.get(periodId);
    // No periodId given: fall back to insertion order. Scenarios today seed
    // exactly one budget row, so this is unambiguous — revisit if a scenario
    // ever seeds multiple periods and callers rely on the default.
    return this.budgets.first();
  }

  listBudgets(): Budget[] {
    return this.budgets.list();
  }

  upsertPurchaseOrder(po: PurchaseOrder): PurchaseOrder {
    return this.purchaseOrders.set(po.poId, po);
  }

  updatePurchaseOrder(
    poId: string,
    patch: Partial<Omit<PurchaseOrder, 'poId'>>
  ): PurchaseOrder | undefined {
    const existing = this.purchaseOrders.get(poId);
    if (!existing) return undefined;
    return this.purchaseOrders.set(poId, { ...existing, ...patch, poId });
  }

  snapshot(): StoreSnapshot {
    return {
      products: this.listProducts(),
      nodes: this.listNodes(),
      inventory: this.listInventory(),
      demandForecasts: this.listDemandForecasts(),
      salesActuals: this.listSalesActuals(),
      suppliers: this.listSuppliers(),
      purchaseOrders: this.listPurchaseOrders(),
      budgets: this.listBudgets(),
    };
  }

  /** Independent copy so concurrent runs do not share mutations. */
  clone(): Store {
    return Store.fromSnapshot(this.snapshot());
  }
}
