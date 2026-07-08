"use client";

/*
  GL Master — Chart of Accounts (premium ERP redesign)
  ====================================================
  Presentation-only redesign. Every piece of behaviour is preserved:
  Supabase read/write through lib/supabase.ts, lib/gl.ts validation + numbering +
  CSV, search/filter/sort/pagination, column chooser, favourites/recent/status,
  keyboard shortcuts, and the create/edit/view/copy/quick-add flows.

  New in this pass (all presentation or per-browser UI state — no schema/API change):
    • Gradient summary cards with %-of-total share bars
    • Floating toolbar (global search, flat/grouped view, columns, export, import, reset)
    • Redesigned table: Excel-style per-column filters, row multi-select + bulk actions,
      frozen first columns, zebra + hover, compact rows, status chips, type badges,
      clickable names, icon actions + a per-row More menu (Duplicate / History / Delete)
    • Right-side drawer with tabs (General, Transactions, History, Attachments,
      Notes, Audit Trail, Relationships). General + Relationships are real; Notes is
      a functional per-browser overlay; the rest are honest gated empty states
      (no backing data in the fixed schema — see prior decisions).
    • Full light/dark theming.

  Honest gaps unchanged: no status/notes/balance/audit columns and no ledger/journal
  tables exist, so status + notes are per-browser (localStorage), and the
  Transactions/History/Attachments/Audit tabs show gated empty states, not fake rows.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, isConfigured } from "@/lib/supabase";
import type { GLAccount } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  type AccountDraft,
  type AccountType,
  buildTree,
  knownGroups,
  parseImport,
  type ParsedImportRow,
  suggestNextCode,
  toCSV,
  typeMeta,
  typeLabel,
  validateAccount,
  type ValidationResult,
} from "@/lib/gl";
import { GL_DESCRIPTIONS } from "@/lib/gl-coa.mjs";
import { BASE_CURRENCY, formatMoney, loadBalances, loadAccountActivity, type AccountActivity } from "@/lib/balances";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { AttachmentManager } from "@/components/AttachmentManager";
import { csvTemplate, sampleCsv, xlsxTemplate, fileToCsvText, downloadBlob } from "@/lib/import-template";

const PAGE_SIZES = [10, 25, 50, 100];
const FAV_KEY = "gl.favorites";
const RECENT_KEY = "gl.recent";
const RECENT_LIMIT = 10; // keep only the latest N recently-viewed accounts
const STATUS_KEY = "gl.inactive"; // per-browser: ids marked inactive (no DB column)
const NOTES_KEY = "gl.notes"; // per-browser: id -> note text (no DB column)

const TYPE_ICON: Record<AccountType, IconName> = {
  asset: "book",
  liability: "receipt",
  income: "trend",
  expense: "bars",
};

type SortKey = "code" | "name" | "type" | "parent_group" | "balance";
type ViewMode = "flat" | "grouped";
type DrawerMode = "create" | "edit" | "view";
type StatusFilter = "all" | "active" | "inactive";
type BalanceFilter = "all" | "debit" | "credit";
type DrawerTab =
  | "general"
  | "transactions"
  | "history"
  | "attachments"
  | "notes"
  | "audit"
  | "relationships";

interface DrawerState {
  mode: DrawerMode;
  account: GLAccount | null;
  preset?: { type: AccountType; group: string | null };
  tab?: DrawerTab;
}

const EMPTY_ERRORS: ValidationResult["errors"] = {
  code: undefined,
  name: undefined,
  type: undefined,
  parent_group: undefined,
  form: undefined,
};

// ===========================================================================
// Presentational helpers
// ===========================================================================

function TypeBadge({ type }: { type: AccountType }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeMeta(type).badge}`}>
      {typeLabel(type)}
    </span>
  );
}

function StatusBadge({ active, onToggle, title }: { active: boolean; onToggle?: () => void; title?: string }) {
  const tone = active
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25"
    : "bg-slate-100 text-slate-500 ring-slate-300 dark:bg-slate-700/50 dark:text-slate-400 dark:ring-slate-600";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      title={title ?? (active ? "Active — click to deactivate" : "Inactive — click to activate")}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone} ${
        onToggle ? "hover:opacity-80" : "cursor-default"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </button>
  );
}

function IconAction({
  name,
  label,
  onClick,
  danger,
}: {
  name: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 transition-colors ${
        danger
          ? "text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          : "text-slate-400 hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"
      }`}
    >
      <Icon name={name} size={17} />
    </button>
  );
}

function Btn({
  children,
  onClick,
  variant = "ghost",
  type = "button",
  disabled,
  title,
  icon,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "warn";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  icon?: IconName;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark shadow-sm"
      : variant === "warn"
        ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
        : variant === "danger"
          ? "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/*
  Portal-based popover. Renders into document.body so it escapes any ancestor
  stacking context (sticky toolbar / backdrop-blur) and overflow clipping — the
  root cause of the Columns menu hiding behind the sticky table header. Position
  is derived from the anchor's bounding rect and kept aligned on scroll/resize.
*/
function Popover({
  open,
  anchorRef,
  onClose,
  align = "right",
  width = 192,
  padded = true,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  width?: number;
  padded?: boolean;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = align === "right" ? r.right - width : r.left;
      setPos({ top: r.bottom + 6, left: Math.min(Math.max(8, left), window.innerWidth - width - 8) });
    };
    update();
    // capture-phase scroll catches scrolling inside the table container too
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, align, width, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[45]" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className={`fixed z-[46] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft animate-scale-in dark:border-slate-700 dark:bg-slate-800 ${padded ? "p-2" : ""}`}
        style={{ top: pos.top, left: pos.left, width }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  return (
    <span className={`inline-block text-slate-400 transition-transform ${small ? "text-[9px]" : "text-[11px]"} ${open ? "rotate-90" : ""}`}>
      ▶
    </span>
  );
}

/** Assets › Current Assets › Cash on Hand — shown on hover over a row. */
function hierarchyPath(a: GLAccount): string {
  return `${typeMeta(a.type).plural} › ${a.parent_group ?? "Ungrouped"} › ${a.name}`;
}

// ---------------------------------------------------------------------------
// Excel-style AutoFilter model — per column, a SET of selected facet values.
// `null` = no filter (all values selected). A row passes when, for every column
// with an active filter, its facet value is in that column's set (AND logic).
// ---------------------------------------------------------------------------
export type FilterKey = "code" | "name" | "type" | "group" | "balance" | "status" | "favourite";
export type ColumnFilters = Record<FilterKey, string[] | null>;

const FILTER_KEYS: FilterKey[] = ["code", "name", "type", "group", "balance", "status", "favourite"];
const FILTER_LABEL: Record<FilterKey, string> = {
  code: "Code",
  name: "Account name",
  type: "Type",
  group: "Group",
  balance: "Debit / Credit",
  status: "Status",
  favourite: "Favourite",
};
const EMPTY_COL_FILTERS: ColumnFilters = {
  code: null,
  name: null,
  type: null,
  group: null,
  balance: null,
  status: null,
  favourite: null,
};
const COLF_KEY = "gl.colFilters";

/** The display value a row contributes to a column's filter facet. */
function facetOf(a: GLAccount, key: FilterKey, inactive: Set<string>, favorites: Set<string>): string {
  switch (key) {
    case "code":
      return a.code;
    case "name":
      return a.name;
    case "type":
      return typeLabel(a.type);
    case "group":
      return a.parent_group ?? "Ungrouped";
    case "balance":
      return typeMeta(a.type).normalBalance === "debit" ? "Debit" : "Credit";
    case "status":
      return inactive.has(a.id) ? "Inactive" : "Active";
    case "favourite":
      return favorites.has(a.id) ? "Yes" : "No";
  }
}

// ===========================================================================
// Main screen
// ===========================================================================

export default function GLMasterPage() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // query state
  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<ColumnFilters>(EMPTY_COL_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useState<ViewMode>("flat");
  const [cols, setCols] = useState({ type: true, group: true, balance: true, amount: true, status: true });
  const [colMenuOpen, setColMenuOpen] = useState(false);

  // per-browser UI state
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [inactive, setInactive] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY);

  // overlays
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [statusChange, setStatusChange] = useState<{ account: GLAccount; toInactive: boolean } | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const colBtnRef = useRef<HTMLDivElement>(null);

  const flash = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // ---- data load -----------------------------------------------------------
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from("gl_accounts").select("*").order("code", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setAccounts([]);
    } else {
      setAccounts((data ?? []) as GLAccount[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Balances are DERIVED from posted transactions (never stored on the account),
  // recomputed whenever accounts change — including after any CRUD reload. No
  // ledger table exists yet, so every account resolves to 0.00. Once transaction
  // modules post ledger lines, this same fetch surfaces real balances with no UI
  // change. (A realtime subscription can later call the identical loader.)
  useEffect(() => {
    if (!supabase || accounts.length === 0) {
      setBalances({});
      return;
    }
    let cancelled = false;
    void loadBalances(supabase, accounts).then((res) => {
      if (cancelled) return;
      setBalances(res.byId);
      setCurrency(res.currency);
    });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      const s = JSON.parse(localStorage.getItem(STATUS_KEY) ?? "[]");
      const cf = JSON.parse(localStorage.getItem(COLF_KEY) ?? "null");
      if (Array.isArray(f)) setFavorites(new Set(f));
      if (Array.isArray(r)) setRecent(r);
      if (Array.isArray(s)) setInactive(new Set(s));
      if (cf && typeof cf === "object") {
        // Accept only the new shape (null | string[]); ignore legacy/malformed data.
        const clean: ColumnFilters = { ...EMPTY_COL_FILTERS };
        for (const key of FILTER_KEYS) {
          const val = (cf as Record<string, unknown>)[key];
          if (Array.isArray(val) && val.every((x) => typeof x === "string")) clean[key] = val as string[];
        }
        setColFilters(clean);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // persist column filters so they survive a page refresh (req 7)
  useEffect(() => {
    try {
      localStorage.setItem(COLF_KEY, JSON.stringify(colFilters));
    } catch {
      /* ignore */
    }
  }, [colFilters]);

  const persistFavorites = useCallback((next: Set<string>) => {
    setFavorites(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);
  const persistInactive = useCallback((next: Set<string>) => {
    setInactive(next);
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = new Set(favorites);
      next.has(id) ? next.delete(id) : next.add(id);
      persistFavorites(next);
    },
    [favorites, persistFavorites],
  );
  // Explicit status set (used after the confirmation dialog is accepted).
  const setStatus = useCallback(
    (id: string, makeInactive: boolean) => {
      const next = new Set(inactive);
      if (makeInactive) next.add(id);
      else next.delete(id);
      persistInactive(next);
    },
    [inactive, persistInactive],
  );
  // Clicking a status badge no longer changes state immediately — it opens the
  // enterprise-style confirmation dialog (deactivate = rich, activate = simple).
  const requestStatusChange = useCallback(
    (a: GLAccount) => setStatusChange({ account: a, toInactive: !inactive.has(a.id) }),
    [inactive],
  );

  const writeRecent = (next: string[]) => {
    try {
      if (next.length) localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      else localStorage.removeItem(RECENT_KEY);
    } catch {
      /* ignore */
    }
  };
  // Move id to the front, de-dupe, and keep only the latest RECENT_LIMIT.
  const pushRecent = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
      writeRecent(next);
      return next;
    });
  }, []);
  // Remove one account from the recent list (does NOT touch the account/data).
  const removeRecent = useCallback((id: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x !== id);
      writeRecent(next);
      return next;
    });
  }, []);
  const clearRecent = useCallback(() => {
    setRecent([]);
    writeRecent([]);
  }, []);

  // ---- derived -------------------------------------------------------------
  const groups = useMemo(() => knownGroups(accounts), [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Build a lookup Set per active column filter (AND across columns).
    const sets: Partial<Record<FilterKey, Set<string>>> = {};
    for (const key of FILTER_KEYS) {
      const sel = colFilters[key];
      if (sel) sets[key] = new Set(sel);
    }
    let rows = accounts.filter((a) => {
      // global search (all fields)
      if (q) {
        const hay = `${a.code} ${a.name} ${a.parent_group ?? ""} ${typeLabel(a.type)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // per-column Excel-style value filters — every active column must match
      for (const key of FILTER_KEYS) {
        const set = sets[key];
        if (set && !set.has(facetOf(a, key, inactive, favorites))) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "code") cmp = a.code.localeCompare(b.code, undefined, { numeric: true });
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else if (sortKey === "balance") cmp = typeMeta(a.type).normalBalance.localeCompare(typeMeta(b.type).normalBalance);
      else cmp = (a.parent_group ?? "").localeCompare(b.parent_group ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [accounts, search, colFilters, favorites, inactive, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => filtered.slice((safePage - 1) * pageSize, safePage * pageSize), [filtered, safePage, pageSize]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const recentAccounts = useMemo(
    () => recent.map((id) => accounts.find((a) => a.id === id)).filter(Boolean) as GLAccount[],
    [recent, accounts],
  );

  // Total balance per category, summed from the (derived) per-account balances.
  // All 0.00 today; updates automatically once transactions post to the ledger.
  const categoryTotals = useMemo(() => {
    const t = { total: 0, asset: 0, liability: 0, income: 0, expense: 0 };
    for (const a of accounts) {
      const b = balances[a.id] ?? 0;
      t.total += b;
      t[a.type] += b;
    }
    return t;
  }, [accounts, balances]);

  useEffect(() => {
    setPage(1);
  }, [search, colFilters, pageSize]);

  // Unique facet values per column (for the Excel filter checkbox lists) —
  // generated dynamically from the data, never hard-coded.
  const facetValues = useMemo(() => {
    const map = {} as Record<FilterKey, string[]>;
    for (const key of FILTER_KEYS) {
      const set = new Set<string>();
      for (const a of accounts) set.add(facetOf(a, key, inactive, favorites));
      map[key] = [...set].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    }
    return map;
  }, [accounts, inactive, favorites]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const setSort = useCallback((key: SortKey, dir: "asc" | "desc") => {
    setSortKey(key);
    setSortDir(dir);
  }, []);
  const applyFilter = useCallback(
    (key: FilterKey, next: string[] | null) => setColFilters((prev) => ({ ...prev, [key]: next })),
    [],
  );
  const clearFilter = useCallback((key: FilterKey) => applyFilter(key, null), [applyFilter]);
  const resetFilters = () => {
    setSearch("");
    setColFilters(EMPTY_COL_FILTERS);
  };

  // ---- selection + bulk ----------------------------------------------------
  const toggleRow = (id: string) =>
    setSelection((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAllOnPage = (ids: string[], allSelected: boolean) =>
    setSelection((prev) => {
      const n = new Set(prev);
      if (allSelected) ids.forEach((i) => n.delete(i));
      else ids.forEach((i) => n.add(i));
      return n;
    });
  const clearSelection = () => setSelection(new Set());

  const bulkFavourite = () => {
    persistFavorites(new Set([...favorites, ...selection]));
    flash(`Favourited ${selection.size} account${selection.size === 1 ? "" : "s"}.`);
  };
  const bulkSetStatus = (makeInactive: boolean) => {
    const next = new Set(inactive);
    selection.forEach((id) => (makeInactive ? next.add(id) : next.delete(id)));
    persistInactive(next);
    flash(`Marked ${selection.size} ${makeInactive ? "inactive" : "active"}.`);
  };
  const exportRows = (rows: GLAccount[], name: string) => {
    const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    exportRows(filtered, "chart-of-accounts.csv");
    flash(`Exported ${filtered.length} account${filtered.length === 1 ? "" : "s"}.`);
  };
  const exportSelected = () => {
    const rows = accounts.filter((a) => selection.has(a.id));
    exportRows(rows, "selected-accounts.csv");
    flash(`Exported ${rows.length} selected.`);
  };

  const deleteMany = useCallback(
    async (ids: string[]) => {
      if (!supabase || ids.length === 0) return;
      const { error } = await supabase.from("gl_accounts").delete().in("id", ids);
      if (error) {
        flash(`Delete failed: ${error.message}`, "err");
        return;
      }
      clearSelection();
      setDrawer(null);
      await load();
      flash(`Deleted ${ids.length} account${ids.length === 1 ? "" : "s"}.`);
    },
    [flash, load],
  );

  const askDelete = (ids: string[], label: string) =>
    setConfirm({
      title: `Delete ${ids.length === 1 ? "account" : `${ids.length} accounts`}?`,
      message: `${label} will be permanently removed from the shared database. This can't be undone.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirm(null);
        void deleteMany(ids);
      },
    });

  // ---- drawer openers ------------------------------------------------------
  const openCreate = useCallback(() => setDrawer({ mode: "create", account: null }), []);
  const openView = useCallback(
    (a: GLAccount, tab: DrawerTab = "general") => {
      pushRecent(a.id);
      setDrawer({ mode: "view", account: a, tab });
    },
    [pushRecent],
  );
  const openEdit = useCallback(
    (a: GLAccount) => {
      pushRecent(a.id);
      setDrawer({ mode: "edit", account: a });
    },
    [pushRecent],
  );
  const openCopy = useCallback((a: GLAccount) => setDrawer({ mode: "create", account: a }), []);
  const openQuickAdd = useCallback(
    (type: AccountType, group: string | null) => setDrawer({ mode: "create", account: null, preset: { type, group } }),
    [],
  );

  // ---- keyboard shortcuts + quick-create deep link -------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName);
      if (e.key === "Escape") {
        setColMenuOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key.toLowerCase() === "n" && !drawer && !importOpen) {
        e.preventDefault();
        openCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, importOpen, openCreate]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "1") {
        openCreate();
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch {
      /* ignore */
    }
  }, [openCreate]);

  // ---- render --------------------------------------------------------------
  if (!isConfigured) {
    return (
      <>
        <PageHeader title="GL Master" subtitle="Chart of Accounts" />
        <NotConfigured />
      </>
    );
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (search) chips.push({ key: "search", label: `Search: “${search}”`, clear: () => setSearch("") });
  for (const key of FILTER_KEYS) {
    const sel = colFilters[key];
    if (sel) {
      const label = sel.length === 1 ? `${FILTER_LABEL[key]}: ${sel[0]}` : `${FILTER_LABEL[key]}: ${sel.length} selected`;
      chips.push({ key, label, clear: () => clearFilter(key) });
    }
  }

  return (
    <>
      <PageHeader
        title="GL Master"
        subtitle="Chart of Accounts — the ledger every module posts to."
        action={
          <div className="flex items-center gap-2">
            <Btn onClick={() => setImportOpen(true)} icon="upload" title="Bulk import from CSV">
              <span className="hidden sm:inline">Import</span>
            </Btn>
            <Btn onClick={exportCsv} icon="download" title="Export current view to CSV">
              <span className="hidden sm:inline">Export</span>
            </Btn>
            <Btn variant="primary" onClick={openCreate} icon="plus" title="New account (n)">
              New account
            </Btn>
          </div>
        }
      />

      {/* summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          label="Total Accounts"
          value={accounts.length}
          balance={categoryTotals.total}
          currency={currency}
          chip="bg-brand/10 text-brand ring-1 ring-brand/20 dark:bg-brand/20 dark:text-brand-light"
          icon="grid"
        />
        {ACCOUNT_TYPES.map((t) => {
          const count = accounts.filter((a) => a.type === t.type).length;
          return (
            <SummaryCard
              key={t.type}
              label={t.plural}
              value={count}
              balance={categoryTotals[t.type]}
              currency={currency}
              chip={t.badge}
              icon={TYPE_ICON[t.type]}
              onClick={() => applyFilter("type", [typeLabel(t.type)])}
            />
          );
        })}
      </div>

      {recentAccounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-500 dark:text-slate-400">Recent:</span>
          {recentAccounts.map((a) => (
            <span
              key={a.id}
              className="group inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-white text-xs text-slate-600 transition hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-light"
            >
              <button
                onClick={() => openView(a)}
                title={`${a.code} · ${a.name}`}
                className="py-1 pl-2.5 pr-1 transition hover:text-brand dark:hover:text-brand-light"
              >
                {a.code} · {a.name}
              </button>
              <button
                onClick={() => removeRecent(a.id)}
                aria-label={`Remove ${a.code} · ${a.name} from recent`}
                title="Remove from recent"
                className="mr-0.5 rounded-full p-0.5 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-slate-700 [@media(hover:none)]:opacity-100"
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          <button
            onClick={() =>
              setConfirm({
                title: "Clear Recent Accounts?",
                message:
                  "This will remove all recently viewed accounts from your personal history. No accounting data will be deleted.",
                confirmLabel: "Clear",
                onConfirm: () => {
                  clearRecent();
                  setConfirm(null);
                },
              })
            }
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-red-600 hover:underline dark:text-slate-400"
          >
            Clear All
          </button>
        </div>
      )}

      {/* floating toolbar — global search + flat/grouped view + columns; per-column filters live in the header */}
      <div className="sticky top-0 z-20 mb-4 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-soft backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" size={16} />
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all columns…   ( / )"
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
              {(["flat", "grouped"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                    view === m ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div ref={colBtnRef} className="relative">
              <Btn onClick={() => setColMenuOpen((v) => !v)} icon="settings" title="Choose columns">
                <span className="hidden lg:inline">Columns</span>
              </Btn>
              <Popover open={colMenuOpen} anchorRef={colBtnRef} onClose={() => setColMenuOpen(false)} align="right">
                {(
                  [
                    ["type", "Type"],
                    ["group", "Group"],
                    ["balance", "Debit / Credit"],
                    ["amount", "Balance"],
                    ["status", "Status"],
                  ] as const
                ).map(([c, label]) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                    <input type="checkbox" checked={cols[c]} onChange={() => setCols((p) => ({ ...p, [c]: !p[c] }))} />
                    {label}
                  </label>
                ))}
                <p className="px-2 pt-1 text-[11px] text-slate-400">Code &amp; name are always shown.</p>
              </Popover>
            </div>
          </div>
        </div>

        {/* active filter chips + count (req 5 & 6) */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{filtered.length}</span> of {accounts.length}{" "}
            account{accounts.length === 1 ? "" : "s"}
          </span>
          {chips.length > 0 && <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />}
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand/5 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand dark:border-brand/30 dark:text-brand-light"
            >
              {c.label}
              <button onClick={c.clear} className="rounded-full p-0.5 transition hover:bg-brand/10" aria-label={`Remove ${c.label}`}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {chips.length > 0 && (
            <button onClick={resetFilters} className="text-xs font-medium text-slate-500 transition hover:text-red-600 hover:underline dark:text-slate-400">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* bulk actions bar */}
      {selection.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-4 py-2.5 text-sm animate-fade-in dark:bg-brand/10">
          <span className="font-semibold text-brand dark:text-brand-light">{selection.size} selected</span>
          <div className="mx-1 h-4 w-px bg-brand/20" />
          <Btn onClick={bulkFavourite} icon="star">Favourite</Btn>
          <Btn onClick={() => bulkSetStatus(false)} icon="check">Activate</Btn>
          <Btn onClick={() => bulkSetStatus(true)}>Deactivate</Btn>
          <Btn onClick={exportSelected} icon="download">Export</Btn>
          <Btn variant="danger" icon="trash" onClick={() => askDelete([...selection], `${selection.size} accounts`)}>
            Delete
          </Btn>
          <button onClick={clearSelection} className="ml-auto text-xs text-slate-500 hover:underline dark:text-slate-400">
            Clear
          </button>
        </div>
      )}

      {/* content */}
      {loading ? (
        <TableSkeleton />
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-semibold">Couldn&apos;t load accounts.</p>
          <p className="mt-1 text-sm">{loadError}</p>
          <div className="mt-3">
            <Btn onClick={() => void load()}>Retry</Btn>
          </div>
        </div>
      ) : view === "flat" ? (
        <FlatTable
          rows={pageRows}
          cols={cols}
          balances={balances}
          currency={currency}
          colFilters={colFilters}
          facetValues={facetValues}
          onApplyFilter={applyFilter}
          onClearFilter={clearFilter}
          onSetSort={setSort}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onRequestStatus={requestStatusChange}
          selection={selection}
          onToggleRow={toggleRow}
          onToggleAll={toggleAllOnPage}
          onView={openView}
          onEdit={openEdit}
          onDuplicate={openCopy}
          onHistory={(a) => openView(a, "history")}
          onDelete={(a) => askDelete([a.id], a.name)}
          empty={accounts.length === 0 ? "No accounts yet — add your first one." : "No accounts match these filters."}
        />
      ) : (
        <GroupedView
          tree={tree}
          balances={balances}
          currency={currency}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onRequestStatus={requestStatusChange}
          onView={openView}
          onEdit={openEdit}
          onQuickAdd={openQuickAdd}
        />
      )}

      {view === "flat" && !loading && !loadError && filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={inputClass}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Btn onClick={() => setPage(1)} disabled={safePage === 1}>«</Btn>
            <Btn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>Prev</Btn>
            <span className="px-2">
              Page <span className="font-semibold text-slate-800 dark:text-slate-200">{safePage}</span> / {totalPages}
            </span>
            <Btn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next</Btn>
            <Btn onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</Btn>
          </div>
        </div>
      )}

      {/* drawer */}
      {drawer && (
        <AccountDrawer
          state={drawer}
          accounts={accounts}
          balance={drawer.account ? balances[drawer.account.id] ?? 0 : 0}
          currency={currency}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onRequestStatus={requestStatusChange}
          onClose={() => setDrawer(null)}
          onSwitchEdit={(a) => setDrawer({ mode: "edit", account: a })}
          onCopy={openCopy}
          onOpenView={openView}
          onDelete={(a) => askDelete([a.id], a.name)}
          onSaved={async (msg) => {
            setDrawer(null);
            await load();
            flash(msg);
          }}
          onError={(msg) => flash(msg, "err")}
        />
      )}

      {/* import modal */}
      {importOpen && (
        <ImportModal
          accounts={accounts}
          onClose={() => setImportOpen(false)}
          onImported={async (n) => {
            setImportOpen(false);
            await load();
            flash(`Imported ${n} account${n === 1 ? "" : "s"}.`);
          }}
          onError={(msg) => flash(msg, "err")}
        />
      )}

      {/* confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.onConfirm}
        />
      )}

      {/* status-change dialog (activate / inactivate) */}
      {statusChange && (
        <StatusDialog
          account={statusChange.account}
          toInactive={statusChange.toInactive}
          balance={balances[statusChange.account.id] ?? 0}
          currency={currency}
          onCancel={() => setStatusChange(null)}
          onConfirm={() => {
            setStatus(statusChange.account.id, statusChange.toInactive);
            flash(
              `${statusChange.account.code} · ${statusChange.account.name} set ${statusChange.toInactive ? "inactive" : "active"}.`,
            );
            setStatusChange(null);
          }}
        />
      )}

      {/* toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-soft animate-fade-in ${
            toast.tone === "ok" ? "bg-slate-900 dark:bg-slate-700" : "bg-red-600"
          }`}
        >
          <Icon name={toast.tone === "ok" ? "check" : "close"} size={16} />
          {toast.msg}
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Summary card
// ===========================================================================

function SummaryCard({
  label,
  value,
  balance,
  currency,
  chip,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  /** Total balance for the category (summed from per-account balances). */
  balance: number;
  currency: string;
  /** Icon-chip classes (soft coloured bg + coloured icon), light + dark. */
  chip: string;
  icon: IconName;
  onClick?: () => void;
}) {
  const negative = balance < 0;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-soft dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
          <p
            className={`mt-1 text-sm font-semibold tabular-nums ${
              negative ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300"
            }`}
          >
            {formatMoney(balance, currency)}
          </p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${chip}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
    </button>
  );
}

function RowMenu({ onDuplicate, onHistory, onDelete }: { onDuplicate: () => void; onHistory: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <IconAction name="dots" label="More actions" onClick={() => setOpen((v) => !v)} />
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="absolute right-0 top-full z-40 mt-1 block w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-soft animate-scale-in dark:border-slate-700 dark:bg-slate-800">
            {[
              { icon: "copy" as IconName, label: "Duplicate", fn: onDuplicate },
              { icon: "clock" as IconName, label: "History", fn: onHistory },
            ].map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  setOpen(false);
                  it.fn();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Icon name={it.icon} size={16} />
                {it.label}
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Icon name="trash" size={16} />
              Delete
            </button>
          </span>
        </>
      )}
    </span>
  );
}

// ===========================================================================
// Column header with integrated sort + filter popover (portal — never clipped)
// ===========================================================================

function FilterHead({
  label,
  className,
  align = "left",
  sort,
  filterActive,
  filterCount,
  filterWidth = 216,
  filterTitle,
  renderFilter,
}: {
  label: string;
  className?: string;
  align?: "left" | "right";
  sort?: { active: boolean; dir: "asc" | "desc"; onClick: () => void };
  filterActive?: boolean;
  filterCount?: number;
  filterWidth?: number;
  filterTitle?: string;
  renderFilter?: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <th className={`py-3 font-semibold text-slate-600 dark:text-slate-300 ${className ?? ""}`}>
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {sort ? (
          <button onClick={sort.onClick} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
            {label}
            <span className={`text-[10px] ${sort.active ? "text-brand dark:text-brand-light" : "text-slate-300 dark:text-slate-600"}`}>
              {sort.active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
            </span>
          </button>
        ) : label ? (
          <span>{label}</span>
        ) : null}
        {renderFilter && (
          <span ref={anchor} className="relative inline-flex">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={filterTitle ?? `Filter ${label}`}
              aria-label={filterTitle ?? `Filter ${label}`}
              className={`rounded p-0.5 transition ${
                filterActive
                  ? "bg-brand/10 text-brand dark:text-brand-light"
                  : "text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-400"
              }`}
            >
              <Icon name="filter" size={12} filled={filterActive} />
            </button>
            {filterActive && filterCount !== undefined && (
              <span className="pointer-events-none absolute -right-1.5 -top-1.5 min-w-[13px] rounded-full bg-brand px-0.5 text-center text-[8px] font-bold leading-[13px] text-white">
                {filterCount}
              </span>
            )}
          </span>
        )}
      </div>
      {renderFilter && (
        <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} align={align} width={filterWidth} padded={false}>
          {renderFilter(() => setOpen(false))}
        </Popover>
      )}
    </th>
  );
}

/*
  Excel-style AutoFilter popover content. Shows every unique value in the column
  as a checkbox (dynamically from the data). Draft state — nothing changes the
  table until Apply. Select All is tri-state and operates on the visible (search-
  filtered) values, exactly like Excel. Reopening restores the applied selection.
*/
function ExcelFilter({
  values,
  selected,
  onApply,
  onClear,
  onClose,
  onSort,
}: {
  values: string[];
  selected: string[] | null; // null = all selected (no filter)
  onApply: (next: string[] | null) => void;
  onClear: () => void;
  onClose: () => void;
  onSort?: (dir: "asc" | "desc") => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => (selected ? new Set(selected) : new Set(values)));
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? values.filter((v) => v.toLowerCase().includes(n)) : values;
  }, [values, q]);
  const shownAll = shown.length > 0 && shown.every((v) => draft.has(v));
  const shownSome = shown.some((v) => draft.has(v));
  useEffect(() => {
    if (selAllRef.current) selAllRef.current.indeterminate = shownSome && !shownAll;
  }, [shownSome, shownAll]);

  const toggle = (v: string) =>
    setDraft((prev) => {
      const n = new Set(prev);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
  const toggleAll = () =>
    setDraft((prev) => {
      const n = new Set(prev);
      if (shownAll) shown.forEach((v) => n.delete(v));
      else shown.forEach((v) => n.add(v));
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
          {(
            [
              ["asc", "Sort A → Z", "↑"],
              ["desc", "Sort Z → A", "↓"],
            ] as const
          ).map(([dir, lbl, glyph]) => (
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
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${inputClass} w-full py-1.5 text-xs`} />
      </div>
      <div className="max-h-56 overflow-y-auto px-1.5">
        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
          <input ref={selAllRef} type="checkbox" checked={shownAll} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" />
          (Select All{q ? " Search Results" : ""})
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
            onClear();
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

// ===========================================================================
// Flat table
// ===========================================================================

function FlatTable({
  rows,
  cols,
  balances,
  currency,
  colFilters,
  facetValues,
  onApplyFilter,
  onClearFilter,
  onSetSort,
  sortKey,
  sortDir,
  onSort,
  favorites,
  onToggleFavorite,
  inactive,
  onRequestStatus,
  selection,
  onToggleRow,
  onToggleAll,
  onView,
  onEdit,
  onDuplicate,
  onHistory,
  onDelete,
  empty,
}: {
  rows: GLAccount[];
  cols: { type: boolean; group: boolean; balance: boolean; amount: boolean; status: boolean };
  balances: Record<string, number>;
  currency: string;
  colFilters: ColumnFilters;
  facetValues: Record<FilterKey, string[]>;
  onApplyFilter: (key: FilterKey, next: string[] | null) => void;
  onClearFilter: (key: FilterKey) => void;
  onSetSort: (key: SortKey, dir: "asc" | "desc") => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onRequestStatus: (a: GLAccount) => void;
  selection: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], allSelected: boolean) => void;
  onView: (a: GLAccount) => void;
  onEdit: (a: GLAccount) => void;
  onDuplicate: (a: GLAccount) => void;
  onHistory: (a: GLAccount) => void;
  onDelete: (a: GLAccount) => void;
  empty: string;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const py = "py-1.5"; // compact density (permanent)
  const colCount =
    4 + (cols.type ? 1 : 0) + (cols.group ? 1 : 0) + (cols.balance ? 1 : 0) + (cols.amount ? 1 : 0) + (cols.status ? 1 : 0);
  const pageIds = rows.map((r) => r.id);
  const allSelected = rows.length > 0 && pageIds.every((id) => selection.has(id));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="max-h-[calc(100vh-380px)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 text-left dark:bg-slate-800/80">
            <tr>
              <th className="sticky left-0 z-20 w-11 bg-inherit px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleAll(pageIds, allSelected)}
                  className="h-4 w-4 rounded border-slate-300"
                  aria-label="Select all on page"
                />
              </th>
              {/* favourite filter lives on the star column header */}
              <FilterHead
                label=""
                className="w-9 bg-inherit px-1"
                filterActive={colFilters.favourite !== null}
                filterCount={colFilters.favourite?.length}
                filterWidth={200}
                filterTitle="Filter favourites"
                renderFilter={(close) => (
                  <ExcelFilter
                    values={facetValues.favourite}
                    selected={colFilters.favourite}
                    onApply={(n) => onApplyFilter("favourite", n)}
                    onClear={() => onClearFilter("favourite")}
                    onClose={close}
                  />
                )}
              />
              <FilterHead
                label="Code"
                className="sticky left-[5rem] z-20 w-28 bg-inherit px-4"
                sort={{ active: sortKey === "code", dir: sortDir, onClick: () => onSort("code") }}
                filterActive={colFilters.code !== null}
                filterCount={colFilters.code?.length}
                filterWidth={260}
                filterTitle="Filter code"
                renderFilter={(close) => (
                  <ExcelFilter values={facetValues.code} selected={colFilters.code} onApply={(n) => onApplyFilter("code", n)} onClear={() => onClearFilter("code")} onClose={close} onSort={(dir) => onSetSort("code", dir)} />
                )}
              />
              <FilterHead
                label="Account name"
                className="bg-inherit px-4"
                sort={{ active: sortKey === "name", dir: sortDir, onClick: () => onSort("name") }}
                filterActive={colFilters.name !== null}
                filterCount={colFilters.name?.length}
                filterWidth={280}
                filterTitle="Filter account name"
                renderFilter={(close) => (
                  <ExcelFilter values={facetValues.name} selected={colFilters.name} onApply={(n) => onApplyFilter("name", n)} onClear={() => onClearFilter("name")} onClose={close} onSort={(dir) => onSetSort("name", dir)} />
                )}
              />
              {cols.type && (
                <FilterHead
                  label="Type"
                  className="w-28 bg-inherit px-4"
                  sort={{ active: sortKey === "type", dir: sortDir, onClick: () => onSort("type") }}
                  filterActive={colFilters.type !== null}
                  filterCount={colFilters.type?.length}
                  filterWidth={200}
                  filterTitle="Filter type"
                  renderFilter={(close) => (
                    <ExcelFilter values={facetValues.type} selected={colFilters.type} onApply={(n) => onApplyFilter("type", n)} onClear={() => onClearFilter("type")} onClose={close} onSort={(dir) => onSetSort("type", dir)} />
                  )}
                />
              )}
              {cols.group && (
                <FilterHead
                  label="Group"
                  className="w-44 bg-inherit px-4"
                  sort={{ active: sortKey === "parent_group", dir: sortDir, onClick: () => onSort("parent_group") }}
                  filterActive={colFilters.group !== null}
                  filterCount={colFilters.group?.length}
                  filterWidth={240}
                  filterTitle="Filter group"
                  renderFilter={(close) => (
                    <ExcelFilter values={facetValues.group} selected={colFilters.group} onApply={(n) => onApplyFilter("group", n)} onClear={() => onClearFilter("group")} onClose={close} onSort={(dir) => onSetSort("parent_group", dir)} />
                  )}
                />
              )}
              {cols.balance && (
                <FilterHead
                  label="Debit / Credit"
                  className="w-32 whitespace-nowrap bg-inherit px-4"
                  sort={{ active: sortKey === "balance", dir: sortDir, onClick: () => onSort("balance") }}
                  filterActive={colFilters.balance !== null}
                  filterCount={colFilters.balance?.length}
                  filterWidth={200}
                  filterTitle="Filter debit / credit"
                  renderFilter={(close) => (
                    <ExcelFilter values={facetValues.balance} selected={colFilters.balance} onApply={(n) => onApplyFilter("balance", n)} onClear={() => onClearFilter("balance")} onClose={close} onSort={(dir) => onSetSort("balance", dir)} />
                  )}
                />
              )}
              {cols.amount && <th className="w-32 bg-inherit px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Balance</th>}
              {cols.status && (
                <FilterHead
                  label="Status"
                  className="w-24 bg-inherit px-4"
                  filterActive={colFilters.status !== null}
                  filterCount={colFilters.status?.length}
                  filterWidth={200}
                  filterTitle="Filter status"
                  renderFilter={(close) => (
                    <ExcelFilter values={facetValues.status} selected={colFilters.status} onApply={(n) => onApplyFilter("status", n)} onClear={() => onClearFilter("status")} onClose={close} />
                  )}
                />
              )}
              <th className="w-24 bg-inherit px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-14 text-center text-slate-400 dark:text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((a, i) => {
                const selected = selection.has(a.id);
                const rowBg = selected
                  ? "bg-brand/5 dark:bg-brand/10"
                  : i % 2
                    ? "bg-slate-50/60 dark:bg-slate-800/20"
                    : "bg-white dark:bg-slate-900";
                return (
                  <tr
                    key={a.id}
                    title={hierarchyPath(a)}
                    onClick={() => onView(a)}
                    className={`${rowBg} cursor-pointer transition-colors hover:bg-brand/5 dark:hover:bg-slate-800/60`}
                  >
                    <td className={`sticky left-0 z-10 bg-inherit px-3 ${py}`} onClick={stop}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleRow(a.id)}
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label={`Select ${a.name}`}
                      />
                    </td>
                    <td className={`bg-inherit px-1 ${py}`} onClick={stop}>
                      <button
                        onClick={() => onToggleFavorite(a.id)}
                        className={favorites.has(a.id) ? "text-amber-400" : "text-slate-300 hover:text-amber-400 dark:text-slate-600"}
                        title={favorites.has(a.id) ? "Unfavourite" : "Favourite"}
                      >
                        <Icon name="star" size={16} filled={favorites.has(a.id)} />
                      </button>
                    </td>
                    <td className={`sticky left-[5rem] z-10 bg-inherit px-4 font-mono text-slate-700 dark:text-slate-300 ${py}`}>{a.code}</td>
                    <td className={`bg-inherit px-4 ${py}`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onView(a);
                        }}
                        className="font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100 dark:hover:text-brand-light"
                      >
                        {a.name}
                      </button>
                    </td>
                    {cols.type && (
                      <td className={`bg-inherit px-4 ${py}`}>
                        <TypeBadge type={a.type} />
                      </td>
                    )}
                    {cols.group && <td className={`bg-inherit px-4 text-slate-600 dark:text-slate-400 ${py}`}>{a.parent_group ?? "—"}</td>}
                    {cols.balance && <td className={`bg-inherit px-4 capitalize text-slate-600 dark:text-slate-400 ${py}`}>{typeMeta(a.type).normalBalance}</td>}
                    {cols.amount && (
                      <td className={`bg-inherit px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 ${py}`}>
                        {formatMoney(balances[a.id] ?? 0, currency)}
                      </td>
                    )}
                    {cols.status && (
                      <td className={`bg-inherit px-4 ${py}`} onClick={stop}>
                        <StatusBadge active={!inactive.has(a.id)} onToggle={() => onRequestStatus(a)} />
                      </td>
                    )}
                    <td className={`bg-inherit px-4 text-right ${py}`} onClick={stop}>
                      <div className="flex items-center justify-end gap-0.5">
                        <IconAction name="eye" label="View" onClick={() => onView(a)} />
                        <IconAction name="pencil" label="Edit" onClick={() => onEdit(a)} />
                        <RowMenu onDuplicate={() => onDuplicate(a)} onHistory={() => onHistory(a)} onDelete={() => onDelete(a)} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===========================================================================
// Grouped (hierarchy) view
// ===========================================================================

function GroupedView({
  tree,
  balances,
  currency,
  favorites,
  onToggleFavorite,
  inactive,
  onRequestStatus,
  onView,
  onEdit,
  onQuickAdd,
}: {
  tree: ReturnType<typeof buildTree>;
  balances: Record<string, number>;
  currency: string;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onRequestStatus: (a: GLAccount) => void;
  onView: (a: GLAccount) => void;
  onEdit: (a: GLAccount) => void;
  onQuickAdd: (type: AccountType, group: string | null) => void;
}) {
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const py = "py-1.5"; // compact density (permanent)

  const toggleType = (t: string) =>
    setCollapsedTypes((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
  const toggleGroup = (k: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const expandAll = () => {
    setCollapsedTypes(new Set());
    setCollapsedGroups(new Set());
  };
  const collapseAll = () => {
    setCollapsedTypes(new Set(tree.map((n) => n.type)));
    setCollapsedGroups(new Set(tree.flatMap((n) => n.groups.map((g) => `${n.type}::${g.group}`))));
  };

  if (tree.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-14 text-center text-slate-400 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
        No accounts match these filters.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <button onClick={expandAll} className="font-medium text-brand hover:underline dark:text-brand-light">Expand all</button>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <button onClick={collapseAll} className="font-medium text-brand hover:underline dark:text-brand-light">Collapse all</button>
      </div>

      {tree.map((node) => {
        const typeOpen = !collapsedTypes.has(node.type);
        return (
          <div key={node.type} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
            <button
              onClick={() => toggleType(node.type)}
              className="flex w-full items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800"
            >
              <span className="flex items-center gap-2">
                <Chevron open={typeOpen} />
                <TypeBadge type={node.type} />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{node.meta.plural}</span>
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{node.count} accounts</span>
            </button>

            {typeOpen &&
              node.groups.map((g) => {
                const key = `${node.type}::${g.group}`;
                const groupOpen = !collapsedGroups.has(key);
                return (
                  <div key={g.group} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <div className="flex items-center justify-between px-4 py-2">
                      <button onClick={() => toggleGroup(key)} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                        <Chevron open={groupOpen} small />
                        {g.group}
                        <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-400 dark:bg-slate-700">{g.accounts.length}</span>
                      </button>
                      <button
                        onClick={() => onQuickAdd(node.type, g.group)}
                        title={`Add a new account under ${g.group}`}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/10 dark:text-brand-light"
                      >
                        <Icon name="plus" size={13} /> Quick add
                      </button>
                    </div>
                    {groupOpen && (
                      <table className="w-full text-sm">
                        <tbody>
                          {g.accounts.map((a) => (
                            <tr
                              key={a.id}
                              title={hierarchyPath(a)}
                              onClick={() => onView(a)}
                              className="cursor-pointer border-t border-slate-50 hover:bg-brand/5 dark:border-slate-800/60 dark:hover:bg-slate-800/50"
                            >
                              <td className={`w-9 px-3 ${py}`} onClick={stop}>
                                <button
                                  onClick={() => onToggleFavorite(a.id)}
                                  className={favorites.has(a.id) ? "text-amber-400" : "text-slate-300 hover:text-amber-400 dark:text-slate-600"}
                                >
                                  <Icon name="star" size={15} filled={favorites.has(a.id)} />
                                </button>
                              </td>
                              <td className={`w-24 px-4 font-mono text-slate-700 dark:text-slate-300 ${py}`}>{a.code}</td>
                              <td className={`px-4 font-medium text-slate-800 dark:text-slate-100 ${py}`}>{a.name}</td>
                              <td className={`w-32 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 ${py}`}>
                                {formatMoney(balances[a.id] ?? 0, currency)}
                              </td>
                              <td className={`w-28 px-4 ${py}`} onClick={stop}>
                                <StatusBadge active={!inactive.has(a.id)} onToggle={() => onRequestStatus(a)} />
                              </td>
                              <td className={`w-20 px-4 text-right ${py}`} onClick={stop}>
                                <div className="flex items-center justify-end gap-0.5">
                                  <IconAction name="eye" label="View" onClick={() => onView(a)} />
                                  <IconAction name="pencil" label="Edit" onClick={() => onEdit(a)} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-800/50" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
          <div className="h-4 w-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-64 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Drawer (tabbed)
// ===========================================================================

const DRAWER_TABS: { id: DrawerTab; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "book" },
  { id: "transactions", label: "Transactions", icon: "receipt" },
  { id: "history", label: "History", icon: "clock" },
  { id: "attachments", label: "Attachments", icon: "file" },
  { id: "notes", label: "Notes", icon: "pencil" },
  { id: "audit", label: "Audit Trail", icon: "scroll" },
  { id: "relationships", label: "Relationships", icon: "grid" },
];

function AccountDrawer({
  state,
  accounts,
  balance,
  currency,
  favorites,
  onToggleFavorite,
  inactive,
  onRequestStatus,
  onClose,
  onSwitchEdit,
  onCopy,
  onOpenView,
  onDelete,
  onSaved,
  onError,
}: {
  state: DrawerState;
  accounts: GLAccount[];
  balance: number;
  currency: string;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onRequestStatus: (a: GLAccount) => void;
  onClose: () => void;
  onSwitchEdit: (a: GLAccount) => void;
  onCopy: (a: GLAccount) => void;
  onOpenView: (a: GLAccount) => void;
  onDelete: (a: GLAccount) => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const { mode, account, preset } = state;
  const readOnly = mode === "view";

  const initial: AccountDraft = useMemo(() => {
    if (mode === "edit" && account) {
      return { code: account.code, name: account.name, type: account.type, parent_group: account.parent_group };
    }
    if (mode === "create" && preset) {
      return { code: suggestNextCode(preset.type, accounts), name: "", type: preset.type, parent_group: preset.group };
    }
    if (mode === "create" && account) {
      return { code: suggestNextCode(account.type, accounts), name: `${account.name} (copy)`, type: account.type, parent_group: account.parent_group };
    }
    return { code: suggestNextCode("asset", accounts), name: "", type: "asset", parent_group: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState<AccountDraft>(initial);
  const [override, setOverride] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [errors, setErrors] = useState<ValidationResult["errors"]>(EMPTY_ERRORS);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<DrawerTab>(state.tab ?? "general");
  const [note, setNote] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!readOnly) nameRef.current?.focus();
  }, [readOnly]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!account) return;
    try {
      const m = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}");
      setNote(m[account.id] ?? "");
    } catch {
      /* ignore */
    }
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNote = (v: string) => {
    setNote(v);
    if (!account) return;
    try {
      const m = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}");
      m[account.id] = v;
      localStorage.setItem(NOTES_KEY, JSON.stringify(m));
    } catch {
      /* ignore */
    }
  };

  const onTypeChange = (type: AccountType) => {
    setForm((f) => {
      const next = { ...f, type };
      if (mode !== "edit" && !codeTouched && !override) next.code = suggestNextCode(type, accounts);
      return next;
    });
  };

  const save = async () => {
    if (!supabase) return;
    const result = validateAccount(form, accounts, { excludeId: mode === "edit" ? account?.id : undefined, allowOverride: override });
    setErrors(result.errors);
    if (!result.ok) return;
    setSaving(true);
    const payload = { code: form.code.trim(), name: form.name.trim(), type: form.type, parent_group: form.parent_group };
    const res =
      mode === "edit" && account
        ? await supabase.from("gl_accounts").update(payload).eq("id", account.id)
        : await supabase.from("gl_accounts").insert(payload);
    setSaving(false);
    if (res.error) {
      onError(
        res.error.code === "23505"
          ? "That code already exists — someone may have just added it. Try another."
          : `Save failed: ${res.error.message}`,
      );
      return;
    }
    await onSaved(mode === "edit" ? `Updated ${payload.code} · ${payload.name}.` : `Created ${payload.code} · ${payload.name}.`);
  };

  const meta = typeMeta(form.type);
  const title =
    mode === "create"
      ? preset
        ? `New account · ${preset.group ?? typeLabel(preset.type)}`
        : "New account"
      : mode === "edit"
        ? "Edit account"
        : account?.name ?? "Account";

  const siblings = account ? accounts.filter((x) => x.parent_group === account.parent_group && x.id !== account.id) : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-drawer animate-slide-in dark:bg-slate-900">
        {/* header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            {mode === "view" && account && <TypeBadge type={account.type} />}
            <h3 className="mt-1 truncate text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
            {mode === "view" && account && <p className="font-mono text-sm text-slate-500 dark:text-slate-400">{account.code}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {/* tabs (view only) */}
        {readOnly && account && (
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 dark:border-slate-800">
            {DRAWER_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  tab === t.id
                    ? "border-brand text-brand dark:text-brand-light"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {readOnly && account ? (
            <>
              {tab === "general" && (
                <div className="space-y-5">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <ViewRow label="Account number" value={<span className="font-mono">{account.code}</span>} />
                    <ViewRow label="Account type" value={typeLabel(account.type)} />
                    <ViewRow label="Account name" value={account.name} className="col-span-2" />
                    <ViewRow label="Parent / group" value={account.parent_group ?? "—"} />
                    <ViewRow label="Normal balance" value={<span className="capitalize">{typeMeta(account.type).normalBalance}</span>} />
                    <ViewRow label="Current balance" value={<span className="font-mono tabular-nums">{formatMoney(balance, currency)}</span>} />
                    <ViewRow label="Status" value={<StatusBadge active={!inactive.has(account.id)} onToggle={() => onRequestStatus(account)} />} />
                    <ViewRow
                      label="Favourite"
                      value={
                        <button
                          onClick={() => onToggleFavorite(account.id)}
                          className={`inline-flex items-center gap-1 text-sm font-medium ${favorites.has(account.id) ? "text-amber-500" : "text-slate-500 hover:text-amber-500"}`}
                        >
                          <Icon name="star" size={15} filled={favorites.has(account.id)} />
                          {favorites.has(account.id) ? "Favourited" : "Add"}
                        </button>
                      }
                    />
                  </dl>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{GL_DESCRIPTIONS[account.code] ?? "—"}</dd>
                  </div>
                </div>
              )}

              {tab === "transactions" && (
                <GatedTab
                  icon="receipt"
                  title="No transactions yet"
                  body="GL accounts aren't linked to any transactions in the current schema. Debits, credits and the running balance will appear here once the Journal Entries module posts to this account."
                />
              )}
              {tab === "history" && (
                <GatedTab icon="clock" title="No change history" body="Field-level change history needs a history/versioning table, which the fixed schema doesn't include yet." />
              )}
              {tab === "attachments" && <AttachmentManager entityType="gl_account" entityId={account.id} />}
              {tab === "audit" && (
                <GatedTab icon="scroll" title="No audit trail" body="Who-changed-what auditing needs an audit_log table and user identities, which aren't part of the current backend." />
              )}
              {tab === "notes" && (
                <div>
                  <p className="mb-2 text-xs text-slate-400">
                    Notes are saved in this browser only — <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">gl_accounts</code> has no notes column.
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => saveNote(e.target.value)}
                    rows={8}
                    placeholder="Add a note about this account…"
                    className={`${inputClass} w-full`}
                  />
                </div>
              )}
              {tab === "relationships" && (
                <div className="space-y-4 text-sm">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <ViewRow label="Type" value={typeLabel(account.type)} />
                    <ViewRow label="Group" value={account.parent_group ?? "—"} />
                  </dl>
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Sibling accounts in {account.parent_group ?? "this group"} ({siblings.length})
                    </p>
                    {siblings.length === 0 ? (
                      <p className="text-slate-400">No other accounts in this group.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        {siblings.map((s) => (
                          <li key={s.id}>
                            <button
                              onClick={() => onOpenView(s)}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <span className="font-mono text-slate-500 dark:text-slate-400">{s.code}</span>
                              <span className="font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                              <Icon name="chevronRight" size={15} className="ml-auto text-slate-300" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <FormField label="Account type">
                <select value={form.type} onChange={(e) => onTypeChange(e.target.value as AccountType)} className={inputClass}>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Account code">
                <input
                  value={form.code}
                  onChange={(e) => {
                    setCodeTouched(true);
                    setForm((f) => ({ ...f, code: e.target.value }));
                  }}
                  className={`${inputClass} font-mono ${errors.code ? "border-red-400" : ""}`}
                  placeholder="e.g. 1100"
                />
                <span className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">
                    {meta.label} band {meta.primaryBand[0]}–{meta.primaryBand[1]}
                  </span>
                  <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    manual override
                  </label>
                </span>
                {errors.code && <span className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.code}</span>}
              </FormField>

              <FormField label="Account name">
                <input
                  ref={nameRef}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={`${inputClass} ${errors.name ? "border-red-400" : ""}`}
                  placeholder="e.g. Petty Cash"
                />
                {errors.name && <span className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.name}</span>}
              </FormField>

              <FormField label="Group (sub-category)">
                <input
                  list="gl-groups"
                  value={form.parent_group ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, parent_group: e.target.value || null }))}
                  className={inputClass}
                  placeholder="e.g. Current Assets"
                />
                <datalist id="gl-groups">
                  {meta.groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </FormField>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          {mode === "view" && account ? (
            <>
              <div className="flex gap-1">
                <Btn onClick={() => onCopy(account)} icon="copy">Duplicate</Btn>
                <Btn variant="danger" icon="trash" onClick={() => onDelete(account)}>Delete</Btn>
              </div>
              <Btn variant="primary" icon="pencil" onClick={() => onSwitchEdit(account)}>Edit</Btn>
            </>
          ) : (
            <>
              <Btn onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={save} disabled={saving} icon={saving ? undefined : "check"}>
                {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create account"}
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GatedTab({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-700">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon name={icon} size={22} />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400 dark:text-slate-500">{body}</p>
    </div>
  );
}

function ViewRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="trash" size={20} />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="danger" icon="trash" onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Status-change dialog (enterprise activate / inactivate confirmation)
// ===========================================================================

function formatActivityDate(iso: string | null): string {
  if (!iso) return "No recent activity";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusDialog({
  account,
  toInactive,
  balance,
  currency,
  onCancel,
  onConfirm,
}: {
  account: GLAccount;
  toInactive: boolean;
  balance: number;
  currency: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [activity, setActivity] = useState<AccountActivity | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) {
      setActivity({ posted: 0, pending: 0, lastActivity: null });
      return;
    }
    void loadAccountActivity(supabase, account.id).then((a) => {
      if (!cancelled) setActivity(a);
    });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const nonZeroBalance = Math.abs(balance) > 0.005;
  const hasPending = (activity?.pending ?? 0) > 0;
  const warnBanner =
    "mt-3 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="flex-1 overflow-y-auto p-6">
          {toInactive ? (
            <>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <span className="text-xl leading-none">⚠</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Set account to inactive?</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                You are about to inactivate the following account:
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <ViewRow label="Account code" value={<span className="font-mono">{account.code}</span>} />
                <ViewRow label="Account name" value={account.name} />
                <ViewRow label="Current balance" value={<span className="font-mono tabular-nums">{formatMoney(balance, currency)}</span>} />
                <ViewRow label="Posted transactions" value={activity ? String(activity.posted) : "…"} />
                <ViewRow label="Recent activity" value={activity ? formatActivityDate(activity.lastActivity) : "…"} className="col-span-2" />
              </dl>

              {nonZeroBalance && (
                <div className={warnBanner}>
                  <span className="leading-none">⚠</span>
                  <p>
                    This account currently has a balance of <b>{formatMoney(balance, currency)}</b>. Inactivating it may prevent
                    future postings while the balance remains. Please verify this is intentional.
                  </p>
                </div>
              )}
              {hasPending && (
                <div className={warnBanner}>
                  <span className="leading-none">⚠</span>
                  <p>
                    There are pending transactions using this account. Consider completing or changing those transactions before
                    inactivating the account.
                  </p>
                </div>
              )}

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                <p className="mb-1.5 font-semibold text-slate-700 dark:text-slate-200">Once inactive</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>This account cannot be selected in new Journal Entries.</li>
                  <li>It cannot be used on Sales Invoices.</li>
                  <li>It cannot be used on Vendor Bills.</li>
                  <li>It cannot be used on Payments.</li>
                  <li>Existing historical transactions will remain unchanged.</li>
                  <li>Reports will continue to include historical activity.</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                <Icon name="check" size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Activate account?</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This account will again be available for new accounting transactions.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <ViewRow label="Account code" value={<span className="font-mono">{account.code}</span>} />
                <ViewRow label="Account name" value={account.name} />
              </dl>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Btn onClick={onCancel}>Cancel</Btn>
          {toInactive ? (
            <Btn variant="warn" onClick={onConfirm}>
              Set Inactive
            </Btn>
          ) : (
            <Btn variant="primary" icon="check" onClick={onConfirm}>
              Activate
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Import modal
// ===========================================================================

function ImportModal({
  accounts,
  onClose,
  onImported,
  onError,
}: {
  accounts: GLAccount[];
  onClose: () => void;
  onImported: (n: number) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const sample = sampleCsv(); // "Load Sample" demo rows (the downloadable template is headers-only)

  const runParse = (raw: string) => {
    setText(raw);
    setParsed(raw.trim() ? parseImport(raw, accounts) : null);
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      runParse(await fileToCsvText(file));
    } catch {
      onError("Couldn't read that file. Use the template's .xlsx or .csv.");
    }
  };
  const downloadExcel = async () => {
    setDownloading(true);
    try {
      downloadBlob(await xlsxTemplate(), "verve-erp-gl-import-template.xlsx");
    } catch {
      onError("Couldn't generate the Excel template.");
    } finally {
      setDownloading(false);
    }
  };
  const downloadCsv = () => downloadBlob(new Blob([csvTemplate()], { type: "text/csv;charset=utf-8;" }), "verve-erp-gl-import-template.csv");
  const valid = parsed?.filter((r) => r.errors.length === 0) ?? [];

  const doImport = async () => {
    if (!supabase || valid.length === 0) return;
    setBusy(true);
    const payload = valid.map((r) => ({ code: r.draft.code, name: r.draft.name, type: r.draft.type, parent_group: r.draft.parent_group }));
    const { error } = await supabase.from("gl_accounts").insert(payload);
    setBusy(false);
    if (error) {
      onError(`Import failed: ${error.message}`);
      return;
    }
    await onImported(payload.length);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Bulk import accounts</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
            Download the template, fill it in, then upload the <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.xlsx</code> or{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.csv</code> (or paste rows below). Only{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Account Code, Name, Type, Parent Group</code> are imported — Normal Balance,
            Status &amp; Description are reference-only. Every row is validated before anything is written.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,.xlsx,text/csv"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
              className="text-sm text-slate-600 dark:text-slate-400"
            />
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                onClick={downloadExcel}
                disabled={downloading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Icon name="download" size={13} /> {downloading ? "Preparing…" : "Download Excel Template"}
              </button>
              <button
                onClick={downloadCsv}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Icon name="download" size={13} /> Download CSV Template
              </button>
              <button onClick={() => runParse(sample)} className="px-1 text-xs font-medium text-brand hover:underline dark:text-brand-light">
                Load Sample
              </button>
            </div>
          </div>
          <textarea value={text} onChange={(e) => runParse(e.target.value)} rows={5} placeholder={sample} className={`${inputClass} w-full font-mono text-xs`} />
          {parsed && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-3 text-sm">
                <span className="font-medium text-emerald-700 dark:text-emerald-400">{valid.length} valid</span>
                <span className="font-medium text-red-600 dark:text-red-400">{parsed.length - valid.length} with errors</span>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left dark:bg-slate-800">
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      {["Code", "Name", "Type", "Group", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r, i) => (
                      <tr key={i} className={`border-b border-slate-100 dark:border-slate-800 ${r.errors.length ? "bg-red-50/50 dark:bg-red-500/10" : ""}`}>
                        <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-300">{r.draft.code}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{r.draft.name}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{r.draft.type}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{r.draft.parent_group ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {r.errors.length === 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400">✓ ready</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400" title={r.errors.join(" ")}>✕ {r.errors[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={doImport} disabled={busy || valid.length === 0} icon="upload">
            {busy ? "Importing…" : `Import ${valid.length} valid row${valid.length === 1 ? "" : "s"}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
