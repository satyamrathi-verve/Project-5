"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, GLAccount, Invoice, InvoiceItem } from "@/lib/types";
import { InvoiceDeductionDialog } from "@/components/InvoiceDeductionDialog";
import {
  getInvoiceDeductions,
  setInvoiceDeductions,
  invoiceDeductionTotal,
  isPostable,
  type InvoiceDeduction,
} from "@/lib/invoiceExtras";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { formatMoney } from "@/lib/balances";
import { splitGst } from "@/lib/gst";
import { invoiceGlImpact } from "@/lib/gl";
import { VERVE_SERVICES } from "@/lib/services";
import { GlImpactReview } from "@/components/GlImpactReview";

/*
  One form, two jobs: punch a brand-new invoice or edit an existing one.
  - New:  app/invoices/new/page.tsx        renders <InvoiceForm mode="create" />
  - Edit: app/invoices/[id]/edit/page.tsx   renders <InvoiceForm mode="edit" invoiceId={id} />

  Customer address / GSTIN / payment terms are shown straight from the
  customers row the moment a customer is picked — nothing to type, nothing to
  keep in sync. GST is a single stored number (`invoices.tax_amount` — the
  backend has no CGST/SGST/IGST columns and the golden rule is never to alter
  it), split for DISPLAY into CGST+SGST or IGST based on the customer's state
  (see lib/gst.ts). The GL Impact card is the same kind of preview — it shows
  what a journal entry for this invoice would look like against the real chart
  of accounts, without posting anything (see lib/gl.ts).
*/

type Line = { key: number; description: string; qty: string; rate: string };

const fmtMoney = formatMoney;
const todayISO = () => new Date().toISOString().slice(0, 10);

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

