"use client";

/*
  Cash Flow — Dashboard view. Five clickable KPI cards (with period-over-period
  trends) that drill into the matching view, the Smart Insights panel, and six
  charts: Cash In vs Out, Monthly Cash Flow, Running Balance, Cash by Category
  (donut), Cash by Bank (bar) and Future Forecast. Every number is derived.
*/

import { formatMoney } from "@/lib/balances";
import type { BalancePoint, CashFlowKpis, ForecastPoint, Insight, Momentum, PeriodPoint, Slice } from "@/lib/cashflow";
import type { CashFlowView } from "./ViewTabs";
import { KpiCard } from "./KpiCard";
import { InsightsPanel } from "./InsightsPanel";
import { BalanceChart, DonutChart, ForecastChart, HBarChart, InOutChart, MonthlyNetChart } from "./charts";
import { Card } from "./ui";

export function DashboardView({
  kpis,
  momentum,
  inOut,
  monthly,
  balance,
  forecast,
  byCategory,
  byBank,
  insights,
  onNavigate,
}: {
  kpis: CashFlowKpis;
  momentum: Momentum;
  inOut: PeriodPoint[];
  monthly: PeriodPoint[];
  balance: BalancePoint[];
  forecast: ForecastPoint[];
  byCategory: Slice[];
  byBank: { name: string; value: number }[];
  insights: Insight[];
  onNavigate: (view: CashFlowView) => void;
}) {
  const c = kpis.currency;
  return (
    <div className="space-y-4">
      {/* Clickable KPI row with trends */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Opening Cash" amount={kpis.opening} currency={c} icon="book" tone="neutral" hint="Start of period" onClick={() => onNavigate("bank")} />
        <KpiCard label="Cash In" amount={kpis.cashIn} currency={c} icon="download" tone="in" trend={momentum.inPct} trendGood="up" onClick={() => onNavigate("inflows")} />
        <KpiCard label="Cash Out" amount={kpis.cashOut} currency={c} icon="upload" tone="out" trend={momentum.outPct} trendGood="down" onClick={() => onNavigate("outflows")} />
        <KpiCard label="Net Cash Flow" amount={kpis.net} currency={c} icon="trend" signed trend={momentum.netPct} trendGood="up" onClick={() => onNavigate("statement")} />
        <KpiCard label="Closing Cash" amount={kpis.closing} currency={c} icon="bars" tone="brand" hint="Opening + Net" onClick={() => onNavigate("bank")} />
      </div>

      {/* In-vs-Out + Smart Insights */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Cash In vs Cash Out" subtitle="Receipts against payments over the period" className="xl:col-span-2">
          <div className="p-4">
            <InOutChart data={inOut} currency={c} />
          </div>
        </Card>
        <InsightsPanel insights={insights} />
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
      </div>

      {/* Composition charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Cash by Category" subtitle="Where cash is going (by department)">
          <div className="p-5">
            <DonutChart data={byCategory} currency={c} />
          </div>
        </Card>
        <Card title="Cash by Bank" subtitle="Balance across bank & cash accounts">
          <div className="p-5">
            <HBarChart data={byBank} currency={c} />
          </div>
        </Card>
      </div>

      {/* Forecast */}
      <Card title="Future Forecast" subtitle="Projected cash from open items & schedules">
        <div className="p-4">
          <ForecastChart data={forecast} currency={c} />
        </div>
      </Card>

      <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
        Tip: click any KPI card or amount to drill into the details. Totals — In {formatMoney(kpis.cashIn, c)} · Out {formatMoney(kpis.cashOut, c)} · Net {formatMoney(kpis.net, c)}
      </p>
    </div>
  );
}
