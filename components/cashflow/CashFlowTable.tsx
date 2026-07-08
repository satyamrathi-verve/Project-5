"use client";

/*
  Cash Flow — the transaction table.
  ==================================
  A self-contained, reusable ledger grid: sortable sticky headers, per-column
  Excel-style value filters, a column chooser, pagination, zebra rows, status
  chips, type badges, clickable amounts (drill-down) and Excel/CSV/PDF/Print
  export of exactly what's on screen. Presentation-only — it renders whatever
  CashFlowRow[] it is given (already globally filtered by the FilterBar), so it
  works identically at 12 rows or 12 million.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  CASH_FLOW_COLUMNS,
  PAGE_SIZES,
  TXN_STATUS_LABEL,
  TXN_STATUS_TONE,
  defaultColumnVisibility,
  emailReport,
  exportCsv,
  exportXlsx,
  formatDate,
  pageCount,
  paginate,
  printReport,
  shareLink,
  sortRows,
  txnTypeLabel,
  type CashFlowRow,
  type ColumnDef,
  type ColumnKey,
  type SortKey,
} from "@/lib/cashflow";
import { inputClass } from "@/components/FormField";
import { Btn, EmptyState, IconAction, Money, Popover } from "./ui";

const SORTABLE: Partial<Record<ColumnKey, SortKey>> = {
  date: "date",
  documentNo: "documentNo",
  type: "type",
  description: "description",
  cashIn: "cashIn",
  cashOut: "cashOut",
  runningBalance: "runningBalance",
  status: "status",
};

// Columns that support Excel-style value filters (categorical dimensions).
const FILTERABLE: ColumnKey[] = ["type", "glAccount", "bankAccount", "status"];

function facetOf(row: CashFlowRow, key: ColumnKey): string {
  switch (key) {
    case "type":
      return txnTypeLabel(row.type);
    case "glAccount":
      return row.glAccountCode ? `${row.glAccountCode} · ${row.glAccountName ?? ""}`.trim() : row.glAccountName ?? "(none)";
    case "bankAccount":
      return row.bankAccountName ?? "(none)";
    case "status":
      return TXN_STATUS_LABEL[row.status] ?? row.status;
    default:
      return "";
  }
}

// ── Excel-style value filter (checkbox list) ──────────────────────────────────

function ExcelColumnFilter({
  values,
  selected,
  onApply,
  onClose,
  onSort,
}: {
  values: string[];
  selected: string[] | null;
  onApply: (next: string[] | null) => void;
  onClose: () => void;
  onSort?: (dir: "asc" | "desc") => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => (selected ? new Set(selected) : new Set(values)));
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? values.filter((v) => v.toLowerCase().includes(n)) : values;
  }, [values, q]);
  const shownAll = shown.length > 0 && shown.every((v) => draft.has(v));

  const toggle = (v: string) =>
    setDraft((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  const apply = () => {
    const isAll = values.length > 0 && draft.size === values.length && values.every((v) => draft.has(v));
    onApply(isAll ? null : [...draft]);
    onClose();
  };

  return (
    <div className="flex w-full flex-col text-xs">
      {onSort && (
        <div className="border-b border-slate-100 p-1 dark:border-slate-700">
          {([["asc", "Sort A → Z", "↑"], ["desc", "Sort Z → A", "↓"]] as const).map(([dir, lbl, glyph]) => (
            <button
              key={dir}
              onClick={() => {
                onSort(dir);
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <span className="w-3 text-center text-slate-400">{glyph}</span>
              {lbl}
            </button>
          ))}
        </div>
      )}
      <div className="p-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${inputClass} w-full py-1.5 text-xs`} />
      </div>
      <div className="max-h-56 overflow-y-auto px-1.5">
        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
          <input
            type="checkbox"
            checked={shownAll}
            onChange={() =>
              setDraft((prev) => {
                const n = new Set(prev);
                if (shownAll) shown.forEach((v) => n.delete(v));
                else shown.forEach((v) => n.add(v));
                return n;
              })
            }
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          (Select All)
        </label>
        {shown.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
            <input type="checkbox" checked={draft.has(v)} onChange={() => toggle(v)} className="h-3.5 w-3.5 rounded border-slate-300" />
            <span className="truncate" title={v}>
              {v || "(blank)"}
            </span>
          </label>
        ))}
        {shown.length === 0 && <p className="px-2 py-3 text-center text-slate-400">No matches</p>}
      </div>
      <div className="flex items-center justify-between gap-1 border-t border-slate-100 p-1.5 dark:border-slate-700">
        <button
          onClick={() => {
            onApply(null);
            onClose();
          }}
          className="rounded px-2 py-1 font-medium text-slate-500 hover:text-red-600 dark:text-slate-400"
        >
          Clear
        </button>
        <div className="flex gap-1">
          <button onClick={onClose} className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button onClick={apply} className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-dark">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Header cell (sort + filter, portal popover so it never clips) ─────────────

function HeadCell({
  col,
  sortActive,
  sortDir,
  onSort,
  facetValues,
  filterSel,
  onFilter,
}: {
  col: ColumnDef;
  sortActive: boolean;
  sortDir: "asc" | "desc";
  onSort?: () => void;
  facetValues?: string[];
  filterSel?: string[] | null;
  onFilter?: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const filterable = !!facetValues && !!onFilter;
  const filterActive = filterable && filterSel != null;

  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 ${col.align === "right" ? "text-right" : "text-left"}`}>
      <div className={`flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
        {onSort ? (
          <button onClick={onSort} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
            {col.label}
            <span className={`text-[10px] ${sortActive ? "text-brand dark:text-brand-light" : "text-slate-300 dark:text-slate-600"}`}>
              {sortActive ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
            </span>
          </button>
        ) : (
          <span>{col.label}</span>
        )}
        {filterable && (
          <span ref={anchor} className="relative inline-flex">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={`Filter ${col.label}`}
              className={`rounded p-0.5 transition ${
                filterActive ? "text-brand dark:text-brand-light" : "text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
              }`}
            >
              <Icon name="filter" size={13} filled={filterActive} />
            </button>
            <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} width={224} padded={false}>
              <ExcelColumnFilter
                values={facetValues!}
                selected={filterSel ?? null}
                onApply={onFilter!}
                onClose={() => setOpen(false)}
              />
            </Popover>
          </span>
        )}
      </div>
    </th>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function CashFlowTable({
  rows,
  currency,
  onDrill,
  title = "Cash Flow Transactions",
  subtitle,
}: {
  rows: CashFlowRow[];
  currency: string;
  onDrill: (row: CashFlowRow) => void;
  title?: string;
  subtitle?: string;
}) {
  const [visibility, setVisibility] = useState<Record<ColumnKey, boolean>>(defaultColumnVisibility);
  const [colFilters, setColFilters] = useState<Partial<Record<ColumnKey, string[] | null>>>({});
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const colBtn = useRef<HTMLButtonElement>(null);
  const exportBtn = useRef<HTMLButtonElement>(null);
  const [colOpen, setColOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [colSearch, setColSearch] = useState("");
  const [shareNote, setShareNote] = useState(false);

  const visibleCols = useMemo(() => CASH_FLOW_COLUMNS.filter((c) => visibility[c.key]), [visibility]);

  // facet options per filterable column (from the full input set)
  const facets = useMemo(() => {
    const out: Partial<Record<ColumnKey, string[]>> = {};
    for (const key of FILTERABLE) {
      const set = new Set<string>();
      for (const r of rows) set.add(facetOf(r, key));
      out[key] = [...set].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [rows]);

  // pipeline: column filters → sort
  const derived = useMemo(() => {
    let out = rows;
    for (const key of FILTERABLE) {
      const sel = colFilters[key];
      if (sel != null) {
        const allow = new Set(sel);
        out = out.filter((r) => allow.has(facetOf(r, key)));
      }
    }
    return sortRows(out, sortKey, sortDir);
  }, [rows, colFilters, sortKey, sortDir]);

  const total = derived.length;
  const pages = pageCount(total, pageSize);
  const current = Math.min(page, pages);
  const pageRows = useMemo(() => paginate(derived, current, pageSize), [derived, current, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [rows, colFilters, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const exportCtx = () => ({ columns: visibleCols, rows: derived, title, subtitle, currency });
  const activeColFilters = FILTERABLE.filter((k) => colFilters[k] != null).length;

  // totals across the full filtered set (drives the always-visible summary bar)
  const totals = useMemo(() => {
    let ci = 0;
    let co = 0;
    for (const r of derived) {
      ci += r.cashIn || 0;
      co += r.cashOut || 0;
    }
    return { ci, co, net: ci - co };
  }, [derived]);

  const shownCols = useMemo(() => {
    const q = colSearch.trim().toLowerCase();
    return q ? CASH_FLOW_COLUMNS.filter((c) => c.label.toLowerCase().includes(q)) : CASH_FLOW_COLUMNS;
  }, [colSearch]);
  const setAll = (on: boolean) =>
    setVisibility((v) => {
      const next = { ...v };
      for (const c of CASH_FLOW_COLUMNS) if (!c.locked) next[c.key] = on;
      return next;
    });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {total} {total === 1 ? "transaction" : "transactions"}
            {activeColFilters > 0 ? ` · ${activeColFilters} column filter${activeColFilters > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={colBtn}
            type="button"
            onClick={() => setColOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Icon name="grid" size={16} /> Columns
          </button>
          <Popover open={colOpen} anchorRef={colBtn} onClose={() => setColOpen(false)} width={240} padded={false}>
            <div className="flex items-center justify-between gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-slate-700">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Columns</span>
              <div className="flex gap-1 text-[11px]">
                <button onClick={() => setAll(true)} className="rounded px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">Show all</button>
                <button onClick={() => setAll(false)} className="rounded px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">Hide all</button>
                <button onClick={() => setVisibility(defaultColumnVisibility())} className="rounded px-1.5 py-0.5 font-medium text-brand hover:bg-brand/10 dark:text-brand-light">Reset</button>
              </div>
            </div>
            <div className="p-1.5">
              <input
                value={colSearch}
                onChange={(e) => setColSearch(e.target.value)}
                placeholder="Search columns…"
                className={`${inputClass} w-full py-1.5 text-xs`}
              />
            </div>
            <div className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
              {shownCols.map((c) => (
                <label
                  key={c.key}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    c.locked ? "opacity-50" : "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
                  } text-slate-700 dark:text-slate-200`}
                >
                  <input
                    type="checkbox"
                    disabled={c.locked}
                    checked={visibility[c.key]}
                    onChange={(e) => setVisibility((v) => ({ ...v, [c.key]: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  {c.label}
                </label>
              ))}
              {shownCols.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-400">No columns match</p>}
            </div>
          </Popover>

          <button
            ref={exportBtn}
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Icon name="download" size={16} /> Export
          </button>
          <Popover open={exportOpen} anchorRef={exportBtn} onClose={() => setExportOpen(false)} width={190}>
            {([
              ["Excel (.xlsx)", "download", () => void exportXlsx(exportCtx(), "cash-flow.xlsx")],
              ["CSV (.csv)", "file", () => exportCsv(exportCtx(), "cash-flow.csv")],
              ["PDF / Print", "scroll", () => printReport(exportCtx())],
              ["Email", "mail", () => emailReport(exportCtx())],
              ["Share Link", "link", () => void shareLink().then((ok) => { if (ok) { setShareNote(true); setTimeout(() => setShareNote(false), 2500); } })],
            ] as const).map(([label, icon, fn]) => (
              <button
                key={label}
                onClick={() => {
                  setExportOpen(false);
                  fn();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </Popover>
        </div>
      </div>

      {/* table */}
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[150] bg-slate-50 text-xs shadow-sm dark:bg-slate-800/90">
            <tr>
              {visibleCols.map((col) => {
                const sk = SORTABLE[col.key];
                return (
                  <HeadCell
                    key={col.key}
                    col={col}
                    sortActive={!!sk && sortKey === sk}
                    sortDir={sortDir}
                    onSort={sk ? () => toggleSort(sk) : undefined}
                    facetValues={FILTERABLE.includes(col.key) ? facets[col.key] : undefined}
                    filterSel={colFilters[col.key] ?? null}
                    onFilter={
                      FILTERABLE.includes(col.key)
                        ? (next) => setColFilters((f) => ({ ...f, [col.key]: next }))
                        : undefined
                    }
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length}>
                  <EmptyState
                    icon="receipt"
                    title="No cash movement in this period"
                    message="Posted Customer Payments, Vendor Payments, Journal Entries and bank transactions will appear here automatically."
                  />
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 dark:border-slate-800 ${
                    i % 2 ? "bg-slate-50/40 dark:bg-slate-800/20" : ""
                  } hover:bg-brand/[0.03] dark:hover:bg-brand/10`}
                >
                  {visibleCols.map((col) => (
                    <Cell key={col.key} col={col} row={row} currency={currency} onDrill={onDrill} />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* always-visible summary footer (#15) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Cash In <Money amount={totals.ci} currency={currency} tone="in" className="ml-1 text-sm font-semibold" />
          </span>
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Cash Out <Money amount={totals.co} currency={currency} tone="out" className="ml-1 text-sm font-semibold" />
          </span>
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Net <Money amount={totals.net} currency={currency} tone="auto" className="ml-1 text-sm font-semibold" />
          </span>
        </div>
        {shareNote && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Link copied to clipboard</span>}
      </div>

      {/* pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className={`${inputClass} py-1 text-xs`}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="tabular-nums">
            {total === 0 ? 0 : (current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconAction name="chevronLeft" label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} />
          <span className="px-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            Page {current} / {pages}
          </span>
          <IconAction name="chevronRight" label="Next page" onClick={() => setPage((p) => Math.min(pages, p + 1))} />
        </div>
      </div>
    </div>
  );
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function Cell({
  col,
  row,
  currency,
  onDrill,
}: {
  col: ColumnDef;
  row: CashFlowRow;
  currency: string;
  onDrill: (row: CashFlowRow) => void;
}) {
  const cls = `px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"}`;
  switch (col.key) {
    case "date":
      return <td className={`${cls} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{formatDate(row.date)}</td>;
    case "documentNo":
      return (
        <td className={cls}>
          <button onClick={() => onDrill(row)} className="font-mono text-xs text-brand hover:underline dark:text-brand-light">
            {row.documentNo}
          </button>
        </td>
      );
    case "type":
      return (
        <td className={cls}>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {txnTypeLabel(row.type)}
          </span>
        </td>
      );
    case "description":
      return <td className={`${cls} max-w-[280px] truncate text-slate-700 dark:text-slate-200`} title={row.description}>{row.description}</td>;
    case "glAccount":
      return (
        <td className={`${cls} whitespace-nowrap`}>
          {row.glAccountCode || row.glAccountName ? (
            <span className="text-slate-600 dark:text-slate-300">
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{row.glAccountCode}</span>{" "}
              {row.glAccountName}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
      );
    case "bankAccount":
      return <td className={`${cls} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{row.bankAccountName ?? <span className="text-slate-400">—</span>}</td>;
    case "department":
      return <td className={`${cls} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{row.department ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>;
    case "project":
      return <td className={`${cls} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{row.project ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>;
    case "cashIn":
      return (
        <td className={cls}>
          {row.cashIn ? (
            <button onClick={() => onDrill(row)} className="hover:underline">
              <Money amount={row.cashIn} currency={currency} tone="in" />
            </button>
          ) : (
            <span className="text-slate-300 dark:text-slate-600">—</span>
          )}
        </td>
      );
    case "cashOut":
      return (
        <td className={cls}>
          {row.cashOut ? (
            <button onClick={() => onDrill(row)} className="hover:underline">
              <Money amount={row.cashOut} currency={currency} tone="out" />
            </button>
          ) : (
            <span className="text-slate-300 dark:text-slate-600">—</span>
          )}
        </td>
      );
    case "runningBalance":
      return (
        <td className={cls}>
          <Money amount={row.runningBalance} currency={currency} tone="auto" className="font-medium" />
        </td>
      );
    case "status":
      return (
        <td className={cls}>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TXN_STATUS_TONE[row.status]}`}>
            {TXN_STATUS_LABEL[row.status]}
          </span>
        </td>
      );
    case "reference":
      return <td className={`${cls} text-slate-500 dark:text-slate-400`}>{row.reference ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>;
    case "user":
      return <td className={`${cls} text-slate-500 dark:text-slate-400`}>{row.user ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>;
    default:
      return <td className={cls} />;
  }
}
