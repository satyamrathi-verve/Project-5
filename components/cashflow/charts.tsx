/*
  Cash Flow — charts (dependency-free, responsive SVG).
  =====================================================
  Deliberately no chart library: hand-rolled SVG keeps the bundle small, is
  CSP-safe, theme-aware (Tailwind fill/stroke utilities respond to dark mode) and
  scales via viewBox. Each chart degrades to a friendly empty state when there is
  no data — which, while the transaction engine is gated, is the normal state.

  Charts covered: Cash In vs Cash Out (grouped bars), Monthly Cash Flow (net
  bars, +/-), Running Cash Balance (area line) and Future Forecast (dual line).
*/

import { formatMoney } from "@/lib/balances";
import type { BalancePoint, ForecastPoint, PeriodPoint, Slice } from "@/lib/cashflow";
import { EmptyState } from "./ui";

// Shared categorical palette (hex so it works in SVG fill + legend swatches).
export const PALETTE = ["#4f46e5", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#8b5cf6", "#94a3b8"];

const W = 760;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  );
}

/** Horizontal gridlines + y labels for a [0..max] or [min..max] axis. */
function YAxis({ min, max, currency }: { min: number; max: number; currency: string }) {
  const ticks = 4;
  const rows = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);
  return (
    <g>
      {rows.map((val, i) => {
        const y = PAD.top + PLOT_H - (PLOT_H * (val - min)) / (max - min || 1);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {compact(val)}
            </text>
          </g>
        );
      })}
      <title>{`Axis up to ${formatMoney(max, currency)}`}</title>
    </g>
  );
}

function XLabels({ labels }: { labels: string[] }) {
  const n = labels.length;
  const band = PLOT_W / Math.max(1, n);
  const stride = Math.ceil(n / 12); // avoid label crowding
  return (
    <g>
      {labels.map((l, i) =>
        i % stride === 0 ? (
          <text
            key={i}
            x={PAD.left + band * i + band / 2}
            y={H - 8}
            textAnchor="middle"
            className="fill-slate-400 text-[10px]"
          >
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

// ── Cash In vs Cash Out (grouped bars) ────────────────────────────────────────

export function InOutChart({ data, currency }: { data: PeriodPoint[]; currency: string }) {
  if (data.length === 0)
    return <EmptyState icon="bars" title="No cash movement yet" message="Cash in vs cash out appears here once transactions are posted." compact />;

  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.cashIn, d.cashOut))));
  const band = PLOT_W / data.length;
  const barW = Math.min(18, (band - 6) / 2);

  return (
    <Frame>
      <YAxis min={0} max={max} currency={currency} />
      {data.map((d, i) => {
        const cx = PAD.left + band * i + band / 2;
        const inH = (PLOT_H * d.cashIn) / max;
        const outH = (PLOT_H * d.cashOut) / max;
        const baseY = PAD.top + PLOT_H;
        return (
          <g key={i}>
            <rect x={cx - barW - 1} y={baseY - inH} width={barW} height={inH} rx={2} className="fill-emerald-500/80">
              <title>{`${d.label} · In ${formatMoney(d.cashIn, currency)}`}</title>
            </rect>
            <rect x={cx + 1} y={baseY - outH} width={barW} height={outH} rx={2} className="fill-red-400/80">
              <title>{`${d.label} · Out ${formatMoney(d.cashOut, currency)}`}</title>
            </rect>
          </g>
        );
      })}
      <XLabels labels={data.map((d) => d.label)} />
    </Frame>
  );
}

// ── Monthly net cash flow (+/- bars) ──────────────────────────────────────────

export function MonthlyNetChart({ data, currency }: { data: PeriodPoint[]; currency: string }) {
  if (data.length === 0)
    return <EmptyState icon="trend" title="No monthly data yet" message="Monthly net cash flow builds up as months of activity accumulate." compact />;

  const maxAbs = niceMax(Math.max(1, ...data.map((d) => Math.abs(d.net))));
  const band = PLOT_W / data.length;
  const barW = Math.min(28, band - 10);
  const zeroY = PAD.top + PLOT_H / 2;

  return (
    <Frame>
      <YAxis min={-maxAbs} max={maxAbs} currency={currency} />
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} />
      {data.map((d, i) => {
        const cx = PAD.left + band * i + band / 2;
        const h = (PLOT_H / 2) * (Math.abs(d.net) / maxAbs);
        const positive = d.net >= 0;
        return (
          <rect
            key={i}
            x={cx - barW / 2}
            y={positive ? zeroY - h : zeroY}
            width={barW}
            height={h}
            rx={2}
            className={positive ? "fill-emerald-500/80" : "fill-red-400/80"}
          >
            <title>{`${d.label} · Net ${formatMoney(d.net, currency)}`}</title>
          </rect>
        );
      })}
      <XLabels labels={data.map((d) => d.label)} />
    </Frame>
  );
}

