/*
  Cash Flow — business logic (pure, no I/O).
  ==========================================
  Every derived number the module shows is computed here from normalized
  CashFlowTxn[] and ForecastItem[]: the five KPIs, running balances, the chart
  series (in-vs-out, monthly, running balance, forecast), the statement
  breakdowns, plus filtering / sorting / pagination / faceting for the table.

  Pure and deterministic — no dates, no network, no globals — so it is trivially
  correct at 12 rows or 12 million, and safe to memoize in the UI.
*/

import {
  type BalancePoint,
  type CashFlowCategoryId,
  type CashFlowFilters,
  type CashFlowKpis,
  type CashFlowRow,
  type CashFlowTxn,
  type ForecastItem,
  type ForecastPoint,
  type PeriodPoint,
} from "./types";
import { dayLabel, inRange, monthKey, monthLabel, toISODate } from "./dates";

// ── KPIs ───────────────────────────────────────────────────────────────────

export function sumIn(txns: CashFlowTxn[]): number {
  return txns.reduce((s, t) => s + (t.cashIn || 0), 0);
}
export function sumOut(txns: CashFlowTxn[]): number {
  return txns.reduce((s, t) => s + (t.cashOut || 0), 0);
}

/**
 * The five headline numbers. `opening` is the cash on hand at the start of the
 * period (e.g. sum of bank opening balances / prior-period closing); closing =
 * opening + net. All default to 0 in the gated (no-transactions) state.
 */
export function computeKpis(txns: CashFlowTxn[], opening: number, currency: string): CashFlowKpis {
  const cashIn = sumIn(txns);
  const cashOut = sumOut(txns);
  const net = cashIn - cashOut;
  return { opening, cashIn, cashOut, net, closing: opening + net, currency };
}

// ── Ordering + running balance ──────────────────────────────────────────────

/** Chronological (date, then document no) — the order a running balance needs. */
export function chronological(txns: CashFlowTxn[]): CashFlowTxn[] {
  return [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.documentNo.localeCompare(b.documentNo)));
}

/** Attach a running balance, walking chronologically from `opening`. */
export function withRunningBalance(txns: CashFlowTxn[], opening: number): CashFlowRow[] {
  let bal = opening;
  return chronological(txns).map((t) => {
    bal += (t.cashIn || 0) - (t.cashOut || 0);
    return { ...t, runningBalance: bal };
  });
}

// ── Chart series ─────────────────────────────────────────────────────────────

/** Money in vs out, one point per calendar month present in the data. */
export function monthlySeries(txns: CashFlowTxn[]): PeriodPoint[] {
  const buckets = new Map<string, PeriodPoint>();
  for (const t of txns) {
    const key = monthKey(t.date);
    const p = buckets.get(key) ?? { label: monthLabel(key), cashIn: 0, cashOut: 0, net: 0 };
    p.cashIn += t.cashIn || 0;
    p.cashOut += t.cashOut || 0;
    p.net = p.cashIn - p.cashOut;
    buckets.set(key, p);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
}

/** Daily in vs out (used by the "Cash In vs Cash Out" chart over shorter ranges). */
export function dailySeries(txns: CashFlowTxn[]): PeriodPoint[] {
  const buckets = new Map<string, PeriodPoint>();
  for (const t of txns) {
    const p = buckets.get(t.date) ?? { label: dayLabel(t.date), cashIn: 0, cashOut: 0, net: 0 };
    p.cashIn += t.cashIn || 0;
    p.cashOut += t.cashOut || 0;
    p.net = p.cashIn - p.cashOut;
    buckets.set(t.date, p);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
}

/** Running cash balance over time, starting from `opening`. */
export function runningBalanceSeries(txns: CashFlowTxn[], opening: number): BalancePoint[] {
  const byDay = new Map<string, number>();
  for (const t of txns) byDay.set(t.date, (byDay.get(t.date) ?? 0) + (t.cashIn || 0) - (t.cashOut || 0));
  let bal = opening;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, delta]) => {
      bal += delta;
      return { label: dayLabel(date), date, balance: bal };
    });
}

// ── Forecast ─────────────────────────────────────────────────────────────────

/**
 * Bucket forecast items into daily points within [today, today+horizon] and
 * carry a cumulative projected balance starting from `openingBalance`.
 */
