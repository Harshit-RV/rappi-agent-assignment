export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PARTIALLY_CONFIRMED'
  | 'CANCELLED'
  | 'RECEIVED';

export type Product = {
  productId: string;
  name: string;
  casePack: number;
  unitCost: number;
  shelfLifeDays: number;
};

export type Node = {
  nodeId: string;
  name: string;
  capacityUnits: number;
  usedUnits: number;
};

export type Inventory = {
  productId: string;
  nodeId: string;
  onHand: number;
  reserved: number;
  safetyStock: number;
};

export type DemandForecast = {
  productId: string;
  nodeId: string;
  horizonDays: number;
  forecastUnits: number;
  confidence: number;
};

export type SalesActuals = {
  productId: string;
  nodeId: string;
  lookbackDays: number;
  soldUnits: number;
  forecastUnitsForSameWindow: number;
};

export type Supplier = {
  supplierId: string;
  name: string;
  productId: string;
  unitPrice: number;
  moq: number;
  leadTimeDays: number;
  availableAllocation: number;
  reliabilityScore: number;
};

export type PurchaseOrder = {
  poId: string;
  productId: string;
  supplierId: string;
  nodeId: string;
  /** What we asked the supplier for. */
  requestedQty: number;
  /** What the supplier committed to — may diverge on partial fills. */
  confirmedQty: number;
  unitPrice: number;
  status: PurchaseOrderStatus;
  expectedArrivalDays: number;
};

export type Budget = {
  periodId: string;
  currency: string;
  allocated: number;
  committed: number;
  spent: number;
};

/** The purchasing situation the agent is asked to review. */
export type PurchasingSituation = {
  productId: string;
  nodeId: string;
  recommendedQuantity: number;
  note?: string;
};

/**
 * A full world snapshot as stored on disk under data/scenarios/.
 * Seeded into a Store; each run can clone so writes stay isolated.
 */
export type Scenario = {
  id: string;
  name: string;
  description: string;
  situation: PurchasingSituation;
  products: Product[];
  nodes: Node[];
  inventory: Inventory[];
  demandForecasts: DemandForecast[];
  salesActuals: SalesActuals[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  budgets: Budget[];
};

/** Just the entity rows, no metadata — what Store seeds from and dumps back out. */
export type StoreSnapshot = Omit<Scenario, 'id' | 'name' | 'description' | 'situation'>;
