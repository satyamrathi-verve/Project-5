"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type {
  Company,
  Customer,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
} from "@/lib/types";
import { formatMoney } from "@/lib/balances";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { VerveLogo } from "@/components/VerveLogo";

/*
  Sales Invoice — View (one invoice in full detail, with amount still outstanding).
  Route: /invoices/[id]

  Presented as a professional TAX INVOICE on Verve Advisory letterhead.
  Outstanding is DERIVED, never stored: total − sum of this invoice's
  receipt_allocations.amount (see CLAUDE.md). We also show how it was paid down
  (the receipts that were knocked off against this invoice).
*/

/** One payment knocked off against this invoice (allocation + its parent receipt). */
interface Payment {
  id: string;
  amount: number;
  receipt_no: string | null;
  receipt_date: string | null;
  mode: string | null;
  reference: string | null;
}

/** Shape of the receipt_allocations row with its parent receipt embedded. */
interface AllocationRow {
  id: string;
  amount: number | string;
  receipts: {
    receipt_no: string | null;
    receipt_date: string | null;
    mode: string | null;
    reference: string | null;
  } | null;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Whole days that `due` is in the past (>0 means overdue). Today counts as not overdue. */
function daysOverdue(due: string | null): number {
  if (!due) return 0;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86_400_000);
}

/** Effective tax %, derived from tax_amount / subtotal. "18" not "18.00". */
function taxPercent(subtotal: number, tax: number): string {
  if (subtotal <= 0) return "0";
  const r = Math.round((tax / subtotal) * 10000) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Indian-system number to words (12,34,567 → Twelve Lakh …). */
function numToWordsIndian(numIn: number): string {
  let n = Math.floor(numIn);
  if (n === 0) return "Zero";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x);

  let words = "";
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) words += `${three(crore)} Crore `;
  if (lakh) words += `${two(lakh)} Lakh `;
  if (thousand) words += `${two(thousand)} Thousand `;
  if (n) words += three(n);
  return words.trim();
}

