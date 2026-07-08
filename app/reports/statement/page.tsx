"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Company, Customer, Invoice, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { Icon } from "@/components/icons";

/*
  Report — Customer Statement (the "account statement PDF").
  Pick a customer and get the holistic picture: everything invoiced (debits),
  everything received (credits, incl. part payments) in date order with a
  running balance, plus summary tiles — total billed, total paid, outstanding,
  last payment, overdue amount and how old it is.

  Print-ready: the browser's Print → Save as PDF turns this into the statement
  file the Auto Email Shoot "attaches" to its reminder emails
  (linked via /reports/statement?customer=<id>).
*/

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const dmed = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

interface LedgerRow {
  id: string;
  date: string; // ISO date, "" for the opening row
  particulars: string;
  ref: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

function StatementInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [company, setCompany] = useState<Company | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocations, setAllocations] = useState<{ invoice_id: string; amount: number }[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = params.get("customer") ?? "";
  const customer = customers.find((c) => c.id === selectedId) ?? null;

  // One-time: company header + the customer picker list.
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [coRes, custRes] = await Promise.all([
        supabase!.from("company").select("*").limit(1),
        supabase!.from("customers").select("*").order("name"),
      ]);
      if (coRes.error || custRes.error) setError((coRes.error || custRes.error)!.message);
      setCompany((coRes.data?.[0] as Company) ?? null);
      setCustomers((custRes.data as Customer[]) ?? []);
      setLoadingBase(false);
    })();
  }, []);

  // Per-customer: their invoices, receipts, and allocations.
  useEffect(() => {
    if (!supabase || !selectedId) return;
    (async () => {
      setLoadingLedger(true);
      setError(null);
      const [invRes, rcptRes, allocRes] = await Promise.all([
        supabase!.from("invoices").select("*").eq("customer_id", selectedId).order("invoice_date"),
        supabase!.from("receipts").select("*").eq("customer_id", selectedId).order("receipt_date"),
        supabase!.from("receipt_allocations").select("invoice_id, amount"),
      ]);
      if (invRes.error || rcptRes.error || allocRes.error) {
        setError((invRes.error || rcptRes.error || allocRes.error)!.message);
      } else {
        setInvoices((invRes.data as Invoice[]) ?? []);
        setReceipts((rcptRes.data as Receipt[]) ?? []);
        setAllocations(allocRes.data ?? []);
      }
      setLoadingLedger(false);
    })();
  }, [selectedId]);

  const ledger = useMemo<LedgerRow[]>(() => {
    if (!customer) return [];
    type Entry = { date: string; kind: 0 | 1; particulars: string; ref: string; debit: number | null; credit: number | null; id: string };
    const entries: Entry[] = [
      ...invoices.map<Entry>((i) => ({
        date: i.invoice_date,
        kind: 0, // invoices before receipts on the same day
        particulars: `Invoice ${i.invoice_no}`,
        ref: i.invoice_no,
        debit: Number(i.total),
        credit: null,
        id: `inv-${i.id}`,
      })),
      ...receipts.map<Entry>((r) => ({
        date: r.receipt_date,
        kind: 1,
        particulars: `Receipt ${r.receipt_no} (${r.mode.toUpperCase()}${r.reference ? ` · ${r.reference}` : ""})`,
        ref: r.receipt_no,
        debit: null,
        credit: Number(r.amount),
        id: `rcpt-${r.id}`,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind - b.kind));

    let balance = Number(customer.opening_balance) || 0;
    const rows: LedgerRow[] = [
      { id: "opening", date: "", particulars: "Opening balance", ref: "", debit: null, credit: null, balance },
    ];
    for (const e of entries) {
      balance += (e.debit ?? 0) - (e.credit ?? 0);
      rows.push({ ...e, balance });
    }
    return rows;
  }, [customer, invoices, receipts]);

  const summary = useMemo(() => {
    if (!customer) return null;
    const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalReceived = receipts.reduce((s, r) => s + Number(r.amount), 0);
    const closing = (Number(customer.opening_balance) || 0) + totalInvoiced - totalReceived;

    const lastReceipt = receipts.length
      ? receipts.reduce((a, b) => (a.receipt_date > b.receipt_date ? a : b))
      : null;

    const paidByInvoice = new Map<string, number>();
    for (const a of allocations) {
      paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let overdueAmount = 0;
    let oldestDays = 0;
    let partPaid = 0;
    for (const i of invoices) {
      const alloc = paidByInvoice.get(i.id) ?? 0;
      const out = Number(i.total) - alloc;
      if (alloc > 0 && out > 0) partPaid++;
      if (i.status === "paid" || out <= 0) continue;
      const due = new Date(`${i.due_date}T00:00:00`);
      if (due < today) {
        overdueAmount += out;
        oldestDays = Math.max(oldestDays, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
      }
    }
    return { totalInvoiced, totalReceived, closing, lastReceipt, overdueAmount, oldestDays, partPaid };
  }, [customer, invoices, receipts, allocations]);

  if (!supabase) return <NotConfigured />;

  return (
    <div>
      {/* Screen-only chrome: picker + print button */}
      <div className="print:hidden">
        <PageHeader
          title="Customer Statement"
          subtitle="The full account story for one customer — print it or save it as the PDF."
          action={
            customer && (
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                <Icon name="download" size={17} />
                Print / Save as PDF
              </button>
            )
          }
        />
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="mb-6">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</span>
            <select
              className={inputClass}
              value={selectedId}
              onChange={(e) =>
                router.replace(e.target.value ? `/reports/statement?customer=${e.target.value}` : "/reports/statement", { scroll: false })
              }
            >
              <option value="">Pick a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loadingBase || (selectedId && loadingLedger) ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading statement…
        </div>
      ) : !customer ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Pick a customer above to see their statement.
        </div>
      ) : (
        /* The statement document — this is what prints. */
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 print:rounded-none print:border-0 print:bg-white print:p-0 sm:p-8">
          {/* Company + title */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white print:text-black">{company?.name ?? "—"}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{company?.address}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {company?.gstin && <>GSTIN: {company.gstin} · </>}
                {company?.email} · {company?.phone}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold uppercase tracking-wide text-brand">Account Statement</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">As at {dmed.format(new Date())}</p>
            </div>
          </div>

          {/* Customer block */}
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Statement for</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white print:text-black">
              {customer.name} <span className="font-normal text-slate-400">({customer.code})</span>
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {customer.address && <>{customer.address} · </>}
              {customer.email ?? "no email on file"}
              {customer.phone && <> · {customer.phone}</>}
            </p>
          </div>

          {/* Summary tiles — the holistic picture */}
          {summary && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Total invoiced" value={inr.format(summary.totalInvoiced)} />
              <Tile label="Total paid" value={inr.format(summary.totalReceived)} />
              <Tile
                label="Outstanding"
                value={inr.format(summary.closing)}
                accent={summary.closing > 0 ? "red" : "green"}
              />
              <Tile
                label="Last payment"
                value={summary.lastReceipt ? inr.format(Number(summary.lastReceipt.amount)) : "—"}
                sub={summary.lastReceipt ? `${dmed.format(new Date(summary.lastReceipt.receipt_date))} · ${summary.lastReceipt.mode.toUpperCase()}` : "no payments yet"}
              />
              <Tile
                label="Overdue now"
                value={summary.overdueAmount > 0 ? inr.format(summary.overdueAmount) : "—"}
                sub={summary.overdueAmount > 0 ? `oldest ${summary.oldestDays} days` : "nothing overdue"}
                accent={summary.overdueAmount > 0 ? "red" : undefined}
              />
              <Tile
                label="Part-paid invoices"
                value={String(summary.partPaid)}
                sub={summary.partPaid > 0 ? "partially settled" : "none"}
              />
            </div>
          )}

          {/* Ledger */}
          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 print:rounded-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50 print:bg-slate-100">
                  <th className="px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300 print:text-black">Date</th>
                  <th className="px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300 print:text-black">Particulars</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300 print:text-black">Debit</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300 print:text-black">Credit</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300 print:text-black">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      row.id === "opening" ? "bg-slate-50/60 italic dark:bg-slate-800/30" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{row.date ? dmed.format(new Date(row.date)) : ""}</td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 print:text-black">{row.particulars}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300 print:text-black">
                      {row.debit !== null ? inr.format(row.debit) : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right text-green-700 dark:text-green-400 print:text-black">
                      {row.credit !== null ? inr.format(row.credit) : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-800 dark:text-slate-200 print:text-black">
                      {inr.format(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Closing strip */}
          {summary && (
            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800/50 print:bg-slate-100">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300 print:text-black">
                Closing balance — what {customer.name} still owes
              </span>
              <span className={`text-lg font-bold ${summary.closing > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"} print:text-black`}>
                {inr.format(summary.closing)}
              </span>
            </div>
          )}

          <p className="mt-5 text-center text-xs text-slate-400 print:text-slate-500">
            Computer-generated statement · {company?.name} · {dmed.format(new Date())}
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "red" | "green" }) {
  const valueCls =
    accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "green"
        ? "text-green-600 dark:text-green-400"
        : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800 print:break-inside-avoid">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${valueCls} print:text-black`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function StatementPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading statement…
        </div>
      }
    >
      <StatementInner />
    </Suspense>
  );
}
