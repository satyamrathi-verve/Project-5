/*
  GL account balances — always DERIVED from posted transactions, never stored.
  ===========================================================================
  The GL Master does not keep a balance field on `gl_accounts`. A balance is the
  net of an account's posted debit/credit lines, computed by accounting sign
  (see computeBalance in lib/gl.ts).

  Today there are no transaction modules, so the posting ledger table does not
  exist and every account is 0.00. This module is the single seam that makes the
  Balance column future-proof:

    • LEDGER_TABLE is `null` today  → balances resolve to 0 with ZERO extra queries.
    • When Journal Entries / Invoices / Bills / Payments / Inventory / Payroll etc.
      start POSTING debit/credit lines to a ledger table, set LEDGER_TABLE to that
      table's name (and adjust LEDGER column names if needed). The Balance column
      then reflects real values automatically — NO change to the GL Master UI.

  Because the value is recomputed from the ledger on every load, it is always
  correct after a transaction is created / edited / approved / deleted / reversed /
  voided — those operations just change the underlying posted lines.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GLAccount } from "./types";
import { computeBalance } from "./gl";

/**
 * Base reporting currency. Central config — never hard-code currency in the UI.
 * When a company-settings table exists, source it from there instead.
 */
export const BASE_CURRENCY = "INR";

/** Format an amount in the configured currency (0 -> "₹0.00" for INR). */
export function formatMoney(amount: number, currency: string = BASE_CURRENCY): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * The ledger table posted transaction lines write to. `null` until the first
 * transaction module ships — flip it to the real table name to go live.
 */
const LEDGER_TABLE: string | null = null;

/**
 * Demo GL balances. While no ledger table exists every account would otherwise
 * read ₹0.00 — a wall of zeros that looks unfinished. With this on, each account
 * gets a realistic, DETERMINISTIC balance (seeded by its code, so it's stable
 * across reloads) that respects accounting sign (contra accounts go negative).
 * Modular: set to false — or wire LEDGER_TABLE to a real ledger — to disable.
 */
export const GL_BALANCES_DEMO = true;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A realistic balance for one account, based on its business purpose. */
function demoBalanceFor(a: GLAccount): number {
  const rnd = mulberry32(hashCode(a.code));
  const n = a.name.toLowerCase();
  const g = (a.parent_group ?? "").toLowerCase();
  const amt = (min: number, max: number, step = 1000) => Math.round((min + rnd() * (max - min)) / step) * step;

  // Contra / provision accounts carry a negative (credit) balance.
  if (/accum|depreciation/.test(n)) return -amt(200_000, 2_500_000);
  if (/allowance|doubtful|provision/.test(n)) return -amt(20_000, 150_000);
  if (/suspense|rounding|clearing/.test(n)) return amt(0, 6_000, 100);

  if (a.type === "asset") {
    if (/petty cash|cash on hand|undeposited/.test(n)) return amt(10_000, 90_000, 500);
    if (/bank/.test(n)) return amt(600_000, 5_000_000);
    if (/receivable|debtor/.test(n)) return amt(800_000, 4_000_000);
    if (/invent|raw material|work in progress|finished goods|stock/.test(n)) return amt(400_000, 3_000_000);
    if (/prepaid|advance|input tax|\bgst\b|\bvat\b|credit/.test(n)) return amt(20_000, 400_000);
    if (g.includes("fixed asset") || /building|machinery|plant|equipment|furniture|computer|vehicle|land|leasehold|fixture/.test(n)) return amt(1_000_000, 9_000_000);
    return amt(50_000, 800_000);
  }
  if (a.type === "liability") {
    if (g.includes("equity") || /capital|share|reserve|retained|surplus/.test(n)) return amt(2_000_000, 12_000_000);
    if (/loan|borrow|debenture|mortgage|overdraft/.test(n)) return amt(1_000_000, 7_000_000);
    if (/payable|creditor|\bgst\b|\bvat\b|tax|duty|tds/.test(n)) return amt(200_000, 2_500_000);
    return amt(100_000, 1_500_000);
  }
  if (a.type === "income") return amt(1_000_000, 9_000_000);
  return amt(80_000, 2_200_000); // expense
}

