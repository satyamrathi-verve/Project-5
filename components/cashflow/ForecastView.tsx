"use client";

/*
  Cash Flow — Forecast view.
  ==========================
  Projects future cash over a 7 / 30 / 90-day horizon from the forecast sources
  (open customer invoices, open vendor bills, recurring expenses, payroll,
  scheduled payments, expected receipts). Shows expected-in / expected-out / net
  KPIs, the projected balance chart and a per-source breakdown. Gated today, so
  every projection reads ₹0.00 until those source modules exist.
*/

import { useMemo } from "react";
import {
  FORECAST_HORIZONS,
  FORECAST_SOURCES,
  forecastSourceLabel,
  type ForecastItem,
  type ForecastPoint,
} from "@/lib/cashflow";
import { KpiCard } from "./KpiCard";
import { ForecastChart } from "./charts";
import { Card, EmptyState, Money, Segmented } from "./ui";

export function ForecastView({
  items,
  points,
  horizonDays,
  onHorizon,
  expectedIn,
  expectedOut,
  openingBalance,
  currency,
}: {
  items: ForecastItem[];
  points: ForecastPoint[];
  horizonDays: number;
  onHorizon: (days: number) => void;
  expectedIn: number;
  expectedOut: number;
  openingBalance: number;
  currency: string;
}) {
  const net = expectedIn - expectedOut;
  const projectedClosing = openingBalance + net;

  const bySource = useMemo(() => {
    const totals = new Map<string, { count: number; amount: number; direction: "in" | "out" }>();
    for (const s of FORECAST_SOURCES) totals.set(s.id, { count: 0, amount: 0, direction: s.direction });
    for (const it of items) {
      const row = totals.get(it.source);
      if (row) {
        row.count += 1;
        row.amount += it.amount;
      }
    }
    return FORECAST_SOURCES.map((s) => ({ source: s.id, ...totals.get(s.id)! }));
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Projected cash position for the selected horizon.</p>
        <Segmented
          value={String(horizonDays)}
          onChange={(v) => onHorizon(Number(v))}
          options={FORECAST_HORIZONS.map((h) => ({ value: String(h.days), label: h.label }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Expected In" amount={expectedIn} currency={currency} icon="download" tone="in" />
        <KpiCard label="Expected Out" amount={expectedOut} currency={currency} icon="upload" tone="out" />
        <KpiCard label="Net Forecast" amount={net} currency={currency} icon="trend" signed />
        <KpiCard label="Projected Closing" amount={projectedClosing} currency={currency} icon="bars" tone="brand" hint="Opening + Net Forecast" />
      </div>

      <Card title="Projected Cash Balance" subtitle={`Next ${horizonDays} days`}>
        <div className="p-4">
          <ForecastChart data={points} currency={currency} />
        </div>
      </Card>

      <Card title="Forecast by Source" subtitle="Where projected cash movements originate">
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Direction</th>
                <th className="px-3 py-2 text-right font-semibold">Items</th>
                <th className="px-3 py-2 text-right font-semibold">Expected Amount</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((r) => (
                <tr key={r.source} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-200">{forecastSourceLabel(r.source)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.direction === "in"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                      }`}
                    >
                      {r.direction === "in" ? "Inflow" : "Outflow"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{r.count}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Money amount={r.amount} currency={currency} tone={r.direction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 && (
          <div className="border-t border-slate-100 dark:border-slate-800">
            <EmptyState
              icon="trend"
              title="No forecast items yet"
              message="Open invoices, vendor bills, recurring expenses, payroll and scheduled payments feed this forecast once those modules post data."
              compact
            />
          </div>
        )}
      </Card>
    </div>
  );
}
