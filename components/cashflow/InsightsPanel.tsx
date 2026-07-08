"use client";

/*
  Cash Flow — Smart Insights panel. Renders the heuristic insights from
  logic.buildInsights (momentum, payroll due, largest payment, next receipt,
  low-cash alert) as a compact, colour-coded list — the "intelligent" feel.
*/

import { Icon } from "@/components/icons";
import type { Insight } from "@/lib/cashflow";
import { Card, EmptyState } from "./ui";

const TONE: Record<Insight["tone"], string> = {
  up: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  down: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  warn: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  info: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
};

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <Card title="Smart Insights" subtitle="Auto-generated from your cash activity" className="h-full">
      {insights.length === 0 ? (
        <EmptyState icon="bell" title="No insights yet" message="Insights surface as cash activity builds up." compact />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {insights.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-5 py-3">
              <span className={`mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg ${TONE[i.tone]}`}>
                <Icon name={i.icon} size={15} />
              </span>
              <p className="text-sm text-slate-600 dark:text-slate-300">{i.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
