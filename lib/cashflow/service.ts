/*
  Cash Flow — service layer.
  ==========================
  Orchestrates a single load for the whole module. It combines:
    • REAL dimension data that already exists in the fixed backend — the company
      row(s) and the GL accounts — so filters and drill-downs are genuinely wired,
      not faked.
    • GATED transaction data from the future transaction engine (engine.ts),
      which returns [] until a posting module ships.

  The UI never calls Supabase directly; it calls loadCashFlowData() and gets back
  a fully-typed CashFlowData bundle. Swap the engine seams on and this same call
  returns real movements — no service or UI change.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { BASE_CURRENCY } from "@/lib/balances";
import type { CashFlowData, DateRange } from "./types";
import { fetchBankAccounts, fetchForecast, fetchTransactions, isGated } from "./engine";

export interface LoadOptions {
  range?: DateRange;
  forecastDays?: number;
}

export async function loadCashFlowData(supabase: SupabaseClient, opts: LoadOptions = {}): Promise<CashFlowData> {
  const [companiesRes, glRes, bankAccounts, transactions, forecast] = await Promise.all([
    supabase.from("company").select("id, name"),
    supabase.from("gl_accounts").select("id, code, name").order("code", { ascending: true }),
    fetchBankAccounts(supabase),
    fetchTransactions(supabase, opts.range),
    fetchForecast(supabase, opts.forecastDays ?? 90),
  ]);

  const companies = (companiesRes.data ?? []).map((c) => ({ id: String(c.id), name: String(c.name ?? "Company") }));
  const glAccounts = (glRes.data ?? []).map((g) => ({
    id: String(g.id),
    code: String(g.code ?? ""),
    name: String(g.name ?? ""),
  }));

  return {
    companyId: companies[0]?.id ?? null,
    companies,
    glAccounts,
    bankAccounts,
    transactions,
    forecast,
    currency: BASE_CURRENCY,
    gated: isGated(),
  };
}
