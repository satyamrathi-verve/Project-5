"use client";

/*
  Cash Flow — Dashboard view. Five KPI cards + the four required charts (Cash In
  vs Cash Out, Monthly Cash Flow, Running Cash Balance, Future Forecast). Every
  number is derived; while the transaction engine is gated it all reads ₹0.00.
*/

import type { BalancePoint, CashFlowKpis, ForecastPoint, PeriodPoint } from "@/lib/cashflow";
import { KpiCard } from "./KpiCard";
import { BalanceChart, ForecastChart, InOutChart, MonthlyNetChart } from "./charts";
import { Card } from "./ui";

export function DashboardView({
  kpis,
  inOut,
  monthly,
  balance,
  forecast,
}: {
  kpis: CashFlowKpis;
  inOut: PeriodPoint[];
  monthly: PeriodPoint[];
  balance: BalancePoint[];
  forecast: ForecastPoint[];
}) {
  const c = kpis.currency;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Opening Cash" amount={kpis.opening} currency={c} icon="book" tone="neutral" hint="Start of period" />
        <KpiCard label="Cash In" amount={kpis.cashIn} currency={c} icon="download" tone="in" hint="Total receipts" />
        <KpiCard label="Cash Out" amount={kpis.cashOut} currency={c} icon="upload" tone="out" hint="Total payments" />
        <KpiCard label="Net Cash Flow" amount={kpis.net} currency={c} icon="trend" signed hint="In − Out" />
        <KpiCard label="Closing Cash" amount={kpis.closing} currency={c} icon="bars" tone="brand" hint="Opening + Net" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Cash In vs Cash Out" subtitle="Receipts against payments over the period">
          <div className="p-4">
            <InOutChart data={inOut} currency={c} />
          </div>
        </Card>
        <Card title="Monthly Cash Flow" subtitle="Net cash movement by month">
          <div className="p-4">
            <MonthlyNetChart data={monthly} currency={c} />
          </div>
        </Card>
        <Card title="Running Cash Balance" subtitle="Cash position over time">
          <div className="p-4">
            <BalanceChart data={balance} currency={c} />
          </div>
        </Card>
        <Card title="Future Forecast" subtitle="Projected cash from open items & schedules">
          <div className="p-4">
            <ForecastChart data={forecast} currency={c} />
          </div>
        </Card>
      </div>
    </div>
  );
}
