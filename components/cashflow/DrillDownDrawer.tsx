"use client";

/*
  Cash Flow — drill-down drawer.
  ==============================
  Opens when a user clicks any amount / document number. Tabs mirror the required
  drill path: Source Transaction, GL Impact, Journal Entries, Attachments, Audit
  Trail. The Source tab shows the real normalized fields of the movement; the GL
  Impact / Journal / Audit tabs derive what they honestly can and otherwise show
  a gated empty state (no journal/ledger tables exist yet) rather than fake data.
*/

import { useState } from "react";
import { Icon } from "@/components/icons";
import { formatMoney } from "@/lib/balances";
import { TXN_STATUS_LABEL, TXN_STATUS_TONE, categoryLabel, formatDate, txnTypeLabel, type CashFlowRow } from "@/lib/cashflow";
import { EmptyState, Money } from "./ui";

type Tab = "source" | "gl" | "journal" | "attachments" | "audit";
const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "source", label: "Source", icon: "receipt" },
  { id: "gl", label: "GL Impact", icon: "book" },
  { id: "journal", label: "Journal", icon: "scroll" },
  { id: "attachments", label: "Attachments", icon: "folder" },
  { id: "audit", label: "Audit Trail", icon: "clock" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  );
}

export function DrillDownDrawer({ row, currency, onClose }: { row: CashFlowRow; currency: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("source");
  const direction = row.cashIn ? "in" : "out";
  const amount = row.cashIn || row.cashOut;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-drawer animate-slide-in dark:bg-slate-900">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{txnTypeLabel(row.type)}</p>
            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-white">{row.documentNo}</h3>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">{row.description}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* amount banner */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {direction === "in" ? "Cash In" : "Cash Out"}
          </span>
          <Money amount={direction === "in" ? amount : -amount} currency={currency} tone="auto" className="text-xl font-bold" />
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "source" && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Date">{formatDate(row.date)}</Field>
              <Field label="Status">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TXN_STATUS_TONE[row.status]}`}>
                  {TXN_STATUS_LABEL[row.status]}
                </span>
              </Field>
              <Field label="Transaction Type">{txnTypeLabel(row.type)}</Field>
              <Field label="Category">{categoryLabel(row.category)}</Field>
              <Field label="GL Account">
                {row.glAccountCode ? `${row.glAccountCode} · ${row.glAccountName ?? ""}` : "—"}
              </Field>
              <Field label="Bank Account">{row.bankAccountName ?? "—"}</Field>
              <Field label="Reference">{row.reference ?? "—"}</Field>
              <Field label="User">{row.user ?? "—"}</Field>
              <Field label="Running Balance">
                <Money amount={row.runningBalance} currency={currency} tone="auto" />
              </Field>
            </dl>
          )}

          {tab === "gl" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Double-entry impact of this movement on the General Ledger.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                    <th className="py-2 font-semibold">Account</th>
                    <th className="py-2 text-right font-semibold">Debit</th>
                    <th className="py-2 text-right font-semibold">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 text-slate-700 dark:text-slate-200">
                      {direction === "in" ? row.bankAccountName ?? "Bank / Cash" : row.glAccountName ?? "Expense / Payable"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(direction === "in" ? amount : 0, currency)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(direction === "in" ? 0 : amount, currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-slate-700 dark:text-slate-200">
                      {direction === "in" ? row.glAccountName ?? "Income / Receivable" : row.bankAccountName ?? "Bank / Cash"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(direction === "in" ? 0 : amount, currency)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(direction === "in" ? amount : 0, currency)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                Derived from the movement. Full ledger posting lines will show here once the Journal Entries module is live.
              </p>
            </div>
          )}

          {tab === "journal" && (
            <EmptyState
              icon="scroll"
              title="No journal entry linked yet"
              message="When posted transactions write balanced journal lines, the originating entry will be linked here."
            />
          )}
          {tab === "attachments" && (
            <EmptyState icon="folder" title="No attachments" message="Supporting documents (receipts, advices, cheque scans) attach here per transaction." />
          )}
          {tab === "audit" && (
            <EmptyState icon="clock" title="No audit trail yet" message="Create / post / edit / reverse events are recorded here once transaction workflows exist." />
          )}
        </div>
      </div>
    </div>
  );
}
