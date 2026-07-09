"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { FormField, inputClass } from "@/components/FormField";

/*
  Sales Invoice — List. Every invoice in one table with a search box, a status
  filter, summary tiles, sorting and CSV export. Overdue invoices are painted red.

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

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [dueDate, setDueDate] = useState(""); // ISO yyyy-mm-dd; "" = no due-date filter
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      const matchesStatus = status === "all" || r.effectiveStatus === status;
      const matchesSearch =
        !q ||
        r.invoice_no.toLowerCase().includes(q) ||
        (r.customers?.name ?? "").toLowerCase().includes(q) ||
        (r.customers?.code ?? "").toLowerCase().includes(q);
      const matchesDue = !dueDate || (r.due_date ?? "").slice(0, 10) === dueDate;
      return matchesStatus && matchesSearch && matchesDue;
    });

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
  }, [rows, search, status, dueDate, sortKey, sortDir]);

  function exportCsv() {
    const header = [
      "Invoice No",
      "Date",
      "Customer",
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
      key: "customer",
      header: "Customer",
      // Drives the header sort + Excel-style value filter for this column.
      value: (r) => r.customers?.name ?? "—",
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800 dark:text-slate-100">{r.customers?.name ?? "—"}</div>
          {r.customers?.code && (
            <div className="text-xs text-slate-400 dark:text-slate-500">{r.customers.code}</div>
          )}
        </div>
      ),
    },
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
  ];

  return (
    <>
      <PageHeader
        title="Sales Invoices"
        subtitle="Every invoice — search, filter by status, and track what's outstanding."
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
            <div className="flex items-end gap-3">
              <div className="w-56">
                <FormField label="Search">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Invoice no. or customer…"
                    className={`${inputClass} w-full`}
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Due date">
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputClass}
                    />
                    {dueDate && (
                      <button
                        onClick={() => setDueDate("")}
                        title="Clear due-date filter"
                        className="rounded px-2 py-2 text-sm text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </FormField>
              </div>
            </div>

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
            <DataTable
              columns={columns}
              rows={filtered}
              empty={
                rows.length === 0
                  ? "No invoices in the database yet."
                  : "No invoices match your search or filter."
              }
              rowClassName={(r) => (r.effectiveStatus === "overdue" ? "bg-red-50 dark:bg-red-950/40" : "")}
            />
          )}
        </>
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
