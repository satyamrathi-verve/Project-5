/*
  Cash Flow — FUTURE TRANSACTION ENGINE (the single wiring seam).
  ==============================================================
  This is the ONLY file that knows where cash movements physically live. Every
  other layer (logic, components, views) works on the normalized shapes in
  types.ts and never touches a table. That is what makes the module future-proof
  for millions of transactions across many source modules.

  Mirrors the proven pattern in lib/balances.ts (LEDGER_TABLE = null): today NO
  posting / bank / payments tables exist in the fixed backend, so every registry
  below is EMPTY and every fetch returns [] with ZERO network calls. The whole
  Cash Flow module therefore renders ₹0.00 — honestly, not with fake data.

  ── HOW TO GO LIVE (no UI change required) ────────────────────────────────────
  When a source module ships (Customer Payments, Vendor Bills, Journal Entries,
  Bank Accounts, Payroll…), register it here:

    1. Bank accounts:  set BANK_ACCOUNTS_TABLE + BANK_COLUMNS.
    2. Cash movements: push a CashSource into CASH_SOURCES with a `map` that turns
       one source row into a CashFlowTxn (set cashIn XOR cashOut).
    3. Forecast:       push a ForecastSource into FORECAST_SOURCES_WIRING.

  The KPIs, charts, statement, forecast and table all light up automatically. For
  scale, `map` runs client-side over already-filtered/paged server queries — add
  server-side date filters in the fetchers as volumes grow.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankAccount, CashFlowTxn, DateRange, ForecastItem } from "./types";
import { CASHFLOW_DEMO, demoBankAccounts, demoForecast, demoTransactions } from "./demo";

type Row = Record<string, unknown>;

// ── Bank accounts ──────────────────────────────────────────────────────────

/** Table bank/cash accounts live in. `null` → no accounts yet. */
const BANK_ACCOUNTS_TABLE: string | null = null;

/** Column mapping for the bank-accounts table (adjust when wiring the real one). */
const BANK_COLUMNS = {
  id: "id",
  name: "name",
  bank: "bank_name",
  accountNo: "account_no",
  currency: "currency",
  openingBalance: "opening_balance",
};

export async function fetchBankAccounts(supabase: SupabaseClient): Promise<BankAccount[]> {
  if (CASHFLOW_DEMO) return demoBankAccounts();
  if (!BANK_ACCOUNTS_TABLE) return [];
  const res = await supabase.from(BANK_ACCOUNTS_TABLE).select("*");
  if (res.error || !res.data) return [];
  return (res.data as unknown as Row[]).map((r) => ({
    id: String(r[BANK_COLUMNS.id]),
    name: String(r[BANK_COLUMNS.name] ?? "Bank Account"),
    bank: (r[BANK_COLUMNS.bank] as string) ?? null,
    accountNo: (r[BANK_COLUMNS.accountNo] as string) ?? null,
    currency: String(r[BANK_COLUMNS.currency] ?? "INR"),
    openingBalance: Number(r[BANK_COLUMNS.openingBalance]) || 0,
  }));
}

// ── Cash movements ─────────────────────────────────────────────────────────

/**
 * A registered source of cash movements. `table` is queried; each row is mapped
 * to a normalized CashFlowTxn. Add one entry per posting module.
 */
export interface CashSource {
  id: string;
  table: string;
  /** Optional column to date-filter on server-side (recommended at scale). */
  dateColumn?: string;
  map: (row: Row) => CashFlowTxn;
}

/**
 * EMPTY today — no transaction modules post cash yet. See the header for how to
 * register (e.g. `receipts` → customer_payment, `receipt_allocations`, future
 * `vendor_payments`, `journal_lines`, `bank_transactions`, `payroll_runs`…).
 */
export const CASH_SOURCES: CashSource[] = [];

/** True while the engine has no wired sources (drives honest ₹0.00 empty states). */
export function isGated(): boolean {
  return !CASHFLOW_DEMO && CASH_SOURCES.length === 0;
}

export async function fetchTransactions(supabase: SupabaseClient, range?: DateRange): Promise<CashFlowTxn[]> {
  if (CASHFLOW_DEMO) return demoTransactions(new Date());
  if (CASH_SOURCES.length === 0) return [];

  const all: CashFlowTxn[] = [];
  for (const source of CASH_SOURCES) {
    let query = supabase.from(source.table).select("*");
    if (range && source.dateColumn) {
      query = query.gte(source.dateColumn, range.start).lte(source.dateColumn, range.end);
    }
    const res = await query;
    if (res.error || !res.data) continue; // a missing/unavailable source never breaks the module
    for (const row of res.data as unknown as Row[]) {
      try {
        all.push(source.map(row));
      } catch {
        /* skip a malformed row rather than crash the whole module */
      }
    }
  }
  return all;
}

// ── Forecast ───────────────────────────────────────────────────────────────

/**
 * A registered forecast source — projects future cash from open documents
 * (invoices, bills), recurring schedules, payroll, etc.
 */
export interface ForecastSourceWiring {
  id: string;
  table: string;
  map: (row: Row) => ForecastItem | null;
}

/**
 * EMPTY today. When ready, e.g. project open customer invoices:
 *   { id: "open_invoices", table: "invoices",
 *     map: (r) => r.status === "paid" ? null : {
 *       id: `inv-${r.id}`, date: String(r.due_date), label: `Invoice ${r.invoice_no}`,
 *       source: "open_invoices", direction: "in",
 *       amount: Number(r.total) || 0, reference: String(r.invoice_no) } }
 */
export const FORECAST_SOURCES_WIRING: ForecastSourceWiring[] = [];

export async function fetchForecast(supabase: SupabaseClient, _horizonDays: number): Promise<ForecastItem[]> {
  void _horizonDays;
  if (CASHFLOW_DEMO) return demoForecast(new Date());
  if (FORECAST_SOURCES_WIRING.length === 0) return [];

  const items: ForecastItem[] = [];
  for (const source of FORECAST_SOURCES_WIRING) {
    const res = await supabase.from(source.table).select("*");
    if (res.error || !res.data) continue;
    for (const row of res.data as unknown as Row[]) {
      try {
        const item = source.map(row);
        if (item) items.push(item);
      } catch {
        /* skip malformed */
      }
    }
  }
  return items;
}
