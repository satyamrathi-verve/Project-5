"use client";

/*
  Cash Flow — module section tabs (Dashboard / Statement / Forecast / Inflows /
  Outflows / Bank Accounts). Horizontally scrollable on small screens.
*/

import { Icon, type IconName } from "@/components/icons";

export type CashFlowView = "dashboard" | "statement" | "forecast" | "inflows" | "outflows" | "bank";

const VIEWS: { id: CashFlowView; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "statement", label: "Cash Flow Statement", icon: "scroll" },
  { id: "forecast", label: "Cash Forecast", icon: "trend" },
  { id: "inflows", label: "Cash Inflows", icon: "download" },
  { id: "outflows", label: "Cash Outflows", icon: "upload" },
  { id: "bank", label: "Bank Accounts", icon: "book" },
];

export function ViewTabs({ value, onChange }: { value: CashFlowView; onChange: (v: CashFlowView) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {VIEWS.map((v) => {
        const active = v.id === value;
        return (
          <button
            key={v.id}
            onClick={() => onChange(v.id)}
            className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-brand text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon name={v.icon} size={16} />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
