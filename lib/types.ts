/*
  TypeScript shapes that mirror the database tables (see supabase/seed.sql).
  Keep these in sync as you build screens — they're your map of the backend.
*/

export interface Company {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  credit_days: number;
  opening_balance: number;
  created_at: string;
}

export interface GLAccount {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  parent_group: string | null;
}

export type InvoiceStatus = "open" | "partial" | "paid" | "overdue";

export interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: InvoiceStatus;
  notes: string | null;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export type ReceiptMode = "cash" | "cheque" | "upi" | "neft";

export interface Receipt {
  id: string;
  receipt_no: string;
  receipt_date: string;
  customer_id: string;
  amount: number;
  mode: ReceiptMode;
  reference: string | null;
  created_at: string;
}

export interface ReceiptAllocation {
  id: string;
  receipt_id: string;
  invoice_id: string;
  amount: number;
}

export interface ReminderTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface ReminderLog {
  id: string;
  invoice_id: string | null;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string;
}
