"use client";

/*
  Cash Flow — filter bar.
  =======================
  Renders every required filter: date range (Today / Week / Month / Quarter /
  Year / Custom), Company, Bank Account, Cash Flow Category, Department, Location,
  Project, plus a global search. All options are data-driven (real company + GL
  data, config-driven categories, and facet values discovered from transactions),
  so nothing is hard-coded and empty dimensions simply show "All".
*/

import { Icon } from "@/components/icons";
import { inputClass } from "@/components/FormField";
import {
  CASH_FLOW_CATEGORIES,
  RANGE_PRESETS,
  rangeLabel,
  type BankAccount,
  type CashFlowCategoryId,
  type CashFlowFilters,
  type RangePresetId,
} from "@/lib/cashflow";
import { Btn } from "./ui";

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} py-1.5 text-xs`}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({
  filters,
  onChange,
  onRangePreset,
  companies,
  bankAccounts,
  departments,
  locations,
  projects,
  onReset,
  activeCount,
}: {
  filters: CashFlowFilters;
  onChange: (patch: Partial<CashFlowFilters>) => void;
  onRangePreset: (preset: RangePresetId) => void;
  companies: { id: string; name: string }[];
  bankAccounts: BankAccount[];
  departments: string[];
  locations: string[];
  projects: string[];
  onReset: () => void;
  activeCount: number;
}) {
  const strOpts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      {/* Row 1 — date presets + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {RANGE_PRESETS.map((p) => {
            const active = filters.rangePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onRangePreset(p.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-brand shadow-sm dark:bg-slate-700 dark:text-brand-light"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {filters.rangePreset === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filters.range.start}
              onChange={(e) => onChange({ range: { ...filters.range, start: e.target.value } })}
              className={`${inputClass} py-1.5 text-xs`}
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={filters.range.end}
              onChange={(e) => onChange({ range: { ...filters.range, end: e.target.value } })}
              className={`${inputClass} py-1.5 text-xs`}
            />
          </div>
        )}

        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search transactions…"
            className={`${inputClass} w-full py-1.5 pl-9 text-xs`}
          />
        </div>

        <Btn icon="close" onClick={onReset} disabled={activeCount === 0} title="Clear all filters">
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Btn>
      </div>

      {/* Row 2 — dimension selects */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <LabeledSelect
          label="Company"
          value={filters.companyId ?? ""}
          onChange={(v) => onChange({ companyId: v || null })}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
        <LabeledSelect
          label="Bank Account"
          value={filters.bankAccountId ?? ""}
          onChange={(v) => onChange({ bankAccountId: v || null })}
          options={bankAccounts.map((b) => ({ value: b.id, label: b.name }))}
        />
        <LabeledSelect
          label="Category"
          value={filters.category ?? ""}
          onChange={(v) => onChange({ category: (v || null) as CashFlowCategoryId | null })}
          options={CASH_FLOW_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
        />
        <LabeledSelect
          label="Department"
          value={filters.department ?? ""}
          onChange={(v) => onChange({ department: v || null })}
          options={strOpts(departments)}
        />
        <LabeledSelect
          label="Location"
          value={filters.location ?? ""}
          onChange={(v) => onChange({ location: v || null })}
          options={strOpts(locations)}
        />
        <LabeledSelect
          label="Project"
          value={filters.project ?? ""}
          onChange={(v) => onChange({ project: v || null })}
          options={strOpts(projects)}
        />
      </div>

      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Showing {rangeLabel(filters.range)}</p>
    </div>
  );
}
