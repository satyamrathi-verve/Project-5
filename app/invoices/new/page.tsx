"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";

/*
  Sales Invoice — Punch (create). Pick a customer, add line items (qty × rate →
  amount), set a tax %, and save. The due date auto-fills from the customer's
  credit days. On save we insert the invoice, then its line items, then open the
  new invoice's View screen.

  Data notes:
  - subtotal = sum of line amounts; tax_amount = subtotal × tax% ; total = the two.
  - due_date = invoice_date + the selected customer's credit_days.
  - New invoices are saved as status 'open'; overdue is derived later at display time.
*/

type Line = { key: number; description: string; qty: string; rate: string };

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const fmtMoney = (n: number) => inr.format(Number.isFinite(n) ? n : 0);

const todayISO = () => new Date().toISOString().slice(0, 10);

// invoice_date + n days, as an ISO date string.
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 0));
  return d.toISOString().slice(0, 10);
}

// "INV-0007" -> "INV-0008"; falls back to INV-0001 if nothing parses.
function nextInvoiceNo(latest: string | null): string {
  const m = latest?.match(/^(.*?)(\d+)$/);
  if (!m) return "INV-0001";
  const [, prefix, digits] = m;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${next}`;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const keyRef = useRef(1);
  const newLine = (): Line => ({ key: keyRef.current++, description: "", qty: "1", rate: "" });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(todayISO());
  const [dueEdited, setDueEdited] = useState(false);
  const [taxPct, setTaxPct] = useState("18");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  // Load customers + suggest the next invoice number.
  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const [{ data: custs, error: cErr }, { data: lastInv, error: iErr }] = await Promise.all([
        supabase.from("customers").select("*").order("name"),
        supabase.from("invoices").select("invoice_no").order("invoice_no", { ascending: false }).limit(1),
      ]);
      if (cErr || iErr) setError((cErr ?? iErr)!.message);
      else {
        setCustomers(custs ?? []);
        setInvoiceNo(nextInvoiceNo(lastInv?.[0]?.invoice_no ?? null));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Auto-fill the due date from invoice date + credit days, until the user edits it.
  useEffect(() => {
    if (dueEdited) return;
    const days = selectedCustomer?.credit_days ?? 0;
    setDueDate(addDays(invoiceDate, days));
  }, [invoiceDate, selectedCustomer, dueEdited]);

  const lineAmount = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
    const tax = Math.round(subtotal * ((Number(taxPct) || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxPct]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, newLine()]);
  }
  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  }

  async function save() {
    if (!supabase) return;
    const filledLines = lines.filter((l) => l.description.trim() && lineAmount(l) > 0);
    if (!customerId) return setError("Please pick a customer.");
    if (!invoiceNo.trim()) return setError("Please enter an invoice number.");
    if (filledLines.length === 0)
      return setError("Add at least one line item with a description and an amount.");

    setSaving(true);
    setError(null);

    // 1) Insert the invoice header and get its new id back.
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        invoice_no: invoiceNo.trim(),
        invoice_date: invoiceDate,
        customer_id: customerId,
        due_date: dueDate,
        subtotal: totals.subtotal,
        tax_amount: totals.tax,
        total: totals.total,
        status: "open",
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (invErr || !inv) {
      setSaving(false);
      setError(invErr?.message ?? "Could not create the invoice.");
      return;
    }

    // 2) Insert its line items.
    const { error: itemErr } = await supabase.from("invoice_items").insert(
      filledLines.map((l) => ({
        invoice_id: inv.id,
        description: l.description.trim(),
        qty: Number(l.qty) || 0,
        rate: Number(l.rate) || 0,
        amount: lineAmount(l),
      }))
    );

    if (itemErr) {
      setSaving(false);
      // Header saved but items failed — send them to the invoice so nothing looks lost.
      setError(`Invoice saved, but line items failed: ${itemErr.message}`);
      router.push(`/invoices/${inv.id}`);
      return;
    }

    // 3) Open the new invoice.
    router.push(`/invoices/${inv.id}`);
  }

  const backAction = (
    <Link
      href="/invoices"
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      ← Back to list
    </Link>
  );

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="New Invoice" action={backAction} />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="New Invoice" action={backAction} />
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New Invoice"
        subtitle="Pick a customer, punch the line items, and save."
        action={backAction}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: header fields + line items */}
        <div className="space-y-6 lg:col-span-2">
          {/* Header */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Customer">
                <select
                  className={inputClass}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `(${c.code})` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Invoice No">
                <input
                  className={inputClass}
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="INV-0001"
                />
              </FormField>
              <FormField label="Invoice Date">
                <input
                  type="date"
                  className={inputClass}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </FormField>
              <FormField label="Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={dueDate}
                  onChange={(e) => {
                    setDueEdited(true);
                    setDueDate(e.target.value);
                  }}
                />
              </FormField>
            </div>
            {selectedCustomer && !dueEdited && (
              <p className="mt-2 text-xs text-slate-400">
                Due date auto-filled from {selectedCustomer.name}&apos;s {selectedCustomer.credit_days}-day
                credit terms — edit it if you need to.
              </p>
            )}
          </div>

          {/* Line items */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 font-semibold text-slate-600">Description</th>
                  <th className="w-20 px-2 py-3 text-right font-semibold text-slate-600">Qty</th>
                  <th className="w-32 px-2 py-3 text-right font-semibold text-slate-600">Rate</th>
                  <th className="w-32 px-4 py-3 text-right font-semibold text-slate-600">Amount</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <input
                        className={`${inputClass} w-full`}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        placeholder="Item or service…"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`${inputClass} w-full text-right`}
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`${inputClass} w-full text-right`}
                        value={l.rate}
                        onChange={(e) => updateLine(l.key, { rate: e.target.value })}
                        placeholder="0"
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                      {fmtMoney(lineAmount(l))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length === 1}
                        title="Remove line"
                        className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-4 py-3">
              <button
                onClick={addLine}
                className="text-sm font-medium text-brand hover:underline"
              >
                + Add line
              </button>
            </div>
          </div>

          <FormField label="Notes (optional)">
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to note on this invoice…"
            />
          </FormField>
        </div>

        {/* Right: totals + save */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-sm text-slate-500">Subtotal</span>
              <span className="tabular-nums text-sm text-slate-700">{fmtMoney(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2 text-sm text-slate-500">
                Tax
                <input
                  type="number"
                  min="0"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                />
                %
              </span>
              <span className="tabular-nums text-sm text-slate-700">{fmtMoney(totals.tax)}</span>
            </div>
            <div className="my-3 border-t border-slate-200" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">
                {fmtMoney(totals.total)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save invoice"}
            </button>
            <Link
              href="/invoices"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
