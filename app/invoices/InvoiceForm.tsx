"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, InvoiceItem } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";

/*
  One form, two jobs: punch a brand-new invoice or edit an existing one.
  - New:  app/invoices/new/page.tsx        renders <InvoiceForm mode="create" />
  - Edit: app/invoices/[id]/edit/page.tsx   renders <InvoiceForm mode="edit" invoiceId={id} />
  Due date auto-fills from the selected customer's credit_days, but the team can
  still override it by hand — once they touch the field, auto-fill stops nudging it.
*/

type Row = { key: string; description: string; qty: string; rate: string };

const emptyRow = (): Row => ({ key: crypto.randomUUID(), description: "", qty: "1", rate: "0" });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceForm({ mode, invoiceId }: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [status, setStatus] = useState<Invoice["status"]>("open");
  const [taxAmount, setTaxAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  // Load customers for the dropdown.
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("customers")
      .select("*")
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setCustomers(data ?? []);
      });
  }, []);

  // Suggest the next invoice number for a brand-new invoice.
  useEffect(() => {
    if (mode !== "create" || !supabase) return;
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => {
        const next = (count ?? 0) + 1;
        setInvoiceNo(`INV-${String(next).padStart(4, "0")}`);
      });
  }, [mode]);

  // Load the existing invoice + its line items when editing.
  useEffect(() => {
    if (mode !== "edit" || !invoiceId || !supabase) return;
    setLoading(true);
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
      if (itemsErr) setError(itemsErr.message);

      const invoice = inv as Invoice;
      setInvoiceNo(invoice.invoice_no);
      setInvoiceDate(invoice.invoice_date);
      setCustomerId(invoice.customer_id);
      setDueDate(invoice.due_date);
      setDueDateTouched(true); // don't clobber a saved due date on load
      setStatus(invoice.status);
      setTaxAmount(String(invoice.tax_amount ?? 0));
      setNotes(invoice.notes ?? "");
      setRows(
        (items as InvoiceItem[] | null)?.length
          ? (items as InvoiceItem[]).map((it) => ({
              key: it.id,
              description: it.description,
              qty: String(it.qty),
              rate: String(it.rate),
            }))
          : [emptyRow()]
      );
      setLoading(false);
    })();
  }, [mode, invoiceId]);

  // Auto-fill due date from invoice date + the customer's credit days, unless overridden.
  useEffect(() => {
    if (dueDateTouched) return;
    if (!selectedCustomer || !invoiceDate) return;
    setDueDate(addDays(invoiceDate, selectedCustomer.credit_days));
  }, [selectedCustomer, invoiceDate, dueDateTouched]);

  const subtotal = rows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
  const total = subtotal + (Number(taxAmount) || 0);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);

    if (!customerId) {
      setError("Pick a customer.");
      return;
    }
    const cleanRows = rows.filter((r) => r.description.trim() !== "");
    if (cleanRows.length === 0) {
      setError("Add at least one line item.");
      return;
    }

    setSaving(true);
    setSavedMessage(null);

    const invoicePayload = {
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      customer_id: customerId,
      due_date: dueDate,
      subtotal,
      tax_amount: Number(taxAmount) || 0,
      total,
      status,
      notes: notes.trim() === "" ? null : notes,
    };

    let savedInvoiceId = invoiceId ?? "";

    if (mode === "create") {
      const { data, error } = await supabase.from("invoices").insert(invoicePayload).select("id").single();
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      savedInvoiceId = data.id;
    } else {
      const { error } = await supabase.from("invoices").update(invoicePayload).eq("id", invoiceId);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      // Simplest reliable way to sync line items: clear and re-insert.
      const { error: delError } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      if (delError) {
        setError(delError.message);
        setSaving(false);
        return;
      }
    }

    const itemsPayload = cleanRows.map((r) => ({
      invoice_id: savedInvoiceId,
      description: r.description,
      qty: Number(r.qty) || 0,
      rate: Number(r.rate) || 0,
      amount: (Number(r.qty) || 0) * (Number(r.rate) || 0),
    }));
    const { error: itemsError } = await supabase.from("invoice_items").insert(itemsPayload);
    if (itemsError) {
      setError(itemsError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSavedMessage(`Saved ${invoicePayload.invoice_no} — total ₹${total.toFixed(2)}.`);

    if (mode === "create") {
      router.replace(`/invoices/${savedInvoiceId}/edit`);
    }
  }

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <p className="text-sm text-slate-500">Loading invoice…</p>;

  return (
    <>
      <PageHeader
        title={mode === "create" ? "Punch a Sales Invoice" : `Edit Invoice ${invoiceNo}`}
        subtitle="Due date fills in automatically from the customer's credit days — override it if you need to."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {savedMessage && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {savedMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Invoice No.">
              <input
                className={inputClass}
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Invoice Date">
              <input
                type="date"
                className={inputClass}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Customer">
              <select
                className={inputClass}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a customer…
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={`Due Date${selectedCustomer ? ` (credit ${selectedCustomer.credit_days}d)` : ""}`}>
              <input
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(e) => {
                  setDueDateTouched(true);
                  setDueDate(e.target.value);
                }}
                required
              />
            </FormField>

            <FormField label="Status">
              <select
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as Invoice["status"])}
              >
                <option value="open">Open</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </FormField>

            <FormField label="Tax Amount">
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
              />
            </FormField>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Line Items</h3>
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add row
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-3 py-2 font-semibold text-slate-600">Description</th>
                  <th className="w-24 px-3 py-2 font-semibold text-slate-600">Qty</th>
                  <th className="w-32 px-3 py-2 font-semibold text-slate-600">Rate</th>
                  <th className="w-32 px-3 py-2 font-semibold text-slate-600">Amount</th>
                  <th className="w-12 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const amount = (Number(r.qty) || 0) * (Number(r.rate) || 0);
                  return (
                    <tr key={r.key} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <input
                          className={`${inputClass} w-full`}
                          value={r.description}
                          onChange={(e) => updateRow(r.key, { description: e.target.value })}
                          placeholder="Item / service description"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={`${inputClass} w-full`}
                          value={r.qty}
                          onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={`${inputClass} w-full`}
                          value={r.rate}
                          onChange={(e) => updateRow(r.key, { rate: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-700">₹{amount.toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(r.key)}
                          className="text-slate-400 hover:text-red-600"
                          aria-label="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax</span>
              <span>₹{(Number(taxAmount) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
              <span>Total</span>
              <span>₹{total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <FormField label="Notes">
            <textarea
              className={`${inputClass} min-h-24`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for this invoice"
            />
          </FormField>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "create" ? "Save Invoice" : "Save Changes"}
          </button>
        </div>
      </form>
    </>
  );
}
