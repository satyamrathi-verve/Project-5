"use client";

/*
  Cash Flow — module orchestrator (roadmap slot "Cashflow Projection", /cashflow).
  ================================================================================
  This route is thin on purpose: it loads data through the service layer, owns
  the shared filter state, derives every number via the pure logic layer, and
  hands typed props to the presentational views. All accounting knowledge lives
  in lib/cashflow; all rendering lives in components/cashflow. Swap the engine
  seams on (lib/cashflow/engine.ts) and this same screen shows real cash flow —
  no change here.

  Until then the future transaction engine is gated, so every figure honestly
  reads ₹0.00 while the full architecture (filters, charts, statement, forecast,
  drill-down, export) is live.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { Icon } from "@/components/icons";
import {
  applyFilters,
  categoryTotals,
  computeKpis,
  dailySeries,
  facetValues,
  forecastPoints,
  forecastTotals,
  loadCashFlowData,
  monthlySeries,
  openingCash,
  parseISO,
  resolveRange,
  runningBalanceSeries,
  withRunningBalance,
  CASHFLOW_DEMO,
  demoDefaultRange,
  type CashFlowData,
  type CashFlowFilters,
  type CashFlowRow,
  type RangePresetId,
} from "@/lib/cashflow";
import { FilterBar } from "@/components/cashflow/FilterBar";
import { ViewTabs, type CashFlowView } from "@/components/cashflow/ViewTabs";
import { DashboardView } from "@/components/cashflow/DashboardView";
import { StatementView } from "@/components/cashflow/StatementView";
import { ForecastView } from "@/components/cashflow/ForecastView";
import { BankAccountsView } from "@/components/cashflow/BankAccountsView";
import { CashFlowTable } from "@/components/cashflow/CashFlowTable";
import { DrillDownDrawer } from "@/components/cashflow/DrillDownDrawer";
import { KpiCard } from "@/components/cashflow/KpiCard";

export default function CashFlowPage() {
  const [today] = useState(() => new Date());
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [view, setView] = useState<CashFlowView>("dashboard");
  const [horizonDays, setHorizonDays] = useState(90);
  const [drill, setDrill] = useState<CashFlowRow | null>(null);

  const [filters, setFilters] = useState<CashFlowFilters>(() => {
    const start = new Date();
    // In demo mode open on a trailing-12-month range so the dashboard is fully
    // populated (headline KPIs land exactly); otherwise default to this month.
    return {
      rangePreset: CASHFLOW_DEMO ? "custom" : "month",
      range: CASHFLOW_DEMO ? demoDefaultRange(start) : resolveRange("month", start),
      companyId: null,
      bankAccountId: null,
      category: null,
      type: null,
      department: null,
      location: null,
      project: null,
      direction: null,
      search: "",
    };
  });

  // ── load (dimensions are real; transactions come from the gated engine) ────
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCashFlowData(supabase, { range: filters.range, forecastDays: horizonDays })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoadError(null);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Failed to load cash flow data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // Load once on mount — transactions are gated ([]); when wired, add
    // filters.range / horizonDays here to refetch server-side per range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── derive everything (pure) ───────────────────────────────────────────────
  const allTxns = data?.transactions ?? [];
  const currency = data?.currency ?? "INR";
  const opening = useMemo(() => openingCash((data?.bankAccounts ?? []).map((b) => b.openingBalance)), [data]);

  const filteredTxns = useMemo(() => applyFilters(allTxns, filters), [allTxns, filters]);
  const kpis = useMemo(() => computeKpis(filteredTxns, opening, currency), [filteredTxns, opening, currency]);
  const rows = useMemo<CashFlowRow[]>(() => withRunningBalance(filteredTxns, opening), [filteredTxns, opening]);

  const rangeDays = useMemo(
    () => Math.round((parseISO(filters.range.end).getTime() - parseISO(filters.range.start).getTime()) / 86_400_000),
    [filters.range],
  );
  const inOut = useMemo(
    () => (rangeDays <= 62 ? dailySeries(filteredTxns) : monthlySeries(filteredTxns)),
    [filteredTxns, rangeDays],
  );
  const monthly = useMemo(() => monthlySeries(filteredTxns), [filteredTxns]);
  const balance = useMemo(() => runningBalanceSeries(filteredTxns, opening), [filteredTxns, opening]);

  const fPoints = useMemo(
    () => forecastPoints(data?.forecast ?? [], horizonDays, today, kpis.closing),
    [data, horizonDays, today, kpis.closing],
  );
  const fTotals = useMemo(() => forecastTotals(data?.forecast ?? [], horizonDays, today), [data, horizonDays, today]);
  const categories = useMemo(() => categoryTotals(filteredTxns), [filteredTxns]);

  const departments = useMemo(() => facetValues(allTxns, (t) => t.department), [allTxns]);
  const locations = useMemo(() => facetValues(allTxns, (t) => t.location), [allTxns]);
  const projects = useMemo(() => facetValues(allTxns, (t) => t.project), [allTxns]);

  const companyName =
    data?.companies.find((c) => c.id === (filters.companyId ?? data?.companyId))?.name ??
    data?.companies[0]?.name ??
    "All Companies";

  const activeCount =
    (filters.companyId ? 1 : 0) +
    (filters.bankAccountId ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.department ? 1 : 0) +
    (filters.location ? 1 : 0) +
    (filters.project ? 1 : 0) +
    (filters.search.trim() ? 1 : 0);

  // ── handlers ───────────────────────────────────────────────────────────────
  const patch = useCallback((p: Partial<CashFlowFilters>) => setFilters((f) => ({ ...f, ...p })), []);
  const onRangePreset = useCallback(
    (preset: RangePresetId) =>
      setFilters((f) => ({ ...f, rangePreset: preset, range: preset === "custom" ? f.range : resolveRange(preset, today, f.range) })),
    [today],
  );
  const onReset = useCallback(
    () =>
      setFilters((f) => ({
        ...f,
        companyId: null,
        bankAccountId: null,
        category: null,
        type: null,
        department: null,
        location: null,
        project: null,
        search: "",
      })),
    [],
  );

  // rows shown by the table for the active view (inflows / outflows restrict)
  const tableRows = useMemo(() => {
    if (view === "inflows") return rows.filter((r) => r.cashIn > 0);
    if (view === "outflows") return rows.filter((r) => r.cashOut > 0);
    return rows;
  }, [rows, view]);

  if (!isConfigured) {
    return (
      <div>
        <PageHeader title="Cash Flow" subtitle="Cash movement, forecast and position" />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash Flow"
        subtitle="Real-time cash movement, forecast and position across the business"
        action={
          CASHFLOW_DEMO ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Demo data
            </span>
          ) : undefined
        }
      />

      {data?.gated && (
        <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm dark:border-brand/30 dark:bg-brand/10">
          <Icon name="trend" size={18} className="mt-0.5 flex-none text-brand dark:text-brand-light" />
          <p className="text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">No transactions posted yet.</span> Every
            figure reads ₹0.00 by design. The module is fully wired — the moment Customer Payments, Vendor Payments,
            Journal Entries, Bank or Payroll modules post cash, these KPIs, charts, statement and forecast update
            automatically.
          </p>
        </div>
      )}

      <ViewTabs value={view} onChange={setView} />

      <FilterBar
        filters={filters}
        onChange={patch}
        onRangePreset={onRangePreset}
        companies={data?.companies ?? []}
        bankAccounts={data?.bankAccounts ?? []}
        departments={departments}
        locations={locations}
        projects={projects}
        onReset={onReset}
        activeCount={activeCount}
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-20 text-sm text-slate-400 shadow-card dark:border-slate-800 dark:bg-slate-900">
          Loading cash flow…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {loadError}
        </div>
      ) : (
        <>
          {view === "dashboard" && (
            <>
              <DashboardView kpis={kpis} inOut={inOut} monthly={monthly} balance={balance} forecast={fPoints} />
              <CashFlowTable rows={tableRows} currency={currency} onDrill={setDrill} />
            </>
          )}

          {(view === "inflows" || view === "outflows") && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <KpiCard
                  label={view === "inflows" ? "Total Cash In" : "Total Cash Out"}
                  amount={view === "inflows" ? kpis.cashIn : kpis.cashOut}
                  currency={currency}
                  icon={view === "inflows" ? "download" : "upload"}
                  tone={view === "inflows" ? "in" : "out"}
                />
                <KpiCard label="Transactions" amount={tableRows.length} currency={currency} icon="receipt" tone="neutral" hint="In this period" />
                <KpiCard label="Net Cash Flow" amount={kpis.net} currency={currency} icon="trend" signed />
              </div>
              <CashFlowTable
                rows={tableRows}
                currency={currency}
                onDrill={setDrill}
                title={view === "inflows" ? "Cash Inflows" : "Cash Outflows"}
              />
            </>
          )}

          {view === "statement" && (
            <StatementView
              kpis={kpis}
              categories={categories}
              bankAccounts={data?.bankAccounts ?? []}
              transactions={filteredTxns}
              range={filters.range}
              companyName={companyName}
            />
          )}

          {view === "forecast" && (
            <ForecastView
              items={data?.forecast ?? []}
              points={fPoints}
              horizonDays={horizonDays}
              onHorizon={setHorizonDays}
              expectedIn={fTotals.expectedIn}
              expectedOut={fTotals.expectedOut}
              openingBalance={kpis.closing}
              currency={currency}
            />
          )}

          {view === "bank" && (
            <BankAccountsView bankAccounts={data?.bankAccounts ?? []} transactions={filteredTxns} currency={currency} />
          )}
        </>
      )}

      {drill && <DrillDownDrawer row={drill} currency={currency} onClose={() => setDrill(null)} />}
    </div>
  );
}
