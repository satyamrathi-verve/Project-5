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

/** Column names expected on the ledger table (adjust when wiring the real one). */
const LEDGER = { account: "account_id", debit: "debit", credit: "credit", posted: "posted" };

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
