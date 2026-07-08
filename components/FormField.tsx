import type { ReactNode } from "react";

export function FormField({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  /** When set, shown in red under the field so the inputter can fix it. */
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      {children}
      {error && <span className="text-xs font-medium text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

/** Shared input styling so every form looks the same. Use on <input>/<select>. */
export const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500";

/** Same as inputClass but with a red border, for a field that failed validation. */
export const inputErrorClass =
  "rounded-lg border border-red-400 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500 dark:border-red-500 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500";
