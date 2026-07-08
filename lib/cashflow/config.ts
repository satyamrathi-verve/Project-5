/*
  Cash Flow module — configuration registries.
  =============================================
  Single source of truth for the module's METADATA (not its data): transaction
  types, statement categories, forecast sources, date presets, forecast horizons
  and table columns. The UI renders itself from these arrays, so adding a
  transaction type or column is a one-line change here — never a UI edit.

  This is metadata, not financial data: labels, icons, classifications. No amount
  is ever hard-coded.
*/

import type { IconName } from "@/components/icons";
import type {
  CashFlowCategoryId,
  ForecastSourceId,
  RangePresetId,
  TxnDirection,
  TxnStatus,
  TxnTypeId,
} from "./types";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

// ---- transaction types ----------------------------------------------------

export interface TxnTypeDef {
  id: TxnTypeId;
  label: string;
  /** Natural direction; "both" for types that can be either (transfers, journals). */
  direction: TxnDirection | "both";
  category: CashFlowCategoryId;
  icon: IconName;
}

export const TXN_TYPES: TxnTypeDef[] = [
  { id: "customer_payment", label: "Customer Payment", direction: "in", category: "operating", icon: "receipt" },
  { id: "vendor_payment", label: "Vendor Payment", direction: "out", category: "operating", icon: "file" },
  { id: "journal_entry", label: "Journal Entry", direction: "both", category: "operating", icon: "book" },
  { id: "bank_deposit", label: "Bank Deposit", direction: "in", category: "operating", icon: "download" },
  { id: "bank_withdrawal", label: "Bank Withdrawal", direction: "out", category: "operating", icon: "upload" },
  { id: "transfer", label: "Transfer", direction: "both", category: "operating", icon: "link" },
  { id: "payroll", label: "Payroll", direction: "out", category: "operating", icon: "users" },
  { id: "loan_payment", label: "Loan Payment", direction: "out", category: "financing", icon: "scroll" },
  { id: "interest", label: "Interest", direction: "both", category: "financing", icon: "trend" },
  { id: "investment", label: "Investment", direction: "both", category: "investing", icon: "bars" },
  { id: "tax", label: "Taxes", direction: "out", category: "operating", icon: "file" },
  { id: "miscellaneous", label: "Miscellaneous", direction: "both", category: "operating", icon: "dots" },
];

const TXN_TYPE_BY_ID: Record<TxnTypeId, TxnTypeDef> = TXN_TYPES.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<TxnTypeId, TxnTypeDef>,
);

export function txnTypeLabel(id: TxnTypeId): string {
  return TXN_TYPE_BY_ID[id]?.label ?? id;
}
export function txnTypeDef(id: TxnTypeId): TxnTypeDef | undefined {
  return TXN_TYPE_BY_ID[id];
}

// ---- cash-flow statement categories ---------------------------------------

export interface CategoryDef {
  id: CashFlowCategoryId;
  label: string;
  description: string;
}

export const CASH_FLOW_CATEGORIES: CategoryDef[] = [
  { id: "operating", label: "Operating Activities", description: "Cash from day-to-day trading — sales, purchases, payroll, taxes." },
  { id: "investing", label: "Investing Activities", description: "Cash from buying / selling long-term assets and investments." },
  { id: "financing", label: "Financing Activities", description: "Cash from loans, equity and interest — how the business is funded." },
];

export function categoryLabel(id: CashFlowCategoryId): string {
  return CASH_FLOW_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

// ---- transaction status ---------------------------------------------------

export const TXN_STATUS_LABEL: Record<TxnStatus, string> = {
  posted: "Posted",
  pending: "Pending",
  cleared: "Cleared",
  reconciled: "Reconciled",
  void: "Void",
};

/** Chip classes per status — light + dark, matching the GL Master status chips. */
export const TXN_STATUS_TONE: Record<TxnStatus, string> = {
  posted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  cleared: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  reconciled: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  void: "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400",
};

// ---- forecast -------------------------------------------------------------

export interface ForecastSourceDef {
  id: ForecastSourceId;
  label: string;
  direction: TxnDirection;
}

export const FORECAST_SOURCES: ForecastSourceDef[] = [
  { id: "open_invoices", label: "Open Customer Invoices", direction: "in" },
  { id: "expected_receipts", label: "Expected Receipts", direction: "in" },
  { id: "open_bills", label: "Open Vendor Bills", direction: "out" },
  { id: "recurring_expenses", label: "Recurring Expenses", direction: "out" },
  { id: "payroll", label: "Payroll", direction: "out" },
  { id: "scheduled_payments", label: "Scheduled Payments", direction: "out" },
];

export function forecastSourceLabel(id: ForecastSourceId): string {
  return FORECAST_SOURCES.find((s) => s.id === id)?.label ?? id;
}

export interface ForecastHorizon {
  days: number;
  label: string;
}
export const FORECAST_HORIZONS: ForecastHorizon[] = [
  { days: 7, label: "Next 7 Days" },
  { days: 30, label: "30 Days" },
  { days: 90, label: "90 Days" },
];

// ---- date-range presets ---------------------------------------------------

export interface RangePresetDef {
  id: RangePresetId;
  label: string;
}
export const RANGE_PRESETS: RangePresetDef[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
];

// ---- table columns (drives the column chooser) ----------------------------

export type ColumnKey =
  | "date"
  | "documentNo"
  | "type"
  | "description"
  | "glAccount"
  | "bankAccount"
  | "cashIn"
  | "cashOut"
  | "runningBalance"
  | "status"
  | "reference"
  | "user";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  align: "left" | "right";
  numeric?: boolean;
  /** Shown by default in the column chooser. */
  default: boolean;
  /** Cannot be hidden (identity columns). */
  locked?: boolean;
}

export const CASH_FLOW_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date", align: "left", default: true, locked: true },
  { key: "documentNo", label: "Document No", align: "left", default: true },
  { key: "type", label: "Transaction Type", align: "left", default: true },
  { key: "description", label: "Description", align: "left", default: true },
  { key: "glAccount", label: "GL Account", align: "left", default: true },
  { key: "bankAccount", label: "Bank Account", align: "left", default: true },
  { key: "cashIn", label: "Cash In", align: "right", numeric: true, default: true },
  { key: "cashOut", label: "Cash Out", align: "right", numeric: true, default: true },
  { key: "runningBalance", label: "Running Balance", align: "right", numeric: true, default: true },
  { key: "status", label: "Status", align: "left", default: true },
  { key: "reference", label: "Reference", align: "left", default: false },
  { key: "user", label: "User", align: "left", default: false },
];

export function defaultColumnVisibility(): Record<ColumnKey, boolean> {
  return CASH_FLOW_COLUMNS.reduce(
    (acc, c) => {
      acc[c.key] = c.default;
      return acc;
    },
    {} as Record<ColumnKey, boolean>,
  );
}
