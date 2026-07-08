/*
  Cash Flow module — domain types.
  =================================
  These describe the SHAPE of cash-flow data the module renders. They are
  deliberately decoupled from any single database table: the "future transaction
  engine" (lib/cashflow/engine.ts) maps whatever source modules exist — Customer
  Payments, Vendor Bills, Journal Entries, Bank txns, Payroll… — into these
  normalized shapes. That is what lets one Cash Flow UI serve every future module
  without change.

  Nothing here hard-codes a value. Amounts default to 0 until real posted
  transactions flow in through the engine.
*/

/** A cash movement is either money IN or money OUT of a cash/bank account. */
export type TxnDirection = "in" | "out";

/** Every transaction type the module understands (config-driven, see config.ts). */
export type TxnTypeId =
  | "customer_payment"
  | "vendor_payment"
  | "journal_entry"
  | "bank_deposit"
  | "bank_withdrawal"
  | "transfer"
  | "payroll"
  | "loan_payment"
  | "interest"
  | "investment"
  | "tax"
  | "miscellaneous";

/** Standard cash-flow statement classification (Direct/Indirect method sections). */
export type CashFlowCategoryId = "operating" | "investing" | "financing";

/** Lifecycle of a posted cash movement. */
export type TxnStatus = "posted" | "pending" | "cleared" | "reconciled" | "void";

/** A bank / cash account cash flows through. Sourced by the engine (none today). */
export interface BankAccount {
  id: string;
  name: string;
  bank: string | null;
  accountNo: string | null;
  currency: string;
  openingBalance: number;
}

/**
 * One normalized cash movement. `cashIn` XOR `cashOut` carries the amount; the
 * other is 0. `runningBalance` is derived in logic.ts, never stored.
 */
export interface CashFlowTxn {
  id: string;
  date: string; // ISO yyyy-mm-dd
  documentNo: string;
  type: TxnTypeId;
  description: string;
  glAccountId: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  category: CashFlowCategoryId;
  cashIn: number;
  cashOut: number;
  status: TxnStatus;
  reference: string | null;
  user: string | null;
  // Optional reporting dimensions — populated when source modules carry them.
  companyId: string | null;
  department: string | null;
  location: string | null;
  project: string | null;
}

/** A transaction plus its derived running balance (post-processing output). */
export interface CashFlowRow extends CashFlowTxn {
  runningBalance: number;
}

/** The five headline numbers on the dashboard. */
export interface CashFlowKpis {
  opening: number;
  cashIn: number;
  cashOut: number;
  net: number;
  closing: number;
  currency: string;
}

/** Where a forecast line item originates (config-driven, see config.ts). */
export type ForecastSourceId =
  | "open_invoices"
  | "open_bills"
  | "recurring_expenses"
  | "payroll"
  | "scheduled_payments"
  | "expected_receipts";

/** A single projected future cash movement. */
export interface ForecastItem {
  id: string;
  date: string;
  label: string;
  source: ForecastSourceId;
  direction: TxnDirection;
  amount: number; // always positive; direction carries the sign
  reference: string | null;
}

export interface DateRange {
  start: string; // ISO yyyy-mm-dd (inclusive)
  end: string; // ISO yyyy-mm-dd (inclusive)
}

export type RangePresetId = "today" | "week" | "month" | "quarter" | "year" | "custom";

/** All active filters. `null` means "no filter on this dimension". */
export interface CashFlowFilters {
  rangePreset: RangePresetId;
  range: DateRange;
  companyId: string | null;
  bankAccountId: string | null;
  category: CashFlowCategoryId | null;
  type: TxnTypeId | null;
  department: string | null;
  location: string | null;
  project: string | null;
  /** Restricts the table to inflows / outflows only (used by those views). */
  direction: TxnDirection | null;
  search: string;
}

// ---- chart series (all derived; see logic.ts) -----------------------------

export interface PeriodPoint {
  label: string; // e.g. "Jan", "W23", "07 Jul"
  cashIn: number;
  cashOut: number;
  net: number;
}

export interface BalancePoint {
  label: string;
  date: string;
  balance: number;
}

export interface ForecastPoint {
  label: string;
  date: string;
  cashIn: number;
  cashOut: number;
  net: number;
  cumulative: number;
}

/** Everything the module needs, loaded once by the service layer. */
export interface CashFlowData {
  companyId: string | null;
  companies: { id: string; name: string }[];
  glAccounts: { id: string; code: string; name: string }[];
  bankAccounts: BankAccount[];
  transactions: CashFlowTxn[];
  forecast: ForecastItem[];
  currency: string;
  /** True while every source is a gated seam (no real transactions yet). */
  gated: boolean;
}
