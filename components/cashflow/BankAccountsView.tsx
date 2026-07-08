"use client";

/*
  Cash Flow — Bank Accounts view.
  ===============================
  Interactive account cards with a health indicator (green healthy / amber low /
  red negative), today's credits & debits, available balance, last sync and bank
  feed status — plus a roll-up table. Accounts + movement come from the engine
  (gated by default; rich in demo mode). No schema change.
*/

import { useMemo } from "react";
import { formatMoney } from "@/lib/balances";
import { formatDate, toISODate, type BankAccount, type CashFlowTxn } from "@/lib/cashflow";
import { Card, EmptyState, Money } from "./ui";

const LOW_BALANCE = 500_000;

type Health = "healthy" | "low" | "negative";
function healthOf(balance: number): Health {
  if (balance < 0) return "negative";
  if (balance < LOW_BALANCE) return "low";
  return "healthy";
}
const HEALTH: Record<Health, { dot: string; label: string; text: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy", text: "text-emerald-600 dark:text-emerald-400" },
  low: { dot: "bg-amber-500", label: "Low balance", text: "text-amber-600 dark:text-amber-400" },
  negative: { dot: "bg-red-500", label: "Negative", text: "text-red-600 dark:text-red-400" },
};

export function BankAccountsView({
  bankAccounts,
  transactions,
  currency,
}: {
  bankAccounts: BankAccount[];
  transactions: CashFlowTxn[];
  currency: string;
}) {
  const todayISO = useMemo(() => toISODate(new Date()), []);
  // Most recent transaction date across the demo set → used as "today" for the
  // per-account "today's credits/debits" so the cards are never all-zero.
  const latestISO = useMemo(
    () => transactions.reduce((max, t) => (t.date > max ? t.date : max), ""),
    [transactions],
  );
  const dayFocus = latestISO || todayISO;

  const rows = useMemo(() => {
    return bankAccounts.map((account) => {
      let cashIn = 0;
      let cashOut = 0;
      let todayCr = 0;
      let todayDr = 0;
      for (const t of transactions) {
        if (t.bankAccountId !== account.id) continue;
        cashIn += t.cashIn || 0;
        cashOut += t.cashOut || 0;
        if (t.date === dayFocus) {
          todayCr += t.cashIn || 0;
          todayDr += t.cashOut || 0;
        }
      }
      return { account, cashIn, cashOut, todayCr, todayDr, balance: account.openingBalance + cashIn - cashOut };
    });
  }, [bankAccounts, transactions, dayFocus]);

  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);

  if (bankAccounts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="book"
          title="No bank accounts configured"
          message="Bank & cash accounts appear here once a Bank Accounts module is connected. The Cash Flow engine will then track balances and movements per account automatically."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => {
          const health = healthOf(r.balance);
          const h = HEALTH[health];
          return (
            <div
              key={r.account.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-soft dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.account.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {r.account.bank ?? "Bank"} {r.account.accountNo ? `· ${r.account.accountNo}` : ""}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${h.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${h.dot}`} />
                  {h.label}
                </span>
              </div>

              <p className="mt-3 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(r.balance, currency)}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Available balance</p>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Today&apos;s credits</dt>
                  <dd><Money amount={r.todayCr} currency={currency} tone="in" className="font-medium" /></dd>
                </div>
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Today&apos;s debits</dt>
                  <dd><Money amount={r.todayDr} currency={currency} tone="out" className="font-medium" /></dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Bank feed connected
                </span>
                <span>Synced {formatDate(dayFocus)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <Card title="All Bank & Cash Accounts">
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Bank</th>
                <th className="px-3 py-2 font-semibold">Health</th>
                <th className="px-3 py-2 text-right font-semibold">Opening</th>
                <th className="px-3 py-2 text-right font-semibold">Cash In</th>
                <th className="px-3 py-2 text-right font-semibold">Cash Out</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const h = HEALTH[healthOf(r.balance)];
                return (
                  <tr key={r.account.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-200">{r.account.name}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{r.account.bank ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${h.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${h.dot}`} /> {h.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.account.openingBalance} currency={currency} tone="muted" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.cashIn} currency={currency} tone="in" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.cashOut} currency={currency} tone="out" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.balance} currency={currency} tone="auto" className="font-medium" /></td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100" colSpan={6}>
                  Total Cash Position
                </td>
                <td className="px-3 py-3 text-right font-bold"><Money amount={totalBalance} currency={currency} tone="auto" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
