/*
  Cash Flow module — date utilities.
  ===================================
  Pure, timezone-safe (local-date) helpers for resolving the filter's range
  presets (Today / This Week / This Month / Quarter / Year / Custom) into a
  concrete { start, end } and for formatting/bucketing dates on charts.

  All functions take an explicit `today` so they are deterministic and testable;
  the UI passes `new Date()`.
*/

import type { DateRange, RangePresetId } from "./types";

/** Local yyyy-mm-dd (no UTC shift). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Monday-based start of week. */
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  return addDays(d, -diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}

/** Resolve a preset to a concrete inclusive range. `custom` returns `fallback`. */
export function resolveRange(preset: RangePresetId, today: Date, fallback?: DateRange): DateRange {
  switch (preset) {
    case "today":
      return { start: toISODate(today), end: toISODate(today) };
    case "week":
      return { start: toISODate(startOfWeek(today)), end: toISODate(addDays(startOfWeek(today), 6)) };
    case "month":
      return { start: toISODate(startOfMonth(today)), end: toISODate(endOfMonth(today)) };
    case "quarter":
      return { start: toISODate(startOfQuarter(today)), end: toISODate(endOfQuarter(today)) };
    case "year":
      return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` };
    case "custom":
      return fallback ?? { start: toISODate(startOfMonth(today)), end: toISODate(endOfMonth(today)) };
  }
}

/** True when `iso` falls within [range.start, range.end] inclusive. */
export function inRange(iso: string, range: DateRange): boolean {
  return iso >= range.start && iso <= range.end;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 2026" bucket key + label for monthly charts. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7); // yyyy-mm
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`;
}

/** "07 Jul" short label for day-level charts. */
export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

/** Friendly "07 Jul 2026" for tables/tooltips. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function rangeLabel(range: DateRange): string {
  return `${formatDate(range.start)} — ${formatDate(range.end)}`;
}