/** "Indian Rupees Twenty Three Thousand … Only" (with paise if any). */
function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let out = `Indian Rupees ${numToWordsIndian(rupees)}`;
  if (paise > 0) out += ` and ${numToWordsIndian(paise)} Paise`;
  return `${out} Only`;
}

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  open: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  partial: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  paid: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
  overdue: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function InvoiceViewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!supabase || !id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);

      // 1) The invoice itself.
      const invRes = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (invRes.error) {
        setError(invRes.error.message);
        setLoading(false);
        return;
      }
      if (!invRes.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const inv = invRes.data as Invoice;
      setInvoice(inv);

      // 2) Everything hanging off it, in parallel.
      const [custRes, coRes, itemRes, allocRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", inv.customer_id).maybeSingle(),
        supabase.from("company").select("*").limit(1).maybeSingle(),
        supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
        supabase
          .from("receipt_allocations")
          .select("id, amount, receipts ( receipt_no, receipt_date, mode, reference )")
          .eq("invoice_id", inv.id),
      ]);
      if (cancelled) return;

      const firstErr = custRes.error || coRes.error || itemRes.error || allocRes.error;
      if (firstErr) setError(firstErr.message);

      setCustomer((custRes.data as Customer) ?? null);
      setCompany((coRes.data as Company) ?? null);
      setItems((itemRes.data as InvoiceItem[]) ?? []);

      const allocs = (allocRes.data as unknown as AllocationRow[]) ?? [];
      setPayments(
        allocs
          .map((a) => ({
            id: a.id,
            amount: num(a.amount),
            receipt_no: a.receipts?.receipt_no ?? null,
            receipt_date: a.receipts?.receipt_date ?? null,
            mode: a.receipts?.mode ?? null,
            reference: a.receipts?.reference ?? null,
          }))
          .sort((x, y) => (x.receipt_date ?? "").localeCompare(y.receipt_date ?? "")),
      );

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const paid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const total = num(invoice?.total);
  const outstanding = Math.max(0, total - paid);
  const collectedPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const overdueDays = invoice ? daysOverdue(invoice.due_date) : 0;
  const isOverdue = outstanding > 0.005 && overdueDays > 0;
  const settled = outstanding <= 0.005;

  if (!supabase) return <NotConfigured />;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-16 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
        Loading invoice…
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <PageHeader title="Invoice not found" subtitle="We couldn't find an invoice with that link." />
        <Link href="/invoices" className="text-sm font-medium text-brand hover:underline">
          ← Back to Sales Invoices
        </Link>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Something went wrong loading this invoice."}
      </div>
    );
  }

  const taxPct = taxPercent(num(invoice.subtotal), num(invoice.tax_amount));

  return (
    <div className="mx-auto max-w-4xl">
      {/* Action bar — never printed. */}
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Invoice {invoice.invoice_no}
          </h2>
          {customer && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Billed to {customer.name}</p>}
        </div>
        <div className="flex flex-none items-center gap-2">
          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ← Back
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      {/* Money summary — quick glance on screen, hidden on the printed invoice. */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Total</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{formatMoney(total)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Received</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(paid)}</p>
        </div>
        <div
          className={`rounded-xl border p-5 ${
            settled
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
              : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Amount Outstanding
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {formatMoney(outstanding)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={invoice.status} />
            {isOverdue && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
              </span>
            )}
            {settled && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Fully paid</span>}
          </div>
        </div>
      </div>

      {/* ============ THE TAX INVOICE DOCUMENT ============ */}
      <div
        id="invoice-doc"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 print:rounded-none print:border-0 print:shadow-none"
      >
        {/* Letterhead */}
        <div className="flex flex-col gap-6 border-b-4 border-[#2b4c9c] px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div>
            <VerveLogo className="text-[24px]" />
            <div className="mt-3 space-y-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {company?.address && <p className="whitespace-pre-line">{company.address}</p>}
              {company?.gstin && <p>GSTIN: {company.gstin}</p>}
              {(company?.email || company?.phone) && (
                <p>{[company?.email, company?.phone].filter(Boolean).join("  ·  ")}</p>
              )}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-bold uppercase tracking-wide text-slate-900 dark:text-white">Tax Invoice</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{invoice.invoice_no}</p>
            <div className="mt-2 sm:flex sm:justify-end">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>

        {/* Bill To + invoice meta */}
        <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2b4c9c]">Bill To</p>
            <p className="mt-1.5 text-base font-semibold text-slate-900 dark:text-white">{customer?.name ?? "—"}</p>
            <div className="mt-1 space-y-0.5 text-sm text-slate-500 dark:text-slate-400">
              {customer?.code && <p>Customer Code: {customer.code}</p>}
              {customer?.address && <p className="whitespace-pre-line">{customer.address}</p>}
              {customer?.gstin && <p>GSTIN: {customer.gstin}</p>}
              {customer?.contact_person && <p>Attn: {customer.contact_person}</p>}
              {customer?.email && <p>{customer.email}</p>}
              {customer?.phone && <p>{customer.phone}</p>}
            </div>
          </div>
          <div className="sm:justify-self-end">
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50 print:bg-slate-50">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-8">
                  <dt className="text-slate-500 dark:text-slate-400">Invoice Date</dt>
                  <dd className="font-medium text-slate-900 dark:text-white">{fmtDate(invoice.invoice_date)}</dd>
                </div>
                <div className="flex justify-between gap-8">
                  <dt className="text-slate-500 dark:text-slate-400">Due Date</dt>
                  <dd className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
                    {fmtDate(invoice.due_date)}
                  </dd>
                </div>
                <div className="flex justify-between gap-8 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <dt className="text-slate-500 dark:text-slate-400">Balance Due</dt>
                  <dd className={`font-bold ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                    {formatMoney(outstanding)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="px-6 sm:px-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#2b4c9c] text-left text-white">
                  <th className="rounded-l-lg px-3 py-2.5 font-semibold w-10 text-center">#</th>
                  <th className="px-3 py-2.5 font-semibold">Description of Services</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-16">Qty</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">Rate</th>
                  <th className="rounded-r-lg px-3 py-2.5 text-right font-semibold w-36">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      No line items on this invoice.
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={it.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                      <td className="px-3 py-3 text-center font-medium tabular-nums text-slate-400">{i + 1}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{it.description}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {num(it.qty)} × {formatMoney(num(it.rate))} per unit
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{num(it.qty)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatMoney(num(it.rate))}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(num(it.amount))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end px-6 pt-5 sm:px-8">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
              <dd className="tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(num(invoice.subtotal))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">
                GST <span className="text-slate-400">@ {taxPct}%</span>
              </dt>
              <dd className="tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(num(invoice.tax_amount))}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
              <dt className="font-semibold text-slate-900 dark:text-white">Total</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatMoney(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Amount Received</dt>
              <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">− {formatMoney(paid)}</dd>
            </div>
            <div
              className={`-mx-3 flex justify-between rounded-lg px-3 py-2 ${
                settled ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-amber-50 dark:bg-amber-900/20"
              }`}
            >
              <dt className="font-bold text-slate-900 dark:text-white">Balance Due</dt>
              <dd className={`font-bold tabular-nums ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                {formatMoney(outstanding)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Amount in words */}
        <div className="mt-5 border-t border-slate-100 px-6 py-4 dark:border-slate-800 sm:px-8">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Amount in words: </span>
            {amountInWords(total)}
          </p>
        </div>

        {/* Collection progress */}
        <div className="px-6 pb-2 sm:px-8">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              {settled ? "Payment complete" : `${collectedPct}% collected`}
            </span>
            <span className="text-slate-400">
              {formatMoney(paid)} of {formatMoney(total)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${settled ? "bg-emerald-500" : "bg-[#2b4c9c]"}`}
              style={{ width: `${Math.max(collectedPct, paid > 0 ? 3 : 0)}%` }}
            />
          </div>
        </div>

        {/* Notes + terms footer */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 px-6 py-5 dark:border-slate-800 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
              {invoice.notes?.trim() || "—"}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Payment due by {fmtDate(invoice.due_date)}.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              For {company?.name ?? "Verve Advisory"} · This is a computer-generated invoice.
            </p>
          </div>
        </div>
      </div>

      {/* Payments knocked off against this invoice (screen only) */}
      <div className="mt-6 print:hidden">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Payments received against this invoice
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Receipt No.</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Mode</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Reference</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No payments received yet — the full amount is outstanding.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{p.receipt_no ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(p.receipt_date)}</td>
                    <td className="px-4 py-3 uppercase text-slate-600 dark:text-slate-400">{p.mode ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.reference ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatMoney(p.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
