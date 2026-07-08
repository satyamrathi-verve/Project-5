"use client";

/*
  Cash Flow — KPI card. Renders one headline number (Opening / In / Out / Net /
  Closing). Amount-driven and currency-aware; shows ₹0.00 cleanly while gated.
*/

import { Icon, type IconName } from "@/components/icons";
import { formatMoney } from "@/lib/balances";

const TONE: Record<string, { chip: string; value: string }> = {
  neutral: {
    chip: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    value: "text-slate-900 dark:text-white",
  },
  in: {
    chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  out: {
    chip: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
    value: "text-red-600 dark:text-red-400",
  },
  brand: {
    chip: "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light",
    value: "text-brand dark:text-brand-light",
  },
};

export function KpiCard({
  label,
  amount,
  currency,
  icon,
  tone = "neutral",
  hint,
  signed,
}: {
  label: string;
  amount: number;
  currency: string;
  icon: IconName;
  tone?: "neutral" | "in" | "out" | "brand";
  hint?: string;
  /** For Net/Closing: colour by sign (green ≥0, red <0) overriding `tone`. */
  signed?: boolean;
}) {
  const resolved = signed ? (amount < 0 ? "out" : "in") : tone;
  const t = TONE[resolved];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-2 truncate text-2xl font-bold tabular-nums ${t.value}`} title={formatMoney(amount, currency)}>
            {formatMoney(amount, currency)}
          </p>
          {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
        </div>
        <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${t.chip}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
    </div>
  );
}