export function forecastPoints(
  items: ForecastItem[],
  horizonDays: number,
  today: Date,
  openingBalance: number,
): ForecastPoint[] {
  const start = toISODate(today);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + horizonDays);
  const end = toISODate(endDate);

  const byDay = new Map<string, { cashIn: number; cashOut: number }>();
  for (const it of items) {
    if (it.date < start || it.date > end) continue;
    const b = byDay.get(it.date) ?? { cashIn: 0, cashOut: 0 };
    if (it.direction === "in") b.cashIn += it.amount;
    else b.cashOut += it.amount;
    byDay.set(it.date, b);
  }

  let cumulative = openingBalance;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => {
      const net = b.cashIn - b.cashOut;
      cumulative += net;
      return { label: dayLabel(date), date, cashIn: b.cashIn, cashOut: b.cashOut, net, cumulative };
    });
}

export function forecastTotals(items: ForecastItem[], horizonDays: number, today: Date) {
  const start = toISODate(today);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + horizonDays);
  const end = toISODate(endDate);
  let expectedIn = 0;
  let expectedOut = 0;
  for (const it of items) {
    if (it.date < start || it.date > end) continue;
    if (it.direction === "in") expectedIn += it.amount;
    else expectedOut += it.amount;
  }
  return { expectedIn, expectedOut, net: expectedIn - expectedOut };
}

// ── Statement (direct method) ────────────────────────────────────────────────

export interface CategoryTotal {
  category: CashFlowCategoryId;
  cashIn: number;
  cashOut: number;
  net: number;
}

export function categoryTotals(txns: CashFlowTxn[]): CategoryTotal[] {
  const order: CashFlowCategoryId[] = ["operating", "investing", "financing"];
  const map = new Map<CashFlowCategoryId, CategoryTotal>();
  for (const c of order) map.set(c, { category: c, cashIn: 0, cashOut: 0, net: 0 });
  for (const t of txns) {
    const row = map.get(t.category);
    if (!row) continue;
    row.cashIn += t.cashIn || 0;
    row.cashOut += t.cashOut || 0;
    row.net = row.cashIn - row.cashOut;
  }
  return order.map((c) => map.get(c)!);
}

// ── Filtering ─────────────────────────────────────────────────────────────────

export function applyFilters(txns: CashFlowTxn[], f: CashFlowFilters): CashFlowTxn[] {
  const q = f.search.trim().toLowerCase();
  return txns.filter((t) => {
    if (!inRange(t.date, f.range)) return false;
    if (f.companyId && t.companyId !== f.companyId) return false;
    if (f.bankAccountId && t.bankAccountId !== f.bankAccountId) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.department && t.department !== f.department) return false;
    if (f.location && t.location !== f.location) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.direction === "in" && !(t.cashIn > 0)) return false;
    if (f.direction === "out" && !(t.cashOut > 0)) return false;
    if (q) {
      const hay = `${t.documentNo} ${t.description} ${t.glAccountName ?? ""} ${t.glAccountCode ?? ""} ${
        t.bankAccountName ?? ""
      } ${t.reference ?? ""} ${t.user ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Unique, sorted values a dimension takes across the data (for filter dropdowns). */
export function facetValues(txns: CashFlowTxn[], accessor: (t: CashFlowTxn) => string | null): string[] {
  const set = new Set<string>();
  for (const t of txns) {
    const v = accessor(t);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ── Sorting + pagination ──────────────────────────────────────────────────────

export type SortKey =
  | "date"
  | "documentNo"
  | "type"
  | "description"
  | "cashIn"
  | "cashOut"
  | "runningBalance"
  | "status";

export function sortRows(rows: CashFlowRow[], key: SortKey, dir: "asc" | "desc"): CashFlowRow[] {
  const mul = dir === "asc" ? 1 : -1;
  const numeric = key === "cashIn" || key === "cashOut" || key === "runningBalance";
  return [...rows].sort((a, b) => {
    if (numeric) return ((a[key] as number) - (b[key] as number)) * mul;
    return String(a[key]).localeCompare(String(b[key])) * mul;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Sum of bank opening balances = period opening cash (0 while gated). */
export function openingCash(bankOpeningBalances: number[]): number {
  return bankOpeningBalances.reduce((s, v) => s + v, 0);
}
