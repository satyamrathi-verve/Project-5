"use client";

/*
  Cash Flow — shared UI primitives.
  =================================
  Small, reusable building blocks used across every Cash Flow view, styled to
  match the GL Master house style (brand colour, shadow-card/soft, animate-*,
  dark mode). Kept in one file so the views stay declarative.
*/

import { Icon, type IconName } from "@/components/icons";
import { formatMoney } from "@/lib/balances";

// ── Button ───────────────────────────────────────────────────────────────────

export function Btn({
  children,
  onClick,
  variant = "ghost",
  type = "button",
  disabled,
  title,
  icon,
  active,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  icon?: IconName;
  active?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark shadow-sm"
      : variant === "danger"
        ? "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
        : active
          ? "border border-brand/30 bg-brand/10 text-brand dark:border-brand/40 dark:bg-brand/15 dark:text-brand-light"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

// ── Icon action ───────────────────────────────────────────────────────────────

export function IconAction({
  name,
  label,
  onClick,
  danger,
}: {
  name: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 transition-colors ${
        danger
          ? "text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          : "text-slate-400 hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"
      }`}
    >
      <Icon name={name} size={17} />
    </button>
  );
}

// Popover now comes from the global overlay system (portal + z-hierarchy +
// collision + single-open + viewport flip/shift). Re-exported so existing Cash
// Flow call sites are unchanged (shared default align="right" matches the old one).
export { Popover } from "@/components/overlay";

// ── Surface card ─────────────────────────────────────────────────────────────

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// ── Segmented control ────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${pad} ${
              active
                ? "bg-white text-brand shadow-sm dark:bg-slate-700 dark:text-brand-light"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon = "bars",
  title,
  message,
  compact,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-10" : "py-16"}`}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon name={icon} size={22} />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

export function Money({
  amount,
  currency,
  tone,
  className = "",
}: {
  amount: number;
  currency: string;
  /** "in" green, "out" red, "auto" by sign, undefined = neutral. */
  tone?: "in" | "out" | "auto" | "muted";
  className?: string;
}) {
  const zero = !amount;
  let color = "text-slate-800 dark:text-slate-100";
  if (tone === "muted" || zero) color = "text-slate-400 dark:text-slate-500";
  else if (tone === "in") color = "text-emerald-600 dark:text-emerald-400";
  else if (tone === "out") color = "text-red-600 dark:text-red-400";
  else if (tone === "auto") color = amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
  return <span className={`tabular-nums ${color} ${className}`}>{formatMoney(amount, currency)}</span>;
}