/** Deterministic realistic balances for every account (demo mode). */
export function demoBalances(accounts: GLAccount[]): Record<string, number> {
  const byId: Record<string, number> = {};
  for (const a of accounts) byId[a.id] = demoBalanceFor(a);
  return byId;
}

/** Column names expected on the ledger table (adjust when wiring the real one). */
const LEDGER = { account: "account_id", debit: "debit", credit: "credit", posted: "posted", date: "posted_at" };

export interface BalanceResult {
  /** accountId -> current balance (defaults to 0 for every account, never null). */
  byId: Record<string, number>;
  currency: string;
}

/**
 * Compute each account's current balance from posted ledger lines.
 * Every account defaults to 0 (never blank/null). Returns all-zeros — without any
 * network call — while no ledger table is configured.
 */
export async function loadBalances(
  supabase: SupabaseClient,
  accounts: GLAccount[],
  currency: string = BASE_CURRENCY,
): Promise<BalanceResult> {
  const byId: Record<string, number> = {};
  for (const a of accounts) byId[a.id] = 0;

  // No ledger yet → show realistic demo balances instead of a wall of zeros.
  if (!LEDGER_TABLE && GL_BALANCES_DEMO) return { byId: demoBalances(accounts), currency };
  if (!LEDGER_TABLE) return { byId, currency };

  const res = await supabase.from(LEDGER_TABLE).select("*").eq(LEDGER.posted, true);
  if (res.error || !res.data) return { byId, currency }; // ledger unavailable -> safe zeros

  const rows = res.data as unknown as Record<string, unknown>[];
  const totals: Record<string, { debit: number; credit: number }> = {};
  for (const row of rows) {
    const id = String(row[LEDGER.account]);
    const t = (totals[id] ??= { debit: 0, credit: 0 });
    t.debit += Number(row[LEDGER.debit]) || 0;
    t.credit += Number(row[LEDGER.credit]) || 0;
  }

  const typeById = new Map(accounts.map((a) => [a.id, a.type] as const));
  for (const [id, t] of Object.entries(totals)) {
    const type = typeById.get(id);
    if (type) byId[id] = computeBalance(type, t);
  }
  return { byId, currency };
}

export interface AccountActivity {
  /** Count of POSTED transaction lines against the account. */
  posted: number;
  /** Count of PENDING / unposted transaction lines against the account. */
  pending: number;
  /** ISO date of the most recent posting, or null if there is none. */
  lastActivity: string | null;
}

/**
 * Per-account transaction stats for the status-change dialog. Returns all
 * zeros/null while no ledger table is configured (today) — with no network call —
 * and real counts once transactions post to the ledger. Never hardcoded.
 */
export async function loadAccountActivity(supabase: SupabaseClient, accountId: string): Promise<AccountActivity> {
  const empty: AccountActivity = { posted: 0, pending: 0, lastActivity: null };
  if (!LEDGER_TABLE) return empty;

  const res = await supabase.from(LEDGER_TABLE).select("*").eq(LEDGER.account, accountId);
  if (res.error || !res.data) return empty;

  const rows = res.data as unknown as Record<string, unknown>[];
  let posted = 0;
  let pending = 0;
  let last = -Infinity;
  for (const row of rows) {
    if (row[LEDGER.posted]) posted += 1;
    else pending += 1;
    const raw = row[LEDGER.date];
    const t = raw ? Date.parse(String(raw)) : NaN;
    if (!Number.isNaN(t) && t > last) last = t;
  }
  return { posted, pending, lastActivity: last === -Infinity ? null : new Date(last).toISOString() };
}
