"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Icon } from "./icons";
import { Popover } from "@/components/overlay";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
  /** Value used for sorting/filtering; defaults to the row's `key` field. */
  value?: (row: T) => string | number | null | undefined;
  /** Set false to disable sorting/filtering on this column. Empty-header columns (e.g. action buttons) are skipped automatically. */
  sortable?: boolean;
}

function rawValue<T>(col: Column<T>, row: T): string | number {
  const v = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
  if (v === null || v === undefined) return "";
  return typeof v === "number" ? v : String(v);
}

const BLANK_LABEL = "(Blanks)";

/** Imperative handle for parent screens that want an external "clear filters" control. */
export interface DataTableHandle {
  clearFilters: () => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  /** Optional per-row classes (e.g. ageing severity tint). Applied on top of the base row styles. */
  rowClassName?: (row: T) => string;
  /** Optional whole-row click (e.g. open a preview). Interactive cells should stopPropagation. */
  onRowClick?: (row: T) => void;
  /** Show a leading checkbox column for multi-select. */
  selectable?: boolean;
  /** Currently selected row ids (controlled by the parent). */
  selectedIds?: string[];
  /** Called with the new selection whenever a checkbox is toggled. */
  onSelectionChange?: (ids: string[]) => void;
  /** Called whenever any column header filter becomes active/inactive. */
  onActiveFiltersChange?: (active: boolean) => void;
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.
  Excel-style out of the box: click a header to sort (the ⇅ badge is always
  visible), click the funnel for a checkbox list of that column's values — and
  each list only offers values still possible under the other columns' filters.

