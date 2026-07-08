"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Customer, Invoice, Receipt, ReceiptAllocation, ReceiptMode } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { formatMoney } from "@/lib/balances";
import { Icon } from "@/components/icons";

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
  const [saving, setSaving] = useState(false);

  // sorting + filtering for the allocation table
  type SortKey = "invoice_no" | "due_date" | "total" | "outstanding";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due_date", dir: 1 });
  const [filters, setFilters] = useState({ invoice_no: "", due_date: "", total: "", outstanding: "" });
  // which column's filter popover is open (click the funnel in a header)
  const [openFilter, setOpenFilter] = useState<SortKey | null>(null);
  const openThRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    if (!openFilter) return;
    const onDown = (e: PointerEvent) => {
      if (openThRef.current && !openThRef.current.contains(e.target as Node)) setOpenFilter(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openFilter]);

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    const [r, c, i, a] = await Promise.all([
      supabase.from("receipts").select("*").order("receipt_date", { ascending: false }).order("receipt_no", { ascending: false }),
      supabase.from("customers").select("*").order("name"),
      supabase.from("invoices").select("*").order("due_date"),
      supabase.from("receipt_allocations").select("*"),
    ]);
    const err = r.error ?? c.error ?? i.error ?? a.error;
    if (err) setError(err.message);
    else {
      setReceipts(r.data ?? []);
      setCustomers(c.data ?? []);
      setInvoices(i.data ?? []);
      setAllocations(a.data ?? []);
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
  const allocTotal = openInvoices.reduce((s, inv) => s + (Number(alloc[inv.id]) || 0), 0);
  const unallocated = amountNum - allocTotal;

  if (!supabase) return <NotConfigured />;

  function openForm() {
    setReceiptNo(nextReceiptNo(receipts));
    setReceiptDate(today());
    setCustomerId("");
    setAmount("");
    setMode("neft");
    setReference("");
    setAlloc({});
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

  /** Spread the receipt amount over open invoices, oldest due date first. */
  function autoAllocate() {
    let left = amountNum;
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
    if (allocTotal > amountNum + 0.005)
      return setError(`You've allocated ${formatMoney(allocTotal)} but the receipt is only ${formatMoney(amountNum)}.`);

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

    // 3. flip each touched invoice's status (paid when fully settled, else partial)
    for (const row of rows) {
      const inv = openInvoices.find((i) => i.id === row.invoice_id)!;
      const left = inv.outstanding - row.amount;
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
        (rows.length ? `, allocated across ${rows.length} invoice${rows.length > 1 ? "s" : ""}.` : "."),
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
                  disabled={amountNum <= 0 || openInvoices.length === 0}
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
                            {openFilter === c.key && (
                              <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
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
                            )}
                          </th>
                        ))}
                        <th className="w-40 px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
                          Allocate (₹)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
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
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {amountNum > 0 && (
                <p
                  className={`mt-3 text-sm font-medium ${
                    unallocated < -0.005
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Received {formatMoney(amountNum)} · Allocated {formatMoney(allocTotal)} ·{" "}
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
