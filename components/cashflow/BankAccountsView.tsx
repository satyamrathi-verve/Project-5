"use client";

/*
  Cash Flow — Bank Accounts view.
  ===============================
  Lists the bank / cash accounts cash flows through, with opening balance,
  period movement and current balance per account. Accounts are sourced by the
  transaction engine (engine.ts → BANK_ACCOUNTS_TABLE), which is gated today, so
  this shows an honest empty state until a Bank Accounts table exists.
*/

import { useMemo } from "react";
import { formatMoney } from "@/lib/balances";
import type { BankAccount, CashFlowTxn } from "@/lib/cashflow";
import { Card, EmptyState, Money } from "./ui";

export function BankAccountsView({
  bankAccounts,
  transactions,
  currency,
}: {
  bankAccounts: BankAccount[];
  transactions: CashFlowTxn[];
  currency: string;
}) {
  const rows = useMemo(() => {
    return bankAccounts.map((account) => {
      let cashIn = 0;
      let cashOut = 0;
      for (const t of transactions) {
        if (t.bankAccountId !== account.id) continue;
        cashIn += t.cashIn || 0;
        cashOut += t.cashOut || 0;
      }
      return { account, cashIn, cashOut, balance: account.openingBalance + cashIn - cashOut };
    });
  }, [bankAccounts, transactions]);

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div key={r.account.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.account.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {r.account.bank ?? "Bank"} {r.account.accountNo ? `· ${r.account.accountNo}` : ""}
                </p>
              </div>
              <span className="rounded-lg bg-brand/10 px-2 py-1 text-[10px] font-semibold uppercase text-brand dark:bg-brand/15 dark:text-brand-light">
                {r.account.currency}
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(r.balance, currency)}</p>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">
                In <Money amount={r.cashIn} currency={currency} tone="in" />
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Out <Money amount={r.cashOut} currency={currency} tone="out" />
              </span>
            </div>
          </div>
        ))}
      </div>

      <Card title="All Bank & Cash Accounts">
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Bank</th>
                <th className="px-3 py-2 text-right font-semibold">Opening</th>
                <th className="px-3 py-2 text-right font-semibold">Cash In</th>
                <th className="px-3 py-2 text-right font-semibold">Cash Out</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-200">{r.account.name}</td>
                  <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{r.account.bank ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right"><Money amount={r.account.openingBalance} currency={currency} tone="muted" /></td>
                  <td className="px-3 py-2.5 text-right"><Money amount={r.cashIn} currency={currency} tone="in" /></td>
                  <td className="px-3 py-2.5 text-right"><Money amount={r.cashOut} currency={currency} tone="out" /></td>
                  <td className="px-3 py-2.5 text-right"><Money amount={r.balance} currency={currency} tone="auto" className="font-medium" /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100" colSpan={5}>
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