// ── Running balance (area line) ───────────────────────────────────────────────

export function BalanceChart({ data, currency }: { data: BalancePoint[]; currency: string }) {
  if (data.length === 0)
    return <EmptyState icon="trend" title="No balance history yet" message="The running cash balance is plotted here as transactions post." compact />;

  const values = data.map((d) => d.balance);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(1, ...values);
  const min = rawMin;
  const max = niceMax(rawMax);
  const n = data.length;
  const x = (i: number) => PAD.left + (PLOT_W * i) / Math.max(1, n - 1);
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * (v - min)) / (max - min || 1);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} Z`;

  return (
    <Frame>
      <YAxis min={min} max={max} currency={currency} />
      <path d={area} className="fill-brand/10" />
      <path d={line} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.balance)} r={2.5} className="fill-brand">
          <title>{`${d.label} · ${formatMoney(d.balance, currency)}`}</title>
        </circle>
      ))}
      <XLabels labels={data.map((d) => d.label)} />
    </Frame>
  );
}

// ── Forecast (projected cumulative line + in/out) ─────────────────────────────

// ── Donut (Cash by Category) ──────────────────────────────────────────────────

export function DonutChart({ data, currency }: { data: Slice[]; currency: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0)
    return <EmptyState icon="bars" title="No category data yet" message="Spending by category appears here once cash is posted." compact />;

  const cx = 90;
  const cy = 90;
  const r = 68;
  const stroke = 26;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox="0 0 180 180" className="h-44 w-44 flex-none -rotate-90">
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * circ;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
            >
              <title>{`${d.label} · ${formatMoney(d.value, currency)} (${d.pct.toFixed(1)}%)`}</title>
            </circle>
          );
          offset += dash;
          return seg;
        })}
      </svg>
      <ul className="w-full space-y-1.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 flex-none rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
            <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{d.pct.toFixed(0)}%</span>
            <span className="w-24 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatMoney(d.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Horizontal bars (Cash by Bank) ────────────────────────────────────────────

export function HBarChart({ data, currency }: { data: { name: string; value: number }[]; currency: string }) {
  if (data.length === 0) return <EmptyState icon="book" title="No bank data" compact />;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <ul className="space-y-3">
      {data.map((d, i) => {
        const w = (Math.abs(d.value) / max) * 100;
        const neg = d.value < 0;
        return (
          <li key={i}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="truncate text-slate-600 dark:text-slate-300">{d.name}</span>
              <span className={`tabular-nums font-medium ${neg ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-200"}`}>
                {formatMoney(d.value, currency)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${neg ? "bg-red-400" : "bg-brand"}`}
                style={{ width: `${Math.max(2, w)}%`, backgroundColor: neg ? undefined : PALETTE[i % PALETTE.length] }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ForecastChart({ data, currency }: { data: ForecastPoint[]; currency: string }) {
  if (data.length === 0)
    return (
      <EmptyState
        icon="trend"
        title="No forecast data yet"
        message="Projected cash builds from open invoices, bills, payroll and scheduled payments once those modules exist."
        compact
      />
    );

  const values = data.map((d) => d.cumulative);
  const min = Math.min(0, ...values);
  const max = niceMax(Math.max(1, ...values));
  const n = data.length;
  const x = (i: number) => PAD.left + (PLOT_W * i) / Math.max(1, n - 1);
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * (v - min)) / (max - min || 1);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cumulative).toFixed(1)}`).join(" ");

  return (
    <Frame>
      <YAxis min={min} max={max} currency={currency} />
      <path d={line} fill="none" className="stroke-brand" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.cumulative)} r={2.5} className="fill-brand">
          <title>{`${d.label} · projected ${formatMoney(d.cumulative, currency)}`}</title>
        </circle>
      ))}
      <XLabels labels={data.map((d) => d.label)} />
    </Frame>
  );
}
