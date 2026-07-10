"use client";

/*
  Cash Flow — Statement view.
  ===========================
  The Cash Flow Statement in both Direct and Indirect method, plus a Bank Summary
  and a Cash Position panel. All figures are derived from the filtered movements
  (category totals, per-bank rollups). Printable / "Save as PDF" via printHtml.
  While gated, every figure honestly reads ₹0.00 with the correct structure.
*/

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/balances";
import {
  categoryLabel,
  escapeHtml,
  indirectStatement,
  printHtml,
  rangeLabel,
  type BankAccount,
  type CashFlowKpis,
  type CashFlowTxn,
  type CategoryTotal,
  type DateRange,
  type IndirectSection,
} from "@/lib/cashflow";
import { Btn, Card, EmptyState, Money, Segmented } from "./ui";

interface BankRollup {
  account: BankAccount;
  cashIn: number;
  cashOut: number;
  closing: number;
}

export function StatementView({
  kpis,
  categories,
  bankAccounts,
  transactions,
  range,
  companyName,
}: {
  kpis: CashFlowKpis;
  categories: CategoryTotal[];
  bankAccounts: BankAccount[];
  transactions: CashFlowTxn[];
  range: DateRange;
  companyName: string;
}) {
  const [method, setMethod] = useState<"direct" | "indirect">("direct");
  const c = kpis.currency;

  const bankRollups = useMemo<BankRollup[]>(() => {
    return bankAccounts.map((account) => {
      let cashIn = 0;
      let cashOut = 0;
      for (const t of transactions) {
        if (t.bankAccountId !== account.id) continue;
        cashIn += t.cashIn || 0;
        cashOut += t.cashOut || 0;
      }
      return { account, cashIn, cashOut, closing: account.openingBalance + cashIn - cashOut };
    });
  }, [bankAccounts, transactions]);

  const netChange = categories.reduce((s, r) => s + r.net, 0);
  const indirect = useMemo(() => indirectStatement(netChange), [netChange]);

  const doPrint = () => {
    const rows =
      method === "direct"
        ? categories
            .map(
              (r) =>
                `<tr><td>${categoryLabel(r.category)}</td><td class="num">${formatMoney(r.cashIn, c)}</td><td class="num">${formatMoney(
                  r.cashOut,
                  c,
                )}</td><td class="num">${formatMoney(r.net, c)}</td></tr>`,
            )
            .join("")
        : [indirect.operating, indirect.investing, indirect.financing]
            .map(
              (section) => `
                <tr class="section"><td colspan="2">${escapeHtml(section.title)}</td></tr>
                ${section.lines
                  .map((l) => `<tr><td class="indent">${escapeHtml(l.label)}</td><td class="num">${formatMoney(l.amount, c)}</td></tr>`)
                  .join("")}
                <tr class="subtotal"><td>Net Cash from ${escapeHtml(section.title)}</td><td class="num">${formatMoney(section.total, c)}</td></tr>`,
            )
            .join("");
    const head =
      method === "direct"
        ? `<tr><th>Activity</th><th class="num">Cash In</th><th class="num">Cash Out</th><th class="num">Net</th></tr>`
        : `<tr><th>Line</th><th class="num">Amount</th></tr>`;
    const body = `
      <table><thead>${head}</thead><tbody>${rows}
        <tr class="total"><td>Net Change in Cash</td>${
          method === "direct" ? `<td></td><td></td>` : ""
        }<td class="num">${formatMoney(netChange, c)}</td></tr>
      </tbody></table>
      <table><tbody>
        <tr><td>Opening Cash</td><td class="num">${formatMoney(kpis.opening, c)}</td></tr>
        <tr class="total"><td>Closing Cash</td><td class="num">${formatMoney(kpis.closing, c)}</td></tr>
      </tbody></table>`;
    printHtml(
      `Cash Flow Statement — ${method === "direct" ? "Direct" : "Indirect"} Method`,
      `${companyName} · ${rangeLabel(range)}`,
      body,
    );
  };

  return (
    <div className="space-y-4">
      {/* Cash position strip */}
      <Card title="Cash Position" subtitle={rangeLabel(range)}>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Position label="Opening" amount={kpis.opening} currency={c} />
          <Position label="Cash In" amount={kpis.cashIn} currency={c} tone="in" />
          <Position label="Cash Out" amount={kpis.cashOut} currency={c} tone="out" />
          <Position label="Closing" amount={kpis.closing} currency={c} tone="auto" strong />
        </div>
      </Card>

      {/* Statement */}
      <Card
        title="Cash Flow Statement"
        subtitle={`${companyName} · ${rangeLabel(range)}`}
        action={
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={method}
              onChange={setMethod}
              options={[
                { value: "direct", label: "Direct" },
                { value: "indirect", label: "Indirect" },
              ]}
            />
            <Btn icon="download" onClick={doPrint} title="Print / Save as PDF">
              Print
            </Btn>
          </div>
        }
      >
        {method === "direct" ? (
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-2 font-semibold">Activity</th>
                  <th className="px-3 py-2 text-right font-semibold">Cash In</th>
                  <th className="px-3 py-2 text-right font-semibold">Cash Out</th>
                  <th className="px-3 py-2 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((r) => (
                  <tr key={r.category} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-200">{categoryLabel(r.category)}</td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.cashIn} currency={c} tone="in" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.cashOut} currency={c} tone="out" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={r.net} currency={c} tone="auto" /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                  <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100">Net Change in Cash</td>
                  <td />
                  <td />
                  <td className="px-3 py-3 text-right font-bold"><Money amount={netChange} currency={c} tone="auto" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <tbody>
                {[indirect.operating, indirect.investing, indirect.financing].map((section) => (
                  <IndirectSectionRows key={section.title} section={section} currency={c} />
                ))}
                <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                  <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100">Net Change in Cash</td>
                  <td className="px-3 py-3 text-right font-bold"><Money amount={netChange} currency={c} tone="auto" /></td>
                </tr>
              </tbody>
            </table>
            <p className="px-3 pb-2 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
              The Indirect method reconciles net income to the same cash movement the Direct method reports, starting from net income and adjusting for non-cash items and working-capital changes.
            </p>
          </div>
        )}
      </Card>

      {/* Bank summary */}
      <Card title="Bank Summary" subtitle="Movement and closing balance per bank / cash account">
        {bankRollups.length === 0 ? (
          <EmptyState
            icon="book"
            title="No bank accounts yet"
            message="Add bank & cash accounts (Bank Accounts tab) to see per-account cash summaries here."
            compact
          />
        ) : (
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-2 font-semibold">Account</th>
                  <th className="px-3 py-2 text-right font-semibold">Opening</th>
                  <th className="px-3 py-2 text-right font-semibold">Cash In</th>
                  <th className="px-3 py-2 text-right font-semibold">Cash Out</th>
                  <th className="px-3 py-2 text-right font-semibold">Closing</th>
                </tr>
              </thead>
              <tbody>
                {bankRollups.map((b) => (
                  <tr key={b.account.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-200">{b.account.name}</td>
                    <td className="px-3 py-2.5 text-right"><Money amount={b.account.openingBalance} currency={c} tone="muted" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={b.cashIn} currency={c} tone="in" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={b.cashOut} currency={c} tone="out" /></td>
                    <td className="px-3 py-2.5 text-right"><Money amount={b.closing} currency={c} tone="auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** One Indirect-method section: a header row, its line items, then a bold subtotal row. */
function IndirectSectionRows({ section, currency }: { section: IndirectSection; currency: string }) {
  return (
    <>
      <tr className="bg-slate-50 dark:bg-slate-800/40">
        <td colSpan={2} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {section.title}
        </td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.label} className="border-b border-slate-100 dark:border-slate-800">
          <td className="py-2 pl-6 pr-3 text-slate-600 dark:text-slate-300">{line.label}</td>
          <td className="px-3 py-2 text-right"><Money amount={line.amount} currency={currency} tone="auto" /></td>
        </tr>
      ))}
      <tr className="border-b border-t border-slate-200 dark:border-slate-700">
        <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">Net Cash from {section.title}</td>
        <td className="px-3 py-2.5 text-right font-semibold"><Money amount={section.total} currency={currency} tone="auto" /></td>
      </tr>
    </>
  );
}

function Position({
  label,
  amount,
  currency,
  tone,
  strong,
}: {
  label: string;
  amount: number;
  currency: string;
  tone?: "in" | "out" | "auto";
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-1 ${strong ? "text-lg font-bold" : "text-base font-semibold"}`}>
        <Money amount={amount} currency={currency} tone={tone} />
      </p>
    </div>
  );
}
