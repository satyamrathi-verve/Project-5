"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column, type DataTableHandle } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/icons";

/*
  Sales Invoice — List. Every invoice in one table with a status filter, summary
  tiles, sorting and CSV export. Overdue invoices are painted red.

  Data notes:
  - invoices only store customer_id, so we join the customer name in one query.
  - "Outstanding" = total minus everything allocated against it in receipt_allocations.
  - "Effectively overdue" = status open/partial AND due_date is before today, even if
    the stored status hasn't been flipped yet.
*/

type Row = Invoice & {
  customers: { name: string; code: string } | null;
  outstanding: number;
  effectiveStatus: InvoiceStatus;
};

const STATUS_FILTERS: { key: "all" | InvoiceStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "partial", label: "Partial" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

type SortKey = "date" | "customer" | "total" | "outstanding";

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

export default function InvoicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [columnFiltersActive, setColumnFiltersActive] = useState(false);
  const tableRef = useRef<DataTableHandle>(null);

  const [selected, setSelected] = useState<string[]>([]);
  /* { ids, label } while a delete is awaiting confirmation — one row or many. */
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  /*
    invoice_items and receipt_allocations both cascade on delete (see seed.sql),
    so removing the invoice row is enough — the database cleans up after it.
  */
  async function performDelete(ids: string[]) {
    if (!supabase || ids.length === 0) return;
    setDeleting(true);
    const { error: delErr } = await supabase.from("invoices").delete().in("id", ids);
    setDeleting(false);
    setConfirmDelete(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setSelected((s) => s.filter((id) => !ids.includes(id)));
    await load();
  }

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    // Invoices with their customer name (single join query, no N+1).
    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("*, customers(name, code)")
      .order("invoice_date", { ascending: false });

    if (invErr) {
      setError(invErr.message);
      setLoading(false);
      return;
    }

    // All allocations, summed per invoice, to work out what's still outstanding.
    const { data: allocs, error: allocErr } = await supabase
      .from("receipt_allocations")
      .select("invoice_id, amount");

    if (allocErr) {
      setError(allocErr.message);
      setLoading(false);
      return;
    }

    const paidByInvoice = new Map<string, number>();
    for (const a of allocs ?? []) {
      paidByInvoice.set(
        a.invoice_id,
        (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount ?? 0)
      );
    }

    const today = todayISO();
    const mapped: Row[] = ((invoices as unknown as Row[]) ?? []).map((inv) => {
      const outstanding = Math.max(0, Number(inv.total ?? 0) - (paidByInvoice.get(inv.id) ?? 0));
      const isLate =
        (inv.status === "open" || inv.status === "partial") &&
        inv.due_date < today &&
        outstanding > 0;
      return {
        ...inv,
        outstanding,
        effectiveStatus: isLate ? "overdue" : inv.status,
      };
    });

    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => {
    if (isConfigured) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Summary tiles — computed off the full (unfiltered) set.
  const summary = useMemo(() => {
    const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    const overdue = rows.filter((r) => r.effectiveStatus === "overdue").length;
    return { count: rows.length, overdue, outstanding };
  }, [rows]);

  // Count per status for the filter pills.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.effectiveStatus] = (c[r.effectiveStatus] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows.filter((r) => status === "all" || r.effectiveStatus === status);

    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp = a.invoice_date.localeCompare(b.invoice_date);
          break;
        case "customer":
          cmp = (a.customers?.name ?? "").localeCompare(b.customers?.name ?? "");
          break;
        case "total":
          cmp = a.total - b.total;
          break;
        case "outstanding":
          cmp = a.outstanding - b.outstanding;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [rows, status, sortKey, sortDir]);

  function exportCsv() {
    const header = [
      "Invoice No",
      "Date",
      "Customer",
      "Cust ID",
      "Due Date",
      "Total",
      "Outstanding",
      "Status",
    ];
    const lines = filtered.map((r) =>
      [
        r.invoice_no,
        r.invoice_date,
        r.customers?.name ?? "",
        r.customers?.code ?? "",
        r.due_date,
        r.total,
        r.outstanding,
        r.effectiveStatus,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<Row>[] = [
    {
      key: "invoice_no",
      header: "Invoice No",
      render: (r) => (
        <Link
          href={`/invoices/${r.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-brand hover:underline"
        >
          {r.invoice_no}
        </Link>
      ),
    },
    { key: "invoice_date", header: "Date", render: (r) => fmtDate(r.invoice_date) },
    {
      key: "due_date",
      header: "Due",
      render: (r) => (
        <div>
          <div>{fmtDate(r.due_date)}</div>
          {r.effectiveStatus === "overdue" && (
            <div className="text-xs font-medium text-red-600">
              {daysOverdue(r.due_date)} days late
            </div>
          )}
        </div>
      ),
    },
    {
      key: "custId",
      header: "Cust ID",
      value: (r) => r.customers?.code ?? "",
      render: (r) => (
        <span className="text-slate-500 dark:text-slate-400">{r.customers?.code ?? "—"}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      // Drives the header sort + Excel-style value filter for this column.
      value: (r) => r.customers?.name ?? "—",
      render: (r) => (
        <div className="font-medium text-slate-800 dark:text-slate-100">{r.customers?.name ?? "—"}</div>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right tabular-nums",
      render: (r) => fmtMoney(r.total),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right tabular-nums",
      render: (r) => (
        <span className={r.outstanding > 0 ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}>
          {fmtMoney(r.outstanding)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      // Filter/sort by the *effective* status so "overdue" is selectable in the header filter.
      value: (r) => r.effectiveStatus,
      render: (r) => <StatusBadge status={r.effectiveStatus} />,
    },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      className: "w-28",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link
            href={`/invoices/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            title="View"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Icon name="eye" size={16} />
          </Link>
          <Link
            href={`/invoices/${r.id}/edit`}
            onClick={(e) => e.stopPropagation()}
            title="Edit"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Icon name="pencil" size={16} />
          </Link>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete({ ids: [r.id], label: `invoice ${r.invoice_no}` });
            }}
            title="Delete"
            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/30"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Invoices"
        subtitle="Every invoice — filter by status, and track what's outstanding."
        action={
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Export CSV
            </button>
            <Link
              href="/invoices/new"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              + New Invoice
            </Link>
          </div>
        }
      />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <>
          {/* Summary tiles */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Total invoices" value={String(summary.count)} />
            <Tile
              label="Overdue"
              value={String(summary.overdue)}
              tone={summary.overdue > 0 ? "red" : "default"}
            />
            <Tile label="Total outstanding" value={fmtMoney(summary.outstanding)} />
            <Tile
              label="Showing"
              value={`${filtered.length} of ${rows.length}`}
              tone="muted"
            />
          </div>

          {/* Filter bar */}
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <button
              onClick={() => {
                setStatus("all");
                tableRef.current?.clearFilters();
              }}
              disabled={status === "all" && !columnFiltersActive}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              Clear filter
            </button>

            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => {
                const active = status === f.key;
                const count = statusCounts[f.key] ?? 0;
                return (
                  <button
                    key={f.key}
                    onClick={() => setStatus(f.key)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand text-white"
                        : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                    <span className={`ml-1.5 ${active ? "text-white/80" : "text-slate-400"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Table / states */}
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
              Loading invoices…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
              <p className="font-semibold">Couldn&apos;t load invoices.</p>
              <p className="mt-1 text-sm">{error}</p>
              <button
                onClick={load}
                className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
            {selected.length > 0 && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {selected.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected([])}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setConfirmDelete({ ids: selected, label: `${selected.length} invoices` })}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Delete selected
                  </button>
                </div>
              </div>
            )}
            <DataTable
              ref={tableRef}
              columns={columns}
              rows={filtered}
              selectable
              selectedIds={selected}
              onSelectionChange={setSelected}
              empty={
                rows.length === 0
                  ? "No invoices in the database yet."
                  : "No invoices match this filter."
              }
              rowClassName={(r) => (r.effectiveStatus === "overdue" ? "bg-red-50 dark:bg-red-950/40" : "")}
              onActiveFiltersChange={setColumnFiltersActive}
            />
            </>
          )}
        </>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white p-6 shadow-drawer animate-scale-in dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete {confirmDelete.label}?</h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              This also removes the line items and any receipt allocations against{" "}
              {confirmDelete.ids.length > 1 ? "them" : "it"}. Receipts themselves are kept. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => performDelete(confirmDelete.ids)}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "red" | "muted";
}) {
  const valueColor =
    tone === "red" ? "text-red-600" : tone === "muted" ? "text-slate-500" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}