  Row selection is opt-in: pass `selectable` plus `selectedIds`/`onSelectionChange`
  to get a leading checkbox column (used by Customer Master's multi-delete). Screens
  that don't pass it get no checkbox column, so nothing else changes.

  Pass a ref to imperatively clear header-column filters (e.g. from a page-level
  "Clear filter" button) via `ref.current.clearFilters()`.
*/
function DataTableInner<T extends { id: string }>(
  {
    columns,
    rows,
    empty = "Nothing here yet.",
    rowClassName,
    onRowClick,
    selectable = false,
    selectedIds = [],
    onSelectionChange,
    onActiveFiltersChange,
  }: DataTableProps<T>,
  ref: Ref<DataTableHandle>
) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // key -> set of selected values; a missing key means "no filter" (everything shown)
  const [filters, setFilters] = useState<Record<string, Set<string> | undefined>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [optionSearch, setOptionSearch] = useState("");
  // the header cell whose filter popover is open — used to anchor the portal Popover.
  // (Outside-click / Esc / single-open are handled by the shared overlay Popover.)
  const openThRef = useRef<HTMLTableCellElement | null>(null);

  useImperativeHandle(ref, () => ({
    clearFilters: () => {
      setFilters({});
      setOpenFilter(null);
    },
  }));

  /** Does this row pass every column filter (optionally ignoring one column)? */
  function rowPasses(row: T, exceptKey?: string): boolean {
    return columns.every((c) => {
      if (c.key === exceptKey) return true;
      const sel = filters[c.key];
      if (!sel) return true;
      return sel.has(String(rawValue(c, row)));
    });
  }

  const visible = useMemo(() => {
    let out = rows.filter((row) => rowPasses(row));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = rawValue(col, a);
          const vb = rawValue(col, b);
          const cmp =
            typeof va === "number" && typeof vb === "number"
              ? va - vb
              : String(va).localeCompare(String(vb), undefined, { numeric: true });
          return cmp * sort.dir;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, filters, sort]);

  /** Excel-style: the options offered for a column come from rows that pass all OTHER filters. */
  function optionsFor(col: Column<T>): string[] {
    const set = new Set<string>();
    for (const row of rows) if (rowPasses(row, col.key)) set.add(String(rawValue(col, row)));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function toggleValue(col: Column<T>, value: string, options: string[]) {
    setFilters((f) => {
      const current = f[col.key] ? new Set(f[col.key]) : new Set(options); // no filter = all selected
      if (current.has(value)) current.delete(value);
      else current.add(value);
      // everything ticked again = no filter at all
      const all = options.every((o) => current.has(o));
      return { ...f, [col.key]: all ? undefined : current };
    });
  }

  const anyFilterActive = Object.values(filters).some(Boolean);

  useEffect(() => {
    onActiveFiltersChange?.(anyFilterActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyFilterActive]);

  // Selection works over the currently visible (filtered/sorted) rows.
  const visibleIds = visible.map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const someSelected = visibleIds.some((id) => selectedIds.includes(id));

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(
      allSelected
        ? selectedIds.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...selectedIds, ...visibleIds]))
    );
  }

  const totalCols = columns.length + (selectable ? 1 : 0);

  return (
    <div className="overflow-visible rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
            {selectable && (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-brand"
                />
              </th>
            )}
            {columns.map((c) => {
              const interactive = c.sortable !== false && c.header !== "";
              if (!interactive) {
                return (
                  <th
                    key={c.key}
                    className={`px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 ${c.className ?? ""}`}
                  >
                    {c.header}
                  </th>
                );
              }
              const options = openFilter === c.key ? optionsFor(c) : [];
              const selected = filters[c.key];
              const shownOptions = optionSearch.trim()
                ? options.filter((o) =>
                    (o === "" ? BLANK_LABEL : o).toLowerCase().includes(optionSearch.trim().toLowerCase()),
                  )
                : options;
              return (
                <th
                  key={c.key}
                  ref={openFilter === c.key ? openThRef : undefined}
                  className={`relative px-4 py-3 ${c.className ?? ""}`}
                >
                  <span className="inline-flex items-center gap-1">
                    <button
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 },
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-brand dark:text-slate-300"
                      title="Click to sort"
                    >
                      {c.header}
                      <span className={sort?.key === c.key ? "text-brand" : "text-slate-400"}>
                        {sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setOpenFilter(openFilter === c.key ? null : c.key);
                        setOptionSearch("");
                      }}
                      className={`rounded p-0.5 ${
                        selected ? "text-brand" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      }`}
                      title={`Filter ${c.header}`}
                    >
                      <Icon name="filter" size={13} />
                    </button>
                  </span>

                  <Popover
                    open={openFilter === c.key}
                    anchorRef={openThRef}
                    onClose={() => setOpenFilter(null)}
                    align="left"
                    width={224}
                    padded={false}
                    layer="filterMenu"
                  >
                    <div className="p-2 font-normal">
                      <input
                        autoFocus
                        className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        placeholder="Search values…"
                        value={optionSearch}
                        onChange={(e) => setOptionSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setOpenFilter(null);
                        }}
                      />
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-brand"
                          checked={!selected}
                          onChange={() =>
                            // all selected -> untick everything; anything else -> select all
                            setFilters((f) => ({ ...f, [c.key]: f[c.key] ? undefined : new Set<string>() }))
                          }
                        />
                        Select all
                      </label>
                      <div className="max-h-48 overflow-y-auto">
                        {shownOptions.length === 0 ? (
                          <p className="px-1 py-2 text-xs text-slate-400">No values.</p>
                        ) : (
                          shownOptions.map((o) => (
                            <label
                              key={o}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-brand"
                                checked={!selected || selected.has(o)}
                                onChange={() => toggleValue(c, o, options)}
                              />
                              <span className="truncate">{o === "" ? BLANK_LABEL : o}</span>
                            </label>
                          ))
                        )}
                      </div>
                      <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5 dark:border-slate-700">
                        <button
                          onClick={() => {
                            setFilters((f) => ({ ...f, [c.key]: undefined }));
                            setOpenFilter(null);
                          }}
                          className="text-xs font-medium text-slate-500 hover:text-red-500"
                        >
                          Clear
                        </button>
                        <button onClick={() => setOpenFilter(null)} className="text-xs font-semibold text-brand">
                          Done
                        </button>
                      </div>
                    </div>
                  </Popover>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                {anyFilterActive ? "Nothing matches these filters." : empty}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${
                  onRowClick ? "cursor-pointer" : ""
                } ${selectedIds.includes(row.id) ? "bg-brand/5" : ""} ${rowClassName?.(row) ?? ""}`}
              >
                {selectable && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleRow(row.id)}
                      className="h-4 w-4 accent-brand"
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${c.className ?? ""}`}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export const DataTable = forwardRef(DataTableInner) as <T extends { id: string }>(
  props: DataTableProps<T> & { ref?: Ref<DataTableHandle> }
) => ReturnType<typeof DataTableInner>;
