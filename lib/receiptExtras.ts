/*
  Local-only extras for a receipt that the shared backend has no columns for —
  exactly the same pattern as lib/customerMeta.ts (the golden rule is never to
  alter the backend). Two things live here, keyed by the receipt's database id:

  - Deductions: the receipt came in short of an invoice's outstanding amount
    because of something like TDS or bank charges — recorded as a GL account +
    amount so the shortfall is explained, without a deductions column existing.
  - Service notes: which service(s) an allocation against a given invoice was
    actually for, keyed by invoice id — the schema has no per-item allocation.

  If deduction/service-note columns are ever added to Supabase, move this data
  onto the real rows and delete this file.
*/

export interface Deduction {
  id: string;
  glAccountId: string;
  glAccountName: string;
  amount: number;
}

export interface ReceiptExtras {
  deductions: Deduction[];
  /** invoice_id -> free-text note on which services this allocation covers. */
  serviceNotes: Record<string, string>;
}

export const BLANK_EXTRAS: ReceiptExtras = { deductions: [], serviceNotes: {} };

const KEY = "receipt_extras_v1";

function readAll(): Record<string, ReceiptExtras> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ReceiptExtras>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

export function getReceiptExtras(receiptId: string): ReceiptExtras {
  const found = readAll()[receiptId];
  return found ? { ...BLANK_EXTRAS, ...found } : { ...BLANK_EXTRAS };
}

export function setReceiptExtras(receiptId: string, extras: ReceiptExtras) {
  const all = readAll();
  all[receiptId] = extras;
  writeAll(all);
}

export function deductionTotal(deductions: Deduction[]): number {
  return deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
}