export function InvoiceForm({ mode, invoiceId }: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();
  const keyRef = useRef(1);
  const newLine = (): Line => ({ key: keyRef.current++, description: "", qty: "1", rate: "" });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(todayISO());
  const [dueEdited, setDueEdited] = useState(false);
  const [status, setStatus] = useState<Invoice["status"]>("open");
  const [gstPct, setGstPct] = useState("18");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [deductions, setDeductions] = useState<InvoiceDeduction[]>([]);
  const [showDeductions, setShowDeductions] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Load customers + chart of accounts, and (for a new invoice) suggest the next number.
  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const [{ data: custs, error: cErr }, { data: gl, error: gErr }, { data: lastInv, error: iErr }] =
        await Promise.all([
          supabase.from("customers").select("*").order("name"),
          supabase.from("gl_accounts").select("*"),
          mode === "create"
            ? supabase.from("invoices").select("invoice_no").order("invoice_no", { ascending: false }).limit(1)
            : Promise.resolve({ data: null, error: null }),
        ]);
      const err = cErr ?? gErr ?? iErr;
      if (err) setError(err.message);
      else {
        setCustomers(custs ?? []);
        setGlAccounts(gl ?? []);
        if (mode === "create") setInvoiceNo(nextInvoiceNo(lastInv?.[0]?.invoice_no ?? null));
      }
      if (mode === "create") setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Load the existing invoice + its line items when editing.
  useEffect(() => {
    if (mode !== "edit" || !invoiceId || !supabase) return;
    setDeductions(getInvoiceDeductions(invoiceId));
    (async () => {
      const [{ data: inv, error: invErr }, { data: items, error: itemsErr }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", invoiceId).single(),
        supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("id", { ascending: true }),
      ]);
      if (invErr) {
        setError(invErr.message);
        setLoading(false);
        return;
      }
      const invoice = inv as Invoice;
      const subtotal = Number(invoice.subtotal) || 0;
      setInvoiceNo(invoice.invoice_no);
      setInvoiceDate(invoice.invoice_date);
      setCustomerId(invoice.customer_id);
      setDueDate(invoice.due_date);
      setDueEdited(true); // don't let auto-fill clobber a saved due date
      setStatus(invoice.status);
      setGstPct(subtotal > 0 ? String(Math.round(((Number(invoice.tax_amount) || 0) / subtotal) * 10000) / 100) : "0");
      setNotes(invoice.notes ?? "");
      const rows = (items as InvoiceItem[] | null) ?? [];
      setLines(
        rows.length
          ? rows.map((it) => ({ key: keyRef.current++, description: it.description, qty: String(it.qty), rate: String(it.rate) }))
          : [newLine()]
      );
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, invoiceId]);

  // Auto-fill the due date from invoice date + credit days, until the user edits it.
  useEffect(() => {
    if (dueEdited) return;
    const days = selectedCustomer?.credit_days ?? 0;
    setDueDate(addDays(invoiceDate, days));
  }, [invoiceDate, selectedCustomer, dueEdited]);

  const lineAmount = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
    const gstTotal = Math.round(subtotal * ((Number(gstPct) || 0) / 100) * 100) / 100;
    const gst = splitGst(gstTotal, selectedCustomer?.address);
    return { subtotal, gstTotal, gst, total: subtotal + gstTotal };
  }, [lines, gstPct, selectedCustomer]);

  const glImpact = useMemo(
    () => invoiceGlImpact(glAccounts, { subtotal: totals.subtotal, gst: totals.gst }),
    [glAccounts, totals]
  );

  // Only complete rows count towards the displayed figures.
  const postableDeductions = useMemo(() => deductions.filter(isPostable), [deductions]);
  const deductionNet = invoiceDeductionTotal(postableDeductions);

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
    if (!invoiceNo.trim()) return setError("Please enter an invoice number.");
    if (!invoiceDate) return setError("Please enter an invoice date.");
    if (!customerId) return setError("Please pick a customer.");
    if (!dueDate) return setError("Please enter a due date.");
    if (filledLines.length === 0)
      return setError("Add at least one line item with a description and an amount.");
    // A zero-value invoice is never intentional — a negative GST rate or a line
    // that cancels out can produce one even when the lines above look filled in.
    if (totals.total <= 0)
      return setError("The invoice total is zero. Check the line amounts and the GST rate before saving.");

    setSaving(true);
    setError(null);

    const invoicePayload = {
      invoice_no: invoiceNo.trim(),
      invoice_date: invoiceDate,
      customer_id: customerId,
      due_date: dueDate,
      subtotal: totals.subtotal,
      tax_amount: totals.gstTotal,
      total: totals.total,
      status,
      notes: notes.trim() || null,
    };

    let savedId = invoiceId ?? "";

    if (mode === "create") {
      const { data: inv, error: invErr } = await supabase.from("invoices").insert(invoicePayload).select("id").single();
      if (invErr || !inv) {
        setSaving(false);
        setError(invErr?.message ?? "Could not create the invoice.");
        return;
      }
      savedId = inv.id;
    } else {
      const { error: updErr } = await supabase.from("invoices").update(invoicePayload).eq("id", invoiceId);
      if (updErr) {
        setSaving(false);
        setError(updErr.message);
        return;
      }
      const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      if (delErr) {
        setSaving(false);
        setError(delErr.message);
        return;
      }
    }

    const { error: itemErr } = await supabase.from("invoice_items").insert(
      filledLines.map((l) => ({
        invoice_id: savedId,
        description: l.description.trim(),
        qty: Number(l.qty) || 0,
        rate: Number(l.rate) || 0,
        amount: lineAmount(l),
      }))
    );

    if (itemErr) {
      setSaving(false);
      setError(`Invoice saved, but line items failed: ${itemErr.message}`);
      router.push(`/invoices/${savedId}`);
      return;
    }

    // Deductions live alongside the invoice (see lib/invoiceExtras). Half-filled
    // rows are dropped rather than saved as postings against no account.
    setInvoiceDeductions(savedId, deductions.filter(isPostable));

    router.push(`/invoices/${savedId}`);
  }

  const backAction = (
    <Link
      href="/invoices"
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      ← Back to list
    </Link>
  );

  const title = mode === "create" ? "New Invoice" : `Edit Invoice ${invoiceNo}`;

  if (!isConfigured) {
    return (
      <>
        <PageHeader title={title} action={backAction} />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title={title} action={backAction} />
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle="Pick a customer, punch the line items, and save. Due date and GST follow the customer's master record."
        action={backAction}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: header fields + customer details + line items */}
        <div className="space-y-6 lg:col-span-2">
          {/* Header */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Customer *">
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
              <FormField label="Invoice No *">
                <input
                  className={inputClass}
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="INV-0001"
                />
              </FormField>
              <FormField label="Invoice Date *">
                <input
                  type="date"
                  className={inputClass}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </FormField>
              <FormField label="Due Date *">
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
              {mode === "edit" && (
                <FormField label="Status">
                  <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as Invoice["status"])}>
                    <option value="open">Open</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </FormField>
              )}
            </div>
            {selectedCustomer && !dueEdited && (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Due date auto-filled from {selectedCustomer.name}&apos;s {selectedCustomer.credit_days}-day
                payment terms — edit it if you need to.
              </p>
            )}
          </div>

          {/* Customer details — straight from the master, nothing to retype */}
          {selectedCustomer && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Customer Details (from master)
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Address</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                    {selectedCustomer.address || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">GST Number</p>
                  <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{selectedCustomer.gstin || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Payment Terms</p>
                  <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{selectedCustomer.credit_days} days</p>
                </div>
              </div>
            </div>
          )}

          {/* Line items */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Service / Description</th>
                  <th className="w-20 px-2 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Qty</th>
                  <th className="w-32 px-2 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Rate</th>
                  <th className="w-32 px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Amount</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-2">
                      <input
                        className={`${inputClass} w-full`}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        placeholder="Pick a service or type your own…"
                        list="verve-services"
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
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">
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
            <datalist id="verve-services">
              {VERVE_SERVICES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <button onClick={addLine} className="text-sm font-medium text-brand hover:underline">
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

        {/* Right: totals, GL impact + save */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-sm text-slate-500 dark:text-slate-400">Subtotal</span>
              <span className="tabular-nums text-sm text-slate-700 dark:text-slate-300">{fmtMoney(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                GST
                <input
                  type="number"
                  min="0"
                  value={gstPct}
                  onChange={(e) => setGstPct(e.target.value)}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                %
              </span>
              <span className="tabular-nums text-sm text-slate-700 dark:text-slate-300">{fmtMoney(totals.gstTotal)}</span>
            </div>
            {totals.gstTotal > 0 && (
              <div className="mt-1 space-y-0.5 pl-1 text-xs text-slate-400 dark:text-slate-500">
                {totals.gst.intraState ? (
                  <>
                    <div className="flex justify-between">
                      <span>CGST (intra-state — {totals.gst.customerState})</span>
                      <span className="tabular-nums">{fmtMoney(totals.gst.cgst)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SGST (intra-state — {totals.gst.customerState})</span>
                      <span className="tabular-nums">{fmtMoney(totals.gst.sgst)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span>IGST (inter-state{totals.gst.customerState ? ` — ${totals.gst.customerState}` : ""})</span>
                    <span className="tabular-nums">{fmtMoney(totals.gst.igst)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="my-3 border-t border-slate-200 dark:border-slate-800" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Total</span>
              <span className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{fmtMoney(totals.total)}</span>
            </div>

            {/* Deductions post to their own GL accounts; the invoice total itself is
                unchanged, so both figures are shown rather than silently merged. */}
            <div className="my-3 border-t border-slate-200 dark:border-slate-800" />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowDeductions(true)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300"
              >
                {postableDeductions.length > 0
                  ? `Deductions (${postableDeductions.length})`
                  : "+ Add deductions"}
              </button>
              {postableDeductions.length > 0 && (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    deductionNet < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {fmtMoney(deductionNet)}
                </span>
              )}
            </div>
            {postableDeductions.length > 0 && (
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Net after deductions</span>
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                  {fmtMoney(totals.total + deductionNet)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "create" ? "Save invoice" : "Save changes"}
            </button>
            <Link
              href="/invoices"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <GlImpactReview lines={glImpact} />
      </div>

      <InvoiceDeductionDialog
        open={showDeductions}
        glAccounts={glAccounts}
        deductions={deductions}
        onChange={setDeductions}
        onClose={() => setShowDeductions(false)}
      />
    </>
  );
}
