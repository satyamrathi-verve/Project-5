"use client";

/*
  Cash Flow — KPI card. One headline number (Opening / In / Out / Net / Closing),
  currency-aware. Optionally clickable (drills into the matching view, with a
  "Click to view details" hover hint) and shows a period-over-period trend chip.
*/

import { Icon, type IconName } from "@/components/icons";
import { formatMoney } from "@/lib/balances";

const TONE: Record<string, { chip: string; value: string }> = {
  neutral: { chip: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", value: "text-slate-900 dark:text-white" },
  in: { chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400", value: "text-emerald-600 dark:text-emerald-400" },
  out: { chip: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400", value: "text-red-600 dark:text-red-400" },
  brand: { chip: "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light", value: "text-brand dark:text-brand-light" },
};

export function KpiCard({
  label,
  amount,
  currency,
  icon,
  tone = "neutral",
  hint,
  signed,
  trend,
  trendGood = "up",
  onClick,
}: {
  label: string;
  amount: number;
  currency: string;
  icon: IconName;
  tone?: "neutral" | "in" | "out" | "brand";
  hint?: string;
  signed?: boolean;
  /** Percent change vs previous period; null hides the chip. */
  trend?: number | null;
  /** Whether an increase is "good" (green) or "bad" (red) — e.g. Cash Out up is bad. */
  trendGood?: "up" | "down";
  /** When provided, the whole card is a button that drills into a view. */
  onClick?: () => void;
}) {
  const resolved = signed ? (amount < 0 ? "out" : "in") : tone;
  const t = TONE[resolved];

  const trendChip =
    trend != null && Number.isFinite(trend) ? (
      (() => {
        const up = trend >= 0;
        const good = trendGood === "up" ? up : !up;
        return (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              good ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
            }`}
          >
            {up ? "↑" : "↓"} {Math.abs(trend).toFixed(1)}%
          </span>
        );
      })()
    ) : null;

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-2 truncate text-2xl font-bold tabular-nums ${t.value}`} title={formatMoney(amount, currency)}>
            {formatMoney(amount, currency)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {trendChip}
            {(trendChip || hint) && <span className="text-[11px] text-slate-400 dark:text-slate-500">{trendChip ? "vs prev. 30 days" : hint}</span>}
          </div>
        </div>
        <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${t.chip}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
      {onClick && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-white via-white/90 to-transparent px-4 pb-2 pt-4 text-[11px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100 dark:from-slate-900 dark:via-slate-900/90 dark:text-brand-light">
          Click to view details <Icon name="chevronRight" size={13} />
        </span>
      )}
    </>
  );

  const base =
    "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900";
  if (onClick)
    return (
      <button onClick={onClick} className={`${base} cursor-pointer text-left transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-soft`}>
        {inner}
      </button>
    );
  return <div className={base}>{inner}</div>;
}
