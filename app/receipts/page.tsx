"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import type { Customer, GLAccount, Invoice, InvoiceItem, Receipt, ReceiptAllocation, ReceiptMode } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { formatMoney } from "@/lib/balances";
import { Icon } from "@/components/icons";
import { Popover } from "@/components/overlay";
import { type Deduction, setReceiptExtras, deductionTotal } from "@/lib/receiptExtras";

/*
  Receipt Entry — record money received from a customer and "knock it off"
  (allocate it against) their open invoices. Fully settled invoices flip to
  'paid'; partially settled ones flip to 'partial'.
*/

const MODES: ReceiptMode[] = ["cash", "cheque", "upi", "neft"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Next RCP-#### number after the highest existing one. */
function nextReceiptNo(receipts: Receipt[]): string {
  let max = 0;
  for (const r of receipts) {
    const m = r.receipt_no.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RCP-${String(max + 1).padStart(4, "0")}`;
}

export default function ReceiptEntryPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // form
  const [open, setOpen] = useState(false);
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");
  // invoice_id -> allocation amount typed by the user
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // invoice_id -> which service(s) this allocation is for (defaults to that invoice's line items)
  const [serviceNotes, setServiceNotes] = useState<Record<string, string>>({});
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [showDeductions, setShowDeductions] = useState(false);
  const [saving, setSaving] = useState(false);

  // sorting + filtering for the allocation table
  type SortKey = "invoice_no" | "due_date" | "total" | "outstanding";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due_date", dir: 1 });
  const [filters, setFilters] = useState({ invoice_no: "", due_date: "", total: "", outstanding: "" });
  // which column's filter popover is open (click the funnel in a header).
  // The shared overlay Popover handles portal/positioning/outside-click/Esc.
  const [openFilter, setOpenFilter] = useState<SortKey | null>(null);
  const openThRef = useRef<HTMLTableCellElement | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    const [r, c, i, a, g, ii] = await Promise.all([
      supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).order("receipt_no", { ascending: false }),
      supabase.from("customers").select("*").order("name"),
      supabase.from("invoices").select("*").order("due_date"),
      supabase.from("receipt_allocations").select("*"),
      supabase.from("gl_accounts").select("*"),
      supabase.from("invoice_items").select("*"),
    ]);
    const err = r.error ?? c.error ?? i.error ?? a.error ?? g.error ?? ii.error;
    if (err) setError(err.message);
    else {
      setReceipts(r.data ?? []);
      setCustomers(c.data ?? []);
      setInvoices(i.data ?? []);
      setAllocations(a.data ?? []);
      setGlAccounts(g.data ?? []);
      setInvoiceItems(ii.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  /** invoice_id -> comma-joined service descriptions, for the default "Services" note. */
  const servicesByInvoice = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of invoiceItems) {
      const prev = m.get(it.invoice_id);
      m.set(it.invoice_id, prev ? `${prev}, ${it.description}` : it.description);
    }
    return m;
  }, [invoiceItems]);

  /** invoice_id -> already-allocated total (from ALL receipts so far). */
  const allocatedByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) m.set(a.invoice_id, (m.get(a.invoice_id) ?? 0) + a.amount);
    return m;
  }, [allocations]);

  /** The chosen customer's invoices that still have money outstanding. */
  const openInvoices = useMemo(() => {
    if (!customerId) return [];
    return invoices
      .filter((inv) => inv.customer_id === customerId && inv.status !== "paid")
      .map((inv) => ({ ...inv, outstanding: inv.total - (allocatedByInvoice.get(inv.id) ?? 0) }))
      .filter((inv) => inv.outstanding > 0.005);
  }, [customerId, invoices, allocatedByInvoice]);

  /** Rows actually shown: filters narrow, then the active sort orders them. */
  const visibleInvoices = useMemo(() => {
    const rows = openInvoices.filter(
      (inv) =>
        inv.invoice_no.toLowerCase().includes(filters.invoice_no.trim().toLowerCase()) &&
        inv.due_date.includes(filters.due_date.trim()) &&
        (!filters.total.trim() || String(inv.total).includes(filters.total.trim())) &&
        (!filters.outstanding.trim() || String(inv.outstanding).includes(filters.outstanding.trim())),
    );
    rows.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sort.dir;
    });
    return rows;
  }, [openInvoices, filters, sort]);

  const amountNum = Number(amount) || 0;
  const deductionsTotal = deductionTotal(deductions);
  // Deductions (TDS, bank charges…) count as "accounted for" money even though
  // it never hits the bank — so they free up allocation room the same as cash.
  const availableToAllocate = amountNum + deductionsTotal;
  const allocTotal = openInvoices.reduce((s, inv) => s + (Number(alloc[inv.id]) || 0), 0);
  const unallocated = availableToAllocate - allocTotal;

  if (!supabase) return <NotConfigured />;

  function openForm() {
    setReceiptNo(nextReceiptNo(receipts));
    setReceiptDate(today());
    setCustomerId("");
    setAmount("");
    setMode("neft");
    setReference("");
    setAlloc({});
    setServiceNotes({});
    setDeductions([]);
    setShowDeductions(false);
    setFilters({ invoice_no: "", due_date: "", total: "", outstanding: "" });
    setSort({ key: "due_date", dir: 1 });
    setSuccess(null);
    setError(null);
    setOpen(true);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  /** Is this invoice ticked for full payment? (allocation equals its outstanding) */
  function isFullyAllocated(inv: { id: string; outstanding: number }) {
    return Math.abs((Number(alloc[inv.id]) || 0) - inv.outstanding) < 0.005 && inv.outstanding > 0;
  }

  function togglePayFull(inv: { id: string; outstanding: number }, checked: boolean) {
    setAlloc((a) => ({ ...a, [inv.id]: checked ? inv.outstanding.toFixed(2) : "" }));
  }

  /** Spread the receipt (cash + deductions) over open invoices, oldest due date first. */
  function autoAllocate() {
    let left = availableToAllocate;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (left <= 0) break;
      const take = Math.min(left, inv.outstanding);
      next[inv.id] = take.toFixed(2);
      left -= take;
    }
    setAlloc(next);
  }

  async function save() {
    if (!supabase) return;
    setError(null);
    if (!customerId) return setError("Pick a customer.");
    if (!receiptNo.trim()) return setError("Receipt number is required.");
    if (amountNum <= 0) return setError("Amount must be more than zero.");
    for (const inv of openInvoices) {
      const v = Number(alloc[inv.id]) || 0;
      if (v < 0) return setError(`Allocation for ${inv.invoice_no} can't be negative.`);
      if (v > inv.outstanding + 0.005)
        return setError(`Allocation for ${inv.invoice_no} is more than its outstanding (${formatMoney(inv.outstanding)}).`);
    }
    if (allocTotal > availableToAllocate + 0.005)
      return setError(
        `You've allocated ${formatMoney(allocTotal)} but only ${formatMoney(availableToAllocate)} is available (received + deductions).`
      );

    setSaving(true);

    // 1. the receipt itself
    const { data: rcpt, error: rErr } = await supabase
      .from("receipts")
      .insert({
        receipt_no: receiptNo.trim(),
        receipt_date: receiptDate,
        customer_id: customerId,
        amount: amountNum,
        mode,
        reference: reference.trim() || null,
      })
      .select()
      .single();
    if (rErr || !rcpt) {
      setSaving(false);
      return setError(rErr?.message ?? "Could not save the receipt.");
    }

    // 2. its allocations against invoices
    const rows = openInvoices
      .map((inv) => ({ receipt_id: rcpt.id, invoice_id: inv.id, amount: Number(alloc[inv.id]) || 0 }))
      .filter((r) => r.amount > 0);
    if (rows.length > 0) {
      const { error: aErr } = await supabase.from("receipt_allocations").insert(rows);
      if (aErr) {
        setSaving(false);
        return setError(aErr.message);
      }
    }

    // 2b. deductions + service notes — no backend columns for either, so they're
    // saved locally against this receipt's new id (see lib/receiptExtras.ts).
    const allocatedInvoiceIds = new Set(rows.map((r) => r.invoice_id));
    const relevantServiceNotes = Object.fromEntries(
      Object.entries(serviceNotes).filter(([invId, note]) => allocatedInvoiceIds.has(invId) && note.trim() !== "")
    );
    if (deductions.length > 0 || Object.keys(relevantServiceNotes).length > 0) {
      setReceiptExtras(rcpt.id, { deductions, serviceNotes: relevantServiceNotes });
    }

    // 3. flip each touched invoice's status (paid when fully settled, else partial).
    // A deduction counts toward settling an invoice in proportion to how much of
    // this receipt's allocation went to it — it explains a shortfall, it doesn't
    // vanish it, but it does let the invoice close out as paid.
    for (const row of rows) {
      const inv = openInvoices.find((i) => i.id === row.invoice_id)!;
      const deductionShare = allocTotal > 0 ? (deductionsTotal * row.amount) / allocTotal : 0;
      const left = inv.outstanding - row.amount - deductionShare;
      const status = left <= 0.005 ? "paid" : "partial";
      const { error: uErr } = await supabase.from("invoices").update({ status }).eq("id", inv.id);
      if (uErr) {
        setSaving(false);
        return setError(uErr.message);
      }
    }

    setSaving(false);
    setOpen(false);
    setSuccess(
      `Receipt ${receiptNo.trim()} saved — ${formatMoney(amountNum)} received` +
        (rows.length ? `, allocated across ${rows.length} invoice${rows.length > 1 ? "s" : ""}` : "") +
        (deductionsTotal > 0 ? `, plus ${formatMoney(deductionsTotal)} in deductions` : "") +
        ".",
    );
    loadAll();
  }

  const columns: Column<Receipt>[] = [
    { key: "receipt_no", header: "Receipt No", className: "w-32 font-medium" },
    { key: "receipt_date", header: "Date", className: "w-32" },
    {
      key: "customer",
      header: "Customer",
      render: (r) => customerById.get(r.customer_id)?.name ?? "—",
      value: (r) => customerById.get(r.customer_id)?.name ?? "",
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right w-36",
      render: (r) => formatMoney(r.amount),
    },
    {
      key: "mode",
      header: "Mode",
      className: "w-24 uppercase",
      render: (r) => <span className="text-xs font-semibold tracking-wide">{r.mode}</span>,
    },
    { key: "reference", header: "Reference" },
  ];

  return (
    <div>
      <PageHeader
        title="Receipt Entry"
        subtitle="Record money received and knock it off open invoices."
        action={
          <button
            onClick={openForm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + New Receipt
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300">
          {success}
        </div>
      )}

      {open && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">New Receipt</h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Receipt No">
              <input className={inputClass} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
            </FormField>
            <FormField label="Date">
              <input className={inputClass} type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </FormField>
            <FormField label="Customer">
              <select
                className={inputClass}
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setAlloc({});
                  setFilters({ invoice_no: "", due_date: "", total: "", outstanding: "" });
                  setOpenFilter(null);
                }}
              >
                <option value="">— pick a customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Amount Received (₹)">
              <input
                className={inputClass}
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </FormField>
            <FormField label="Mode">
              <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Reference (cheque no / UTR…)">
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
            <FormField label="Deductions (TDS, bank charges…)">
              <button
                type="button"
                onClick={() => setShowDeductions(true)}
                className={`${inputClass} flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-700`}
              >
                <span>
                  {deductions.length === 0
                    ? "None"
                    : `${deductions.length} item${deductions.length > 1 ? "s" : ""} · ${formatMoney(deductionsTotal)}`}
                </span>
                <Icon name="pencil" size={14} />
              </button>
            </FormField>
          </div>

          {/* Allocation table — the "knock-off" */}
          {customerId && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Allocate against open invoices
                </h4>
                <button
                  onClick={autoAllocate}
                  disabled={availableToAllocate <= 0 || openInvoices.length === 0}
                  className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand hover:text-white disabled:opacity-40"
                >
                  Auto-allocate (oldest first)
                </button>
              </div>

              {openInvoices.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                  This customer has no open invoices — the receipt will be saved as an unallocated advance.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                        <th className="w-20 px-4 py-2.5 text-center font-semibold text-slate-600 dark:text-slate-300">
                          Pay full
                        </th>
                        {(
                          [
                            { key: "invoice_no", label: "Invoice", right: false },
                            { key: "due_date", label: "Due Date", right: false },
                            { key: "total", label: "Total", right: true },
                            { key: "outstanding", label: "Outstanding", right: true },
                          ] as { key: SortKey; label: string; right: boolean }[]
                        ).map((c) => (
                          <th
                            key={c.key}
                            ref={openFilter === c.key ? openThRef : undefined}
                            className={`relative px-4 py-2.5 ${c.right ? "text-right" : ""}`}
                          >
                            <span className={`inline-flex items-center gap-1 ${c.right ? "justify-end" : ""}`}>
                              <button
                                onClick={() => toggleSort(c.key)}
                                className="font-semibold text-slate-600 hover:text-brand dark:text-slate-300"
                                title="Click to sort"
                              >
                                {c.label} {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}
                              </button>
                              <button
                                onClick={() => setOpenFilter(openFilter === c.key ? null : c.key)}
                                className={`rounded p-0.5 ${
                                  filters[c.key]
                                    ? "text-brand"
                                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                }`}
                                title={`Filter ${c.label}`}
                              >
                                <Icon name="filter" size={13} />
                              </button>
                            </span>
                            <Popover
                              open={openFilter === c.key}
                              anchorRef={openThRef}
                              onClose={() => setOpenFilter(null)}
                              align="left"
                              width={192}
                              padded={false}
                              layer="filterMenu"
                            >
                              <div className="p-2">
                                <input
                                  autoFocus
                                  className={`${inputClass} w-full px-2 py-1 text-xs`}
                                  placeholder={`Filter ${c.label}…`}
                                  value={filters[c.key]}
                                  onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "Escape") setOpenFilter(null);
                                  }}
                                />
                                <div className="mt-1.5 flex justify-between">
                                  <button
                                    onClick={() => {
                                      setFilters({ ...filters, [c.key]: "" });
                                      setOpenFilter(null);
                                    }}
                                    className="text-xs font-medium text-slate-500 hover:text-red-500"
                                  >
                                    Clear
                                  </button>
                                  <button
                                    onClick={() => setOpenFilter(null)}
                                    className="text-xs font-semibold text-brand"
                                  >
                                    Done
                                  </button>
                                </div>
                              </div>
                            </Popover>
                          </th>
                        ))}
                        <th className="w-40 px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
                          Allocate (₹)
                        </th>
                        <th className="w-56 px-4 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">
                          Services covered
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                            No invoices match these filters.
                          </td>
                        </tr>
                      ) : (
                        visibleInvoices.map((inv) => (
                          <tr key={inv.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer accent-brand"
                                checked={isFullyAllocated(inv)}
                                onChange={(e) => togglePayFull(inv, e.target.checked)}
                                title="Allocate this invoice's full outstanding"
                              />
                            </td>
                            <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{inv.invoice_no}</td>
                            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{inv.due_date}</td>
                            <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatMoney(inv.total)}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-slate-900 dark:text-white">
                              {formatMoney(inv.outstanding)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                className={`${inputClass} w-32 text-right`}
                                type="number"
                                min="0"
                                value={alloc[inv.id] ?? ""}
                                onChange={(e) => setAlloc({ ...alloc, [inv.id]: e.target.value })}
                                placeholder="0.00"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                className={`${inputClass} w-full`}
                                value={serviceNotes[inv.id] ?? servicesByInvoice.get(inv.id) ?? ""}
                                onChange={(e) => setServiceNotes({ ...serviceNotes, [inv.id]: e.target.value })}
                                placeholder="Which service(s) is this payment for?"
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {availableToAllocate > 0 && (
                <p
                  className={`mt-3 text-sm font-medium ${
                    unallocated < -0.005
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Received {formatMoney(amountNum)}
                  {deductionsTotal > 0 ? ` + ${formatMoney(deductionsTotal)} deductions` : ""} · Allocated{" "}
                  {formatMoney(allocTotal)} ·{" "}
                  {unallocated < -0.005
                    ? `Over-allocated by ${formatMoney(-unallocated)} — reduce an allocation.`
                    : `Unallocated ${formatMoney(unallocated)}`}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Receipt"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <DeductionDialog
        open={showDeductions}
        glAccounts={glAccounts}
        deductions={deductions}
        onChange={setDeductions}
        onClose={() => setShowDeductions(false)}
      />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading receipts…
        </div>
      ) : (
        <DataTable columns={columns} rows={receipts} empty="No receipts yet — record the first one." />
      )}
    </div>
  );
}

/*
  Deduction pop-up — a table of GL account + amount rows explaining why a
  receipt came in short of the invoice (TDS, bank charges, rounding…). There is
  no deductions column in the backend, so the caller saves the result locally
  against the receipt's id (lib/receiptExtras.ts) rather than to Supabase.
*/
function DeductionDialog({
  open,
  glAccounts,
  deductions,
  onChange,
  onClose,
}: {
  open: boolean;
  glAccounts: GLAccount[];
  deductions: Deduction[];
  onChange: (next: Deduction[]) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  function addRow() {
    onChange([...deductions, { id: crypto.randomUUID(), glAccountId: "", glAccountName: "", amount: 0 }]);
  }
  function updateRow(id: string, patch: Partial<Deduction>) {
    onChange(deductions.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  function removeRow(id: string) {
    onChange(deductions.filter((d) => d.id !== id));
  }

  const total = deductionTotal(deductions);

  return createPortal(
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-drawer dark:bg-slate-900">
        <div className="p-6">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Deductions</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Record what explains a shortfall — e.g. TDS deducted by the customer, or bank charges — against a GL
            account, so it's accounted for without pretending the cash arrived.
          </p>

          <div className="mt-4 space-y-2">
            {deductions.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                No deductions added yet.
              </p>
            )}
            {deductions.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1`}
                  value={d.glAccountId}
                  onChange={(e) => {
                    const acc = glAccounts.find((a) => a.id === e.target.value);
                    updateRow(d.id, { glAccountId: e.target.value, glAccountName: acc?.name ?? "" });
                  }}
                >
                  <option value="">— GL account —</option>
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  className={`${inputClass} w-28 text-right`}
                  value={d.amount || ""}
                  onChange={(e) => updateRow(d.id, { amount: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                />
                <button
                  onClick={() => removeRow(d.id)}
                  className="text-slate-400 hover:text-red-600"
                  title="Remove"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mt-3 text-sm font-medium text-brand hover:underline"
          >
            + Add deduction
          </button>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">
            <span>Total deductions</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
