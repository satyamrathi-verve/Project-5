/*
  Local-only extras for an invoice, keyed by the invoice's database id — the same
  pattern as lib/receiptExtras.ts and lib/customerMeta.ts. The golden rule is that
  we never alter the backend, and `invoices` has no deductions table.

  A deduction is a posting against a GL account that adjusts the invoice: a
  discount, a rebate, a withholding, a rounding adjustment. The amount is SIGNED —
  negative reduces what the customer owes, positive adds to it — so the sign says
  which side of the GL account it lands on.

  If a deductions table is ever added to Supabase, move this data onto real rows
  and delete this file.
*/

export interface InvoiceDeduction {
  id: string;
  glAccountId: string;
  glAccountName: string;
  description: string;
  /** Signed: negative = reduces the invoice (credit), positive = adds to it (debit). */
  amount: number;
}

const KEY = "invoice_extras_v1";

interface InvoiceExtras {
  deductions: InvoiceDeduction[];
}

const BLANK: InvoiceExtras = { deductions: [] };

function readAll(): Record<string, InvoiceExtras> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, InvoiceExtras>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

export function getInvoiceDeductions(invoiceId: string): InvoiceDeduction[] {
  return readAll()[invoiceId]?.deductions ?? [];
}

export function setInvoiceDeductions(invoiceId: string, deductions: InvoiceDeduction[]) {
  const all = readAll();
  if (deductions.length === 0) delete all[invoiceId];
  else all[invoiceId] = { ...BLANK, deductions };
  writeAll(all);
}

/** Net of all deductions. Negative reduces the invoice, positive increases it. */
export function invoiceDeductionTotal(deductions: InvoiceDeduction[]): number {
  return deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
}

/** A deduction only posts once it names a GL account and carries a non-zero amount. */
export function isPostable(d: InvoiceDeduction): boolean {
  return Boolean(d.glAccountId) && Math.abs(Number(d.amount) || 0) > 0.005;
}
