import type { InvoiceStatus } from "@/lib/types";

/*
  A small coloured pill for an invoice status. Reuse on every screen that shows a
  status so the colours mean the same thing everywhere:
  paid = green, open = slate, partial = amber, overdue = red.
*/
const STYLES: Record<InvoiceStatus, string> = {
  paid: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  open: "bg-slate-100 text-slate-600 ring-slate-200",
  partial: "bg-amber-100 text-amber-700 ring-amber-200",
  overdue: "bg-red-100 text-red-700 ring-red-200",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
