"use client";

/* Reusable toggle switch, dark-mode consistent. Use anywhere a boolean preference needs a control. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible label when there's no adjacent visible text. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 flex-none items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}
