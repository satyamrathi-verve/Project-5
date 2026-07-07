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
    • Floating filter toolbar (type, group, status, normal balance, favourites,
      advanced code-range, density, columns, export, import, reset)
    • Redesigned table: row multi-select + bulk actions, frozen first columns,
      zebra + hover, density, status chips, type badges, clickable names, icon
      actions + a per-row More menu (Duplicate / History / Delete)
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
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";

const PAGE_SIZES = [10, 25, 50, 100];
const FAV_KEY = "gl.favorites";
const RECENT_KEY = "gl.recent";
const STATUS_KEY = "gl.inactive"; // per-browser: ids marked inactive (no DB column)
const NOTES_KEY = "gl.notes"; // per-browser: id -> note text (no DB column)

const TYPE_ICON: Record<AccountType, IconName> = {
  asset: "book",
  liability: "receipt",
  income: "trend",
  expense: "bars",
};

type SortKey = "code" | "name" | "type" | "parent_group";
type ViewMode = "flat" | "grouped";
type DrawerMode = "create" | "edit" | "view";
type Density = "comfortable" | "compact";
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
  variant?: "primary" | "ghost" | "danger";
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

// ===========================================================================
// Main screen
// ===========================================================================

export default function GLMasterPage() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // query state
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<AccountType>>(new Set());
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [favOnly, setFavOnly] = useState(false);
  const [codeMin, setCodeMin] = useState("");
  const [codeMax, setCodeMax] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useState<ViewMode>("flat");
  const [density, setDensity] = useState<Density>("comfortable");
  const [cols, setCols] = useState({ type: true, group: true, balance: true, status: true });
  const [colMenuOpen, setColMenuOpen] = useState(false);

  // per-browser UI state
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [inactive, setInactive] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // overlays
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      const s = JSON.parse(localStorage.getItem(STATUS_KEY) ?? "[]");
      if (Array.isArray(f)) setFavorites(new Set(f));
      if (Array.isArray(r)) setRecent(r);
      if (Array.isArray(s)) setInactive(new Set(s));
    } catch {
      /* ignore malformed storage */
    }
  }, []);

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
  const toggleStatus = useCallback(
    (id: string) => {
      const next = new Set(inactive);
      next.has(id) ? next.delete(id) : next.add(id);
      persistInactive(next);
    },
    [inactive, persistInactive],
  );

  const pushRecent = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ---- derived -------------------------------------------------------------
  const groups = useMemo(() => knownGroups(accounts), [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lo = codeMin ? Number(codeMin) : null;
    const hi = codeMax ? Number(codeMax) : null;
    let rows = accounts.filter((a) => {
      if (typeFilter.size > 0 && !typeFilter.has(a.type)) return false;
      if (groupFilter !== "all" && (a.parent_group ?? "Ungrouped") !== groupFilter) return false;
      if (statusFilter === "active" && inactive.has(a.id)) return false;
      if (statusFilter === "inactive" && !inactive.has(a.id)) return false;
      if (balanceFilter !== "all" && typeMeta(a.type).normalBalance !== balanceFilter) return false;
      if (favOnly && !favorites.has(a.id)) return false;
      const n = Number(a.code);
      if (lo !== null && !Number.isNaN(n) && n < lo) return false;
      if (hi !== null && !Number.isNaN(n) && n > hi) return false;
      if (q) {
        const hay = `${a.code} ${a.name} ${a.parent_group ?? ""} ${typeLabel(a.type)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "code") cmp = a.code.localeCompare(b.code, undefined, { numeric: true });
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else cmp = (a.parent_group ?? "").localeCompare(b.parent_group ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [accounts, search, typeFilter, groupFilter, statusFilter, balanceFilter, favOnly, favorites, inactive, codeMin, codeMax, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => filtered.slice((safePage - 1) * pageSize, safePage * pageSize), [filtered, safePage, pageSize]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const recentAccounts = useMemo(
    () => recent.map((id) => accounts.find((a) => a.id === id)).filter(Boolean) as GLAccount[],
    [recent, accounts],
  );

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, groupFilter, statusFilter, balanceFilter, favOnly, codeMin, codeMax, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const toggleTypeFilter = (t: AccountType) => {
    const next = new Set(typeFilter);
    next.has(t) ? next.delete(t) : next.add(t);
    setTypeFilter(next);
  };
  const resetFilters = () => {
    setSearch("");
    setTypeFilter(new Set());
    setGroupFilter("all");
    setStatusFilter("all");
    setBalanceFilter("all");
    setFavOnly(false);
    setCodeMin("");
    setCodeMax("");
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

  const activeFilters =
    typeFilter.size +
    (groupFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (balanceFilter !== "all" ? 1 : 0) +
    (favOnly ? 1 : 0) +
    (search ? 1 : 0) +
    (codeMin || codeMax ? 1 : 0);

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
          share={1}
          chip="bg-brand/10 text-brand ring-1 ring-brand/20 dark:bg-brand/20 dark:text-brand-light"
          bar="bg-brand"
          icon="grid"
        />
        {ACCOUNT_TYPES.map((t) => {
          const count = accounts.filter((a) => a.type === t.type).length;
          return (
            <SummaryCard
              key={t.type}
              label={t.plural}
              value={count}
              share={accounts.length ? count / accounts.length : 0}
              chip={t.badge}
              bar={t.dot}
              icon={TYPE_ICON[t.type]}
              onClick={() => setTypeFilter(new Set([t.type]))}
            />
          );
        })}
      </div>

      {recentAccounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-500 dark:text-slate-400">Recent:</span>
          {recentAccounts.map((a) => (
            <button
              key={a.id}
              onClick={() => openView(a)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-light"
            >
              {a.code} · {a.name}
            </button>
          ))}
        </div>
      )}

      {/* floating filter toolbar */}
      <div className="sticky top-0 z-20 mb-4 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-soft backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" size={16} />
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, group…   ( / )"
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <div className="flex items-center gap-1">
            {ACCOUNT_TYPES.map((t) => {
              const on = typeFilter.has(t.type);
              return (
                <button
                  key={t.type}
                  onClick={() => toggleTypeFilter(t.type)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
                    on ? t.badge : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700"
                  }`}
                >
                  {t.plural}
                </button>
              );
            })}
          </div>

          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className={`${inputClass} max-w-[11rem]`}>
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={inputClass}>
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as BalanceFilter)} className={inputClass}>
            <option value="all">Any balance</option>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </select>

          <button
            onClick={() => setFavOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              favOnly
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
            title="Show favourites only"
          >
            <Icon name="star" size={15} filled={favOnly} /> Favourites
          </button>

          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              advancedOpen || codeMin || codeMax
                ? "border-brand/40 bg-brand/5 text-brand dark:text-brand-light"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            <Icon name="filter" size={15} /> Advanced
          </button>

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

            <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700" title="Row density">
              {([["comfortable", "Comfortable"], ["compact", "Compact"]] as const).map(([d, lbl]) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    density === d ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="relative">
              <Btn onClick={() => setColMenuOpen((v) => !v)} icon="settings" title="Choose columns">
                <span className="hidden lg:inline">Columns</span>
              </Btn>
              {colMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
                  <div className="absolute right-0 z-40 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-soft dark:border-slate-700 dark:bg-slate-800">
                    {(
                      [
                        ["type", "Type"],
                        ["group", "Group"],
                        ["balance", "Normal balance"],
                        ["status", "Status"],
                      ] as const
                    ).map(([c, label]) => (
                      <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                        <input type="checkbox" checked={cols[c]} onChange={() => setCols((p) => ({ ...p, [c]: !p[c] }))} />
                        {label}
                      </label>
                    ))}
                    <p className="px-2 pt-1 text-[11px] text-slate-400">Code &amp; name are always shown.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {advancedOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Code range</span>
            <input
              value={codeMin}
              onChange={(e) => setCodeMin(e.target.value.replace(/\D/g, ""))}
              placeholder="from"
              className={`${inputClass} w-24`}
            />
            <span className="text-slate-400">–</span>
            <input
              value={codeMax}
              onChange={(e) => setCodeMax(e.target.value.replace(/\D/g, ""))}
              placeholder="to"
              className={`${inputClass} w-24`}
            />
          </div>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {filtered.length} of {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </span>
          {activeFilters > 0 && (
            <button onClick={resetFilters} className="inline-flex items-center gap-1 text-brand hover:underline dark:text-brand-light">
              <Icon name="close" size={12} /> Reset filters ({activeFilters})
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
          density={density}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onToggleStatus={toggleStatus}
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
          density={density}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onToggleStatus={toggleStatus}
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
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          inactive={inactive}
          onToggleStatus={toggleStatus}
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
  share,
  chip,
  bar,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  share: number;
  /** Icon-chip classes (soft coloured bg + coloured icon), light + dark. */
  chip: string;
  /** Solid colour for the share bar (e.g. bg-emerald-500). */
  bar: string;
  icon: IconName;
  onClick?: () => void;
}) {
  const pct = Math.round(share * 100);
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
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${chip}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{pct}% of all accounts</p>
      </div>
    </button>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={`px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 ${className ?? ""}`}>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
        {label}
        <span className={`text-[10px] ${active ? "text-brand dark:text-brand-light" : "text-slate-300 dark:text-slate-600"}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
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
// Flat table
// ===========================================================================

function FlatTable({
  rows,
  cols,
  density,
  sortKey,
  sortDir,
  onSort,
  favorites,
  onToggleFavorite,
  inactive,
  onToggleStatus,
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
  cols: { type: boolean; group: boolean; balance: boolean; status: boolean };
  density: Density;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onToggleStatus: (id: string) => void;
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
  const py = density === "compact" ? "py-1.5" : "py-3";
  const colCount = 4 + (cols.type ? 1 : 0) + (cols.group ? 1 : 0) + (cols.balance ? 1 : 0) + (cols.status ? 1 : 0);
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
              <th className="w-9 bg-inherit px-1 py-3" />
              <SortHeader label="Code" active={sortKey === "code"} dir={sortDir} onClick={() => onSort("code")} className="sticky left-[5rem] z-20 w-24 bg-inherit" />
              <SortHeader label="Account name" active={sortKey === "name"} dir={sortDir} onClick={() => onSort("name")} className="bg-inherit" />
              {cols.type && <SortHeader label="Type" active={sortKey === "type"} dir={sortDir} onClick={() => onSort("type")} className="w-28 bg-inherit" />}
              {cols.group && <SortHeader label="Group" active={sortKey === "parent_group"} dir={sortDir} onClick={() => onSort("parent_group")} className="w-44 bg-inherit" />}
              {cols.balance && <th className="w-28 bg-inherit px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Balance</th>}
              {cols.status && <th className="w-24 bg-inherit px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>}
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
                    {cols.status && (
                      <td className={`bg-inherit px-4 ${py}`} onClick={stop}>
                        <StatusBadge active={!inactive.has(a.id)} onToggle={() => onToggleStatus(a.id)} />
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
  density,
  favorites,
  onToggleFavorite,
  inactive,
  onToggleStatus,
  onView,
  onEdit,
  onQuickAdd,
}: {
  tree: ReturnType<typeof buildTree>;
  density: Density;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onToggleStatus: (id: string) => void;
  onView: (a: GLAccount) => void;
  onEdit: (a: GLAccount) => void;
  onQuickAdd: (type: AccountType, group: string | null) => void;
}) {
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const py = density === "compact" ? "py-1.5" : "py-2.5";

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
                              <td className={`w-28 px-4 ${py}`} onClick={stop}>
                                <StatusBadge active={!inactive.has(a.id)} onToggle={() => onToggleStatus(a.id)} />
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
  favorites,
  onToggleFavorite,
  inactive,
  onToggleStatus,
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
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  inactive: Set<string>;
  onToggleStatus: (id: string) => void;
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
                    <ViewRow label="Status" value={<StatusBadge active={!inactive.has(account.id)} onToggle={() => onToggleStatus(account.id)} />} />
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
              {tab === "attachments" && (
                <GatedTab icon="file" title="No attachments" body="Attachment storage isn't configured for this schema. This tab will list files once a documents/storage bucket is wired up." />
              )}
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
  const sample = "code,name,type,parent_group\n1300,Prepaid Rent,asset,Current Assets\n6400,Rent,expense,Operating Expenses";

  const runParse = (raw: string) => {
    setText(raw);
    setParsed(raw.trim() ? parseImport(raw, accounts) : null);
  };
  const onFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => runParse(String(reader.result ?? ""));
    reader.readAsText(file);
  };
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
            Paste CSV with columns <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">code,name,type,parent_group</code> (header optional),
            or upload a <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.csv</code>. Every row is validated before anything is written.
          </p>
          <div className="mb-3 flex items-center gap-2">
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm text-slate-600 dark:text-slate-400" />
            <button onClick={() => runParse(sample)} className="text-xs text-brand hover:underline dark:text-brand-light">Load a sample</button>
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
