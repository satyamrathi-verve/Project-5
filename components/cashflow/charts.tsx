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
import type { BalancePoint, ForecastPoint, PeriodPoint } from "@/lib/cashflow";
import { EmptyState } from "./ui";

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
