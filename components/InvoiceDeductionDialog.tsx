"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import type { GLAccount } from "@/lib/types";
import { inputClass } from "@/components/FormField";
import { Icon } from "@/components/icons";
import { formatMoney } from "@/lib/balances";
import { invoiceDeductionTotal, isPostable, type InvoiceDeduction } from "@/lib/invoiceExtras";

/*
  Deductions on an invoice: GL account · description · signed amount.

  The sign is the whole point. A negative amount reduces what the customer owes
  (a discount, a rebate) and lands on the credit side of the chosen GL account; a
  positive amount adds to the invoice (a recovered charge) and lands on the debit
  side. We show the resolved side next to each row so nobody has to remember.
*/
export function InvoiceDeductionDialog({
  open,
  glAccounts,
  deductions,
  onChange,
  onClose,
}: {
  open: boolean;
  glAccounts: GLAccount[];
  deductions: InvoiceDeduction[];
  onChange: (next: InvoiceDeduction[]) => void;
  onClose: () => void;
}) {
  /*
    Rows are edited live through onChange, so Cancel has to put back what was
    there when the dialog opened — otherwise "Cancel" would silently keep the
    edits, which is worse than having no Cancel at all.
  */
  const snapshot = useRef<InvoiceDeduction[]>([]);
  useEffect(() => {
    if (open) snapshot.current = deductions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function cancel() {
    onChange(snapshot.current);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function addRow() {
    onChange([
      ...deductions,
      { id: crypto.randomUUID(), glAccountId: "", glAccountName: "", description: "", amount: 0 },
    ]);
  }
  function updateRow(id: string, patch: Partial<InvoiceDeduction>) {
    onChange(deductions.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  function removeRow(id: string) {
    onChange(deductions.filter((d) => d.id !== id));
  }

  const net = invoiceDeductionTotal(deductions);
  const incomplete = deductions.filter((d) => !isPostable(d)).length;

  return createPortal(
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={cancel} />
      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="p-6">
          <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light">
            <Icon name="receipt" size={20} />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Deductions</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Post an adjustment against a GL account. A <strong>negative</strong> amount reduces what the customer owes
            (discount, rebate); a <strong>positive</strong> amount adds to it (a recovered charge).
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                  <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">GL Account</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Description</th>
                  <th className="w-40 px-3 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
                    Amount (₹)
                  </th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {deductions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-xs text-slate-400">
                      No deductions yet — add the first row.
                    </td>
                  </tr>
                ) : (
                  deductions.map((d) => {
                    const amt = Number(d.amount) || 0;
                    return (
                      <tr key={d.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2">
                          <select
                            className={`${inputClass} w-full`}
                            value={d.glAccountId}
                            onChange={(e) => {
                              const acc = glAccounts.find((a) => a.id === e.target.value);
                              updateRow(d.id, { glAccountId: e.target.value, glAccountName: acc?.name ?? "" });
                            }}
                          >
                            <option value="">— pick an account —</option>
                            {glAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={`${inputClass} w-full`}
                            value={d.description}
                            onChange={(e) => updateRow(d.id, { description: e.target.value })}
                            placeholder="e.g. Early payment discount"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className={`${inputClass} w-full text-right`}
                            value={d.amount || ""}
                            onChange={(e) => updateRow(d.id, { amount: Number(e.target.value) || 0 })}
                            placeholder="0.00"
                          />
                          {amt !== 0 && (
                            <span
                              className={`mt-0.5 block text-right text-[11px] font-medium ${
                                amt < 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              {amt < 0 ? "Credit" : "Debit"} {d.glAccountName || "— no account —"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeRow(d.id)}
                            className="text-slate-400 hover:text-red-600"
                            title="Remove this deduction"
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand hover:text-white"
            >
              + Add deduction
            </button>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Net adjustment:{" "}
              <span className={`font-semibold ${net < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>
                {formatMoney(net)}
              </span>
            </p>
          </div>

          {incomplete > 0 && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {incomplete} row{incomplete > 1 ? "s" : ""} still need a GL account and a non-zero amount — those won&apos;t
              be saved.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
            >
              <Icon name="check" size={15} />
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
