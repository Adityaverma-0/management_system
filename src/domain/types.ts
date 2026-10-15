export type DayState = 
  | 'NOT_STARTED'
  | 'LOADING'
  | 'ON_ROUTE'
  | 'UNLOAD_REQUESTED'
  | 'SENT_BACK'
  | 'APPROVED'
  | 'CLOSED';

export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  unitsPerStrip: number;
  stripsPerBox: number;
  piecesPerBox: number;
}

export interface Outlet {
  id: string;
  name: string;
  status: 'Pending' | 'Visited' | 'Skipped';
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  shopName?: string;
  area?: string;
  creditLimitPaise?: number;
  outstandingBalancePaise: number;
  lastSoldTimestamp?: number;
}

export interface SaleItem {
  productId: string;
  quantityPieces: number;
  lineTotalPaise: number;
}

export type PaymentMode = 'CASH' | 'UPI' | 'CREDIT';

export interface Invoice {
  id: string; // The idempotency key
  invoiceNumber: string; // Backend daily sequence (legacy printed numbers are retained)
  businessName?: string;
  gstin?: string;
  invoiceDate?: string;
  invoiceSeq?: number;
  createdAt: number; // previously timestamp
  calendarDate: string; // YYYY-MM-DD local time, source of truth
  workDayId: string; 
  salesmanId: string;
  outletId: string; 
  customerId?: string; 
  customerName?: string; // snapshot of name at sale
  items: SaleItem[];
  totalAmountPaise: number;
  paymentMode: PaymentMode;
  paymentRef?: string; 
  previousBalancePaise?: number; 
  newBalancePaise?: number; 
  status: 'VALID' | 'VOID';
}

export type LedgerEntryType = 'LOAD_OUT' | 'LOAD_IN' | 'SALE' | 'SALE_CANCEL' | 'UNLOAD_OUT' | 'UNLOAD_IN' | 'HOLD_CARRY_FORWARD';

export interface StockLedgerEntry {
  id: string;
  timestamp: number;
  type: LedgerEntryType;
  productId: string;
  quantityPieces: number;
  locationId: string; // warehouseId or vehicleId
  referenceId?: string;
  workDayId?: string; // Added workday binding
}

export type AccountingEntryType = 'SALES_CASH' | 'SALES_UPI' | 'SALES_CREDIT' | 'CUSTOMER_RECEIVABLE' | 'REVERSAL_CASH' | 'REVERSAL_UPI' | 'REVERSAL_CREDIT' | 'REVERSAL_RECEIVABLE';

export interface AccountingLedgerEntry {
  id: string;
  timestamp: number;
  type: AccountingEntryType;
  amountPaise: number;
  customerId?: string;
  invoiceId: string;
  workDayId: string; // Added workday binding
}

export interface LoadEvent {
  id: string;
  timestamp: number;
  vehicleId: string;
  warehouseId: string;
  workDayId: string;
  phase?: 'START' | 'TOPUP';
  items: { productId: string; quantityPieces: number }[];
}

export interface WorkDay {
  workDayId: string;
  calendarDate: string; // YYYY-MM-DD
  state: DayState;
  salesmanId: string;
  vehicleId: string;
  warehouseId: string;
  routeId: string;
  openedAt: number;
  routeStartedAt?: number;
  closedAt?: number;
  openingStockSnapshot: Record<string, number>; // productId -> quantityPieces
  cashCollectedPaise: number;
  adminNote?: string;
  invoiceCounter: number;
  // Running totals for the day
  totalSalesPaise: number;
  cashSalesPaise: number;
  upiSalesPaise: number;
  creditSalesPaise: number;
  numberOfBills: number;
  itemsSold: number;

  // Hold Stock Extensions
  heldItems?: Record<string, number>;
  unloadedItems?: Record<string, number>;
  heldDays?: Record<string, number>; // How many consecutive days an item has been held
  historicalStockLevels?: Record<string, number[]>; // Ring buffer of last 7 days (opening + loaded)
  
  // Cash breakdown (End of Day)
  cashBreakdown?: Record<string, number>;
  cashTotalPaise?: number;
  noteCount?: number;
  coinCount?: number;

  pricesSnapshot?: Record<string, number>;

  // Day Stock Report
  dayStockReportSnapshot?: Record<string, DayStockReportRow>;
}

export interface DayStockReportRow {
  productId: string;
  productName: string;
  opening: number;
  loadedAtStart: number;
  topUp: number;
  totalAvailable: number;
  sold: number;
  expectedRemaining: number;
  countedRemaining: number;
  difference: number;
  salesRs: number;
  salesPaise: number;
  cancelledBillsCount: number;
  holdQty: number;
  unloadQty: number;
  timeline: { time: string, desc: string, qtyPieces: number, _ts?: number }[];
  
  // Specific requested fields for StockSummaryTable
  startFromHeldPieces?: number;
  startLoadedPieces?: number;
  soldPieces?: number;
  soldAmountPaise?: number;
  remainingToGodownPieces?: number;
  remainingHeldInVehiclePieces?: number;
  priceSnapshotPaise?: number;
}
