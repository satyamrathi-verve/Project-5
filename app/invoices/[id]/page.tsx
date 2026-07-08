"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, InvoiceItem, InvoiceStatus, ReceiptMode } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { StatusBadge } from "@/components/StatusBadge";

/*
  Sales Invoice — View. Read-only detail of one invoice: header, customer block,
  line items, tax + total, due date, and the amount still outstanding.

  Data notes (same rules as the list screen):
  - "Outstanding" = total minus everything allocated against it in receipt_allocations.
  - "Effectively overdue" = status open/partial AND due_date is before today with money
    still owed, even if the stored status hasn't been flipped yet.
*/

// A payment applied to this invoice (allocation joined to its parent receipt).
type Payment = {
  id: string;
  amount: number;
  receipts: {
    receipt_no: string;
    receipt_date: string;
    mode: ReceiptMode;
    reference: string | null;
  } | null;
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const fmtMoney = (n: number) => inr.format(n ?? 0);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);

function daysOverdue(dueDate: string): number {
  const ms = new Date(todayISO()).getTime() - new Date(dueDate).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

export default function InvoiceViewPage({ params }: { params: { id: string } }) {
  const [invoice, setInvoice] = useState<(Invoice & { customers: Customer | null }) | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    // The invoice + its customer, by id.
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("*, customers(*)")
      .eq("id", params.id)
      .maybeSingle();

    if (invErr) {
      setError(invErr.message);
      setLoading(false);
      return;
    }
    if (!inv) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Its line items and any payments allocated against it.
    const [{ data: lineItems, error: itemErr }, { data: allocs, error: allocErr }] =
      await Promise.all([
        supabase.from("invoice_items").select("*").eq("invoice_id", params.id),
        supabase
          .from("receipt_allocations")
          .select("id, amount, receipts(receipt_no, receipt_date, mode, reference)")
          .eq("invoice_id", params.id),
      ]);

    if (itemErr || allocErr) {
      setError((itemErr ?? allocErr)!.message);
      setLoading(false);
      return;
    }

    setInvoice(inv as unknown as Invoice & { customers: Customer | null });
    setItems((lineItems as unknown as InvoiceItem[]) ?? []);
    setPayments((allocs as unknown as Payment[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (isConfigured) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const paid = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [payments]
  );

  const outstanding = invoice ? Math.max(0, Number(invoice.total ?? 0) - paid) : 0;

  const effectiveStatus: InvoiceStatus = useMemo(() => {
    if (!invoice) return "open";
    const isLate =
      (invoice.status === "open" || invoice.status === "partial") &&
      invoice.due_date < todayISO() &&
      outstanding > 0;
    return isLate ? "overdue" : invoice.status;
  }, [invoice, outstanding]);

  const backAction = (
    <Link
      href="/invoices"
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      ← Back to list
    </Link>
  );

  // ---- States ----------------------------------------------------------

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Invoice" action={backAction} />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Invoice" action={backAction} />
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          Loading invoice…
        </div>
      </>
    );
  }

  if (notFound) {
    return (
      <>
        <PageHeader title="Invoice not found" action={backAction} />
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          <p className="font-semibold text-slate-700">We couldn&apos;t find that invoice.</p>
          <p className="mt-1 text-sm">It may have been removed. Try going back to the list.</p>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Invoice" action={backAction} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          <p className="font-semibold">Couldn&apos;t load this invoice.</p>
          <p className="mt-1 text-sm">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!invoice) return null;

  const c = invoice.customers;

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.invoice_no}`}
        subtitle={`Raised ${fmtDate(invoice.invoice_date)}`}
        action={
          <div className="flex items-center gap-3">
            <StatusBadge status={effectiveStatus} />
            {backAction}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: customer + line items */}
        <div className="space-y-6 lg:col-span-2">
          {/* Customer block */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</p>
            {c ? (
              <div className="mt-2">
                <p className="text-lg font-bold text-slate-900">{c.name}</p>
                {c.code && <p className="text-xs text-slate-400">{c.code}</p>}
                <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                  {c.contact_person && <p>{c.contact_person}</p>}
                  {c.address && <p className="whitespace-pre-line">{c.address}</p>}
                  {c.email && <p>{c.email}</p>}
                  {c.phone && <p>{c.phone}</p>}
                  {c.gstin && (
                    <p className="text-xs text-slate-400">GSTIN: {c.gstin}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Customer details unavailable.</p>
            )}
          </div>

          {/* Line items */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 font-semibold text-slate-600">Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Qty</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Rate</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      No line items on this invoice.
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-700">{it.description}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{it.qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {fmtMoney(it.rate)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">
                        {fmtMoney(it.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Payments applied */}
          {payments.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Payments applied
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-700">
                        {p.receipts?.receipt_no ?? "—"}
                        <span className="ml-2 text-xs uppercase text-slate-400">
                          {p.receipts?.mode ?? ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {fmtDate(p.receipts?.receipt_date ?? null)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-700">
                        {fmtMoney(Number(p.amount ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: totals + dates */}
        <div className="space-y-6">
          {/* Dates */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <Row label="Invoice date" value={fmtDate(invoice.invoice_date)} />
            <Row
              label="Due date"
              value={fmtDate(invoice.due_date)}
              hint={
                effectiveStatus === "overdue"
                  ? `${daysOverdue(invoice.due_date)} days late`
                  : undefined
              }
              hintTone="red"
            />
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <Row label="Subtotal" value={fmtMoney(invoice.subtotal)} />
            <Row label="Tax" value={fmtMoney(invoice.tax_amount)} />
            <div className="my-3 border-t border-slate-200" />
            <Row label="Total" value={fmtMoney(invoice.total)} strong />
            <Row label="Received" value={`− ${fmtMoney(paid)}`} valueTone="emerald" />
            <div className="my-3 border-t border-slate-200" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-slate-700">Outstanding</span>
              <span
                className={`text-xl font-bold tabular-nums ${
                  outstanding > 0 ? "text-slate-900" : "text-emerald-600"
                }`}
              >
                {fmtMoney(outstanding)}
              </span>
            </div>
          </div>

          {invoice.notes && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  strong = false,
  hint,
  hintTone,
  valueTone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  hint?: string;
  hintTone?: "red";
  valueTone?: "emerald";
}) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-sm text-slate-500">{label}</span>
      <div className="text-right">
        <span
          className={`tabular-nums ${strong ? "text-base font-bold text-slate-900" : "text-sm"} ${
            valueTone === "emerald" ? "text-emerald-700" : "text-slate-700"
          }`}
        >
          {value}
        </span>
        {hint && (
          <div className={`text-xs font-medium ${hintTone === "red" ? "text-red-600" : "text-slate-400"}`}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
