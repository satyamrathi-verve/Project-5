"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Company, Customer, Invoice, InvoiceItem, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { VerveLogo } from "@/components/VerveLogo";

/*
  Sales Invoice — Print Preview.
  A finance-desk view of every invoice: search, filter (status / customer /
  date range / only-with-dues), and sort any column. Tick many to batch-print,
  or hit the 🖨 button on a single row to print just that one. Each invoice
  prints on its own page; everything else is `print:hidden`.

  Filters + selection are saved to sessionStorage, so pressing Back after the
  print dialog returns you to the exact same view (nothing "logs out").
  Deep link to one invoice: /invoices/print?id=<invoice-id>.
*/

type FullInvoice = Invoice & { customers: Customer; invoice_items: InvoiceItem[] };
/* `effStatus` and `overdueDays` are derived at render time — see derivedStatus. */
type Row = FullInvoice & {
  received: number;
  due: number;
  overdueDays: number;
  effStatus: InvoiceStatus;
};

type SortKey =
  | "invoice_no"
  | "invoice_date"
  | "due_date"
  | "customer"
  | "total"
  | "received"
  | "due"
  | "overdue_days"
  | "status";
type SortDir = "asc" | "desc";

const STORAGE_KEY = "invprint:v2";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* Amount in words, Indian system (crore / lakh / thousand) — like a real invoice. */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}

function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  let words = `Rupees ${parts.join(" ")}`;
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-700",
  open: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  overdue: "bg-red-100 text-red-700",
};

/* Amounts under half a paisa are rounding dust, not money owed. */
const EPSILON = 0.005;
const MS_PER_DAY = 86_400_000;

/* Whole days a due date has slipped past today. Never negative. */
function daysPast(dueIso: string, todayIso: string): number {
  const d = Math.floor((Date.parse(todayIso) - Date.parse(dueIso)) / MS_PER_DAY);
  return d > 0 ? d : 0;
}

/* The status we DISPLAY, derived from the money and the calendar rather than
   trusting invoices.status — that column is written once and goes stale, so a
   long-unpaid invoice can still be sitting there labelled "open". Per the house
   rule: overdue = still owed AND due_date < today. */
function derivedStatus(due: number, received: number, overdueDays: number): InvoiceStatus {
  if (due <= EPSILON) return "paid";
  if (overdueDays > 0) return "overdue";
  return received > EPSILON ? "partial" : "open";
}

/* The effective GST rate this invoice was raised at. */
function taxPercent(subtotal: number, tax: number): string {
  if (subtotal <= 0) return "0";
  const r = Math.round((tax / subtotal) * 10000) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/* GSTIN's first two digits are the state code. Only the states our customers
   are actually in, plus the ones a demo is likely to reach for. */
const STATE_BY_CODE: Record<string, string> = {
  "06": "Haryana",
  "07": "Delhi",
  "09": "Uttar Pradesh",
  "24": "Gujarat",
  "27": "Maharashtra",
  "29": "Karnataka",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "36": "Telangana",
};

/* Supplier is in Maharashtra (GSTIN 27…). Same state → the tax splits into
   CGST + SGST; any other state is inter-state → a single IGST line. */
function gstLines(
  customer: Customer | null,
  subtotal: number,
  tax: number
): { label: string; amount: number }[] {
  const pct = taxPercent(subtotal, tax);
  const intraState = (customer?.gstin ?? "").trim().startsWith("27");
  if (!intraState) return [{ label: `IGST @ ${pct}%`, amount: tax }];
  const half = Number(pct) / 2;
  const halfPct = Number.isInteger(half) ? String(half) : half.toFixed(2);
  return [
    { label: `CGST @ ${halfPct}%`, amount: tax / 2 },
    { label: `SGST @ ${halfPct}%`, amount: tax / 2 },
  ];
}

function placeOfSupply(customer: Customer | null): string {
  const code = (customer?.gstin ?? "").trim().slice(0, 2);
  const state = STATE_BY_CODE[code];
  return state ? `${state} (${code})` : customer?.address || "—";
}

/* Every seeded line is a professional-advisory engagement; 998311 is the SAC for
   management-consulting services. The invoice_items table has no HSN/SAC column
   and the backend is read-only, so the code is fixed here for the document. */
const SAC_CODE = "998311";

/* Drawn (non-emoji) sort indicator: up when asc, down when desc, faint both when idle. */
function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <svg width="9" height="12" viewBox="0 0 10 14" className="shrink-0" aria-hidden="true">
      <path d="M5 0 L9 5 H1 Z" fill={dir === "asc" ? "currentColor" : "#cbd5e1"} />
      <path d="M5 14 L1 9 H9 Z" fill={dir === "desc" ? "currentColor" : "#cbd5e1"} />
    </svg>
  );
}

/* Drawn funnel icon for column filters — solid when a filter is active. */
function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 2.5 H14.5 L9.5 8.5 V13 L6.5 14.5 V8.5 Z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Drawn printer icon — replaces the 🖨 emoji so it looks the same on every OS. */
function PrinterIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M6 8 V3 H14 V8" />
      <rect x="3" y="8" width="14" height="6" rx="1" />
      <rect x="6" y="11.5" width="8" height="5.5" />
      <circle cx="14.3" cy="10.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Left-chevron back arrow. */
function BackArrow({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10 2 L4 8 L10 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "invoice_no":
      return a.invoice_no.localeCompare(b.invoice_no, undefined, { numeric: true });
    case "invoice_date":
      return a.invoice_date.localeCompare(b.invoice_date);
    case "due_date":
      return a.due_date.localeCompare(b.due_date);
    case "customer":
      return (a.customers?.name ?? "").localeCompare(b.customers?.name ?? "");
    case "total":
      return a.total - b.total;
    case "received":
      return a.received - b.received;
    case "due":
      return a.due - b.due;
    case "overdue_days":
      return a.overdueDays - b.overdueDays;
    case "status":
      return a.effStatus.localeCompare(b.effStatus);
  }
}

/* A row's raw value for a column, as a string key (used by the value filters). */
function rowKey(r: Row, col: SortKey): string {
  switch (col) {
    case "invoice_no": return r.invoice_no;
    case "invoice_date": return r.invoice_date;
    case "due_date": return r.due_date;
    case "customer": return r.customers?.name ?? "—";
    case "total": return String(r.total);
    case "received": return String(r.received);
    case "due": return String(r.due);
    case "overdue_days": return String(r.overdueDays);
    case "status": return r.effStatus;
  }
}

/* How a column's value key is shown in the filter checklist. */
function keyLabel(col: SortKey, key: string): string {
  switch (col) {
    case "invoice_date":
    case "due_date":
      return formatDate(key);
    case "total":
    case "received":
    case "due":
      return inr.format(Number(key));
    case "status":
      return key.charAt(0).toUpperCase() + key.slice(1);
    default:
      return key;
  }
}

/* Download icon for the CSV export button. */
function DownloadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M10 3 V13" />
      <path d="M6 9 L10 13 L14 9" />
      <path d="M4 16 H16" />
    </svg>
  );
}

/* CSV helpers — export the finance summary of whatever rows you pass in.
   Opens straight in Excel or Google Sheets. */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildInvoiceCsv(rows: Row[]): string {
  const header = [
    "Invoice No", "Invoice Date", "Due Date", "Customer", "GSTIN",
    "Taxable Value", "Tax", "Total", "Received", "Balance Due",
    "Days Overdue", "Status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.invoice_no, r.invoice_date, r.due_date, r.customers?.name ?? "",
        r.customers?.gstin ?? "", r.subtotal, r.tax_amount, r.total,
        r.received, r.due, r.overdueDays, r.effStatus,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

function downloadCsv(filename: string, csv: string) {
  // Leading BOM so Excel reads ₹ and other UTF-8 characters correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* A headline number for the row of tiles above the table. `tone` colours only the
   value, so the tiles stay calm and the eye lands on the one that matters. */
function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-0.5 h-4 text-xs text-slate-400">{hint ?? ""}</p>
    </div>
  );
}

/* One printable invoice document — rendered once per invoice being printed. */
function InvoiceDocument({
  invoice,
  company,
  received,
  status,
}: {
  invoice: FullInvoice;
  company: Company | null;
  received: number;
  status: InvoiceStatus;
}) {
  const outstanding = invoice.total - received;
  const items = [...invoice.invoice_items].sort((a, b) =>
    a.description.localeCompare(b.description)
  );
  const customer = invoice.customers ?? null;
  const taxLines = gstLines(customer, invoice.subtotal, invoice.tax_amount);

  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      {/* Brand header band — derived from the brand colour so it agrees with the
          Total bar further down (these used to be two unrelated blues). */}
      <div className="flex items-start justify-between gap-6 bg-gradient-to-r from-brand-dark via-brand to-brand-light px-10 py-7 text-white print:px-[16mm] print:py-[12mm]">
        <div>
          <span className="inline-flex rounded-lg bg-white px-3 py-2 shadow-sm">
            <VerveLogo onLight className="text-[15px]" />
          </span>
          <h1 className="mt-3 text-lg font-bold">{company?.name ?? "Company"}</h1>
          {company?.address && (
            <p className="mt-0.5 max-w-xs text-xs leading-relaxed text-white/75">{company.address}</p>
          )}
          <p className="mt-1 text-xs text-white/75">
            {[company?.gstin && `GSTIN: ${company.gstin}`, company?.email, company?.phone]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black uppercase tracking-[0.18em]">Invoice</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/70">Tax Invoice</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/60">
            Original for Recipient
          </p>
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_STYLES[status] ?? "bg-white/20 text-white"}`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Document body */}
      <div className="px-10 py-8 print:px-[16mm] print:py-[10mm]">

      {/* Bill-to + invoice meta */}
      <div className="flex justify-between gap-8 py-6">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bill To</p>
          <p className="mt-1.5 text-lg font-bold text-slate-900">{invoice.customers?.name}</p>
          {invoice.customers?.address && (
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
              {invoice.customers.address}
            </p>
          )}
          <dl className="mt-3 space-y-1 text-xs text-slate-600">
            {invoice.customers?.gstin && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-semibold uppercase tracking-wide text-slate-400">GSTIN</dt>
                <dd>{invoice.customers.gstin}</dd>
              </div>
            )}
            {invoice.customers?.contact_person && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-semibold uppercase tracking-wide text-slate-400">Contact</dt>
                <dd>{invoice.customers.contact_person}</dd>
              </div>
            )}
            {invoice.customers?.phone && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-semibold uppercase tracking-wide text-slate-400">Phone</dt>
                <dd>{invoice.customers.phone}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="w-64 shrink-0 self-start rounded-xl border border-slate-200 p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Invoice No.</dt>
              <dd className="font-bold text-slate-900">{invoice.invoice_no}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Invoice Date</dt>
              <dd className="font-medium text-slate-900">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Due Date</dt>
              <dd className="font-medium text-slate-900">{formatDate(invoice.due_date)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs">
              <dt className="shrink-0 text-slate-500">Place of Supply</dt>
              <dd className="text-right font-medium text-slate-900">{placeOfSupply(customer)}</dd>
            </div>
            <div className="flex items-center justify-between text-xs">
              <dt className="text-slate-500">Reverse Charge</dt>
              <dd className="font-medium text-slate-900">No</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 print:bg-transparent">
            <th className="w-10 px-2 py-2.5">#</th>
            <th className="px-2 py-2.5">Description</th>
            <th className="w-24 px-2 py-2.5">HSN/SAC</th>
            <th className="w-16 px-2 py-2.5 text-right">Qty</th>
            <th className="w-28 px-2 py-2.5 text-right">Rate</th>
            <th className="w-32 px-2 py-2.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="px-2 py-2.5 text-slate-400">{idx + 1}</td>
              <td className="px-2 py-2.5 text-slate-800">{it.description}</td>
              <td className="px-2 py-2.5 tabular-nums text-slate-500">{SAC_CODE}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">{it.qty}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">{inr.format(it.rate)}</td>
              <td className="px-2 py-2.5 text-right font-medium tabular-nums text-slate-900">{inr.format(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals + amount in words */}
      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="flex-1 text-xs text-slate-500">
          <p className="rounded-lg bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-600">Amount in words: </span>
            {amountInWords(invoice.total)}
          </p>
          {invoice.notes && (
            <p className="mt-2">
              <span className="font-semibold text-slate-600">Notes: </span>
              {invoice.notes}
            </p>
          )}
        </div>
        <div className="w-full sm:w-72">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Taxable Value</span>
              <span className="tabular-nums text-slate-800">{inr.format(invoice.subtotal)}</span>
            </div>
            {taxLines.map((t) => (
              <div key={t.label} className="flex justify-between">
                <span className="text-slate-500">{t.label}</span>
                <span className="tabular-nums text-slate-800">{inr.format(t.amount)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-brand px-4 py-2.5 text-white">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold tabular-nums">{inr.format(invoice.total)}</span>
          </div>
          <div className="mt-1.5 flex justify-between px-4 text-sm">
            <span className="text-slate-500">Amount Received</span>
            <span className="tabular-nums text-slate-700">{inr.format(received)}</span>
          </div>
          {/* Overpaid invoices read as an advance held, not as a negative debt. */}
          <div
            className={`mt-2 flex items-center justify-between rounded-lg px-4 py-3 ${outstanding <= EPSILON ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
          >
            <span className="text-xs font-semibold uppercase tracking-wide">
              {outstanding < -EPSILON ? "Advance Held" : "Balance Due"}
            </span>
            <span className="text-xl font-black tabular-nums">
              {inr.format(Math.abs(outstanding))}
            </span>
          </div>
        </div>
      </div>

        {/* Signature + footer */}
        <div className="mt-12 flex items-end justify-between border-t border-slate-100 pt-6">
          <p className="text-[10px] text-slate-400">
            This is a computer-generated invoice. Thank you for your business.
          </p>
          <div className="text-center">
            {/* A ruled, empty signature line — a placeholder scribble here reads as
                an unfinished document on anything that leaves the building. */}
            <div className="mb-1 h-12 w-48 border-b border-slate-300" />
            <p className="text-xs text-slate-500">
              For <span className="font-semibold text-slate-700">{company?.name ?? "Company"}</span> — Authorised Signatory
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoicePrintPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<FullInvoice[]>([]);
  const [receivedByInvoice, setReceivedByInvoice] = useState<Record<string, number>>({});
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mac vs Windows — so the "Save as PDF" tip shows the right keys/steps.
  const [isMac, setIsMac] = useState(false);
  // Today, as YYYY-MM-DD in the viewer's timezone. Null until mounted: the server
  // renders in UTC and the browser in IST, so reading the clock during the first
  // render would make the two disagree. Ageing simply shows as "not overdue"
  // for the one frame before this lands.
  const [todayIso, setTodayIso] = useState<string | null>(null);

  // Selection + Excel-style column filters (all persisted to sessionStorage).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Per-column value filters, Excel AutoFilter style. filters[col] is the list of
  // ALLOWED values for that column; a column absent from the object = no filter
  // (show everything). An empty array = show nothing (all values unticked).
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  // Text typed into the currently-open filter dropdown's search box.
  const [filterSearch, setFilterSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoice_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // A single invoice that a row's print button asked to print, on its own.
  const [soloPrintId, setSoloPrintId] = useState<string | null>(null);
  // Which column's filter dropdown is open (null = none), and where to draw it.
  // The panel is positioned `fixed` from the funnel button's screen rect, so the
  // table's horizontal scroll container can't clip it and it can't slide under
  // the sidebar on the leftmost columns.
  const [openFilter, setOpenFilter] = useState<SortKey | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null);

  const restored = useRef(false);

  // Restore saved view (and any ?id= deep link) once, before writing anything back.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s) {
        setFilters(s.filters && typeof s.filters === "object" ? s.filters : {});
        setSortKey(s.sortKey ?? "invoice_no");
        setSortDir(s.sortDir ?? "asc");
      }
      let sel: string[] = Array.isArray(s?.selectedIds) ? s.selectedIds : [];
      const fromUrl = new URLSearchParams(window.location.search).get("id");
      if (fromUrl && !sel.includes(fromUrl)) sel = [...sel, fromUrl];
      setSelectedIds(sel);
    } catch {
      /* ignore corrupt storage */
    }
    restored.current = true;
  }, []);

  // Persist the view whenever it changes (after the initial restore).
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ filters, sortKey, sortDir, selectedIds })
      );
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [filters, sortKey, sortDir, selectedIds]);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      setLoading(true);

      const [inv, alloc, comp] = await Promise.all([
        supabase
          .from("invoices")
          .select("*, customers(*), invoice_items(*)")
          .order("invoice_no"),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
        supabase.from("company").select("*").limit(1).single(),
      ]);

      if (inv.error) setError(inv.error.message);
      else setInvoices((inv.data ?? []) as FullInvoice[]);

      if (alloc.data) {
        const sums: Record<string, number> = {};
        for (const a of alloc.data) {
          sums[a.invoice_id] = (sums[a.invoice_id] ?? 0) + a.amount;
        }
        setReceivedByInvoice(sums);
      }
      if (comp.data) setCompany(comp.data as Company);

      setLoading(false);
    }
    load();
  }, []);

  // Detect the operating system + read today's date once, on the client.
  useEffect(() => {
    const p = navigator.platform || "";
    const ua = navigator.userAgent || "";
    setIsMac(/Mac|iPhone|iPad|iPod/.test(p) || /Mac OS X/.test(ua));
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    setTodayIso(local.toISOString().slice(0, 10));
  }, []);

  // The open filter panel is anchored to a screen position, so once the page or
  // the table scrolls (or the window resizes) that position is stale — close it.
  useEffect(() => {
    if (!openFilter) return;
    const close = () => setOpenFilter(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openFilter]);

  // Every invoice enriched with received, due (outstanding), how many days it has
  // slipped past its due date, and the status we actually display.
  const allRows: Row[] = useMemo(
    () =>
      invoices.map((i) => {
        const received = receivedByInvoice[i.id] ?? 0;
        const due = i.total - received;
        const overdueDays =
          todayIso && due > EPSILON ? daysPast(i.due_date, todayIso) : 0;
        return { ...i, received, due, overdueDays, effStatus: derivedStatus(due, received, overdueDays) };
      }),
    [invoices, receivedByInvoice, todayIso]
  );

  // Distinct values for every filterable column (Excel's AutoFilter value list),
  // each already sorted the way that column should sort.
  const columnOptions = useMemo(() => {
    const cols: SortKey[] = [
      "invoice_no", "invoice_date", "due_date", "customer", "total", "received", "due", "status",
    ];
    const out: Record<string, string[]> = {};
    for (const col of cols) {
      const vals = [...new Set(allRows.map((r) => rowKey(r, col)))];
      if (col === "total" || col === "received" || col === "due") vals.sort((a, b) => Number(a) - Number(b));
      else if (col === "invoice_date" || col === "due_date") vals.sort();
      else vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      out[col] = vals;
    }
    return out;
  }, [allRows]);

  // Apply every active column filter (a row must match ALL of them), then sort.
  const visibleRows = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => Array.isArray(v)) as [SortKey, string[]][];
    const rows = allRows.filter((r) =>
      active.every(([col, allowed]) => allowed.includes(rowKey(r, col)))
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => compareRows(a, b, sortKey) * dir);
  }, [allRows, filters, sortKey, sortDir]);

  const selectedRows = useMemo(
    () => allRows.filter((r) => selectedIds.includes(r.id)),
    [allRows, selectedIds]
  );

  // What actually gets rendered as printable documents.
  const printRows = useMemo(() => {
    if (soloPrintId) {
      const one = allRows.find((r) => r.id === soloPrintId);
      return one ? [one] : [];
    }
    return selectedRows;
  }, [soloPrintId, allRows, selectedRows]);

  // Once a solo-print row is rendered, fire the print dialog, then reset.
  useEffect(() => {
    if (!soloPrintId) return;
    const t = setTimeout(() => {
      window.print();
      setSoloPrintId(null);
    }, 80);
    return () => clearTimeout(t);
  }, [soloPrintId]);

  if (!supabase) return <NotConfigured />;

  const visibleIds = visibleRows.map((r) => r.id);
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selectedIds.includes(r.id));
  const hasFilters = Object.values(filters).some((v) => Array.isArray(v));

  function toggleOne(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const ids = new Set(visibleIds);
      setSelectedIds((prev) => prev.filter((x) => !ids.has(x)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...visibleIds])]);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function clearFilters() {
    setFilters({});
  }

  // Export to CSV: the ticked invoices if any are selected, otherwise the whole
  // filtered list you're looking at.
  function exportCsv() {
    const rows = selectedRows.length > 0 ? selectedRows : visibleRows;
    if (rows.length === 0) return;
    const scope = selectedRows.length > 0 ? "selected" : "list";
    downloadCsv(`invoices-${scope}-${rows.length}.csv`, buildInvoiceCsv(rows));
  }

  // Column totals across the filtered rows — the finance-desk footer, and the
  // numbers behind the tiles at the top of the page.
  const totals = visibleRows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.received += r.received;
      acc.due += r.due;
      if (r.effStatus === "overdue") {
        acc.overdueAmount += r.due;
        acc.overdueCount += 1;
      }
      return acc;
    },
    { total: 0, received: 0, due: 0, overdueAmount: 0, overdueCount: 0 }
  );
  const collectedPct = totals.total > 0 ? Math.round((totals.received / totals.total) * 100) : 0;

  // A column header: click the label to sort; the funnel opens an Excel-style
  // filter — a searchable checklist of that column's values, with "Select all".
  function ColumnHeader({
    label,
    col,
    align = "left",
    hint,
  }: {
    label: string;
    col: SortKey;
    align?: "left" | "right";
    hint?: string;
  }) {
    const active = sortKey === col;
    const sel = filters[col]; // undefined = no filter (every value passes)
    const filterActive = Array.isArray(sel);
    const options = columnOptions[col] ?? [];
    const open = openFilter === col;

    const isChecked = (v: string) => !sel || sel.includes(v);
    const shown = options.filter((v) =>
      keyLabel(col, v).toLowerCase().includes(filterSearch.trim().toLowerCase())
    );
    const allShownChecked = shown.length > 0 && shown.every(isChecked);
    const someShownChecked = shown.some(isChecked);

    // Store `next` as this column's filter, collapsing "everything selected" back
    // to no-filter so the funnel doesn't look active when nothing is excluded.
    function apply(next: string[]) {
      setFilters((prev) => {
        const n = { ...prev };
        if (next.length === options.length) delete n[col];
        else n[col] = next;
        return n;
      });
    }
    function toggleValue(v: string) {
      const base = sel ? [...sel] : [...options];
      apply(base.includes(v) ? base.filter((x) => x !== v) : [...base, v]);
    }
    function toggleSelectAll() {
      const base = sel ? [...sel] : [...options];
      apply(
        allShownChecked
          ? base.filter((v) => !shown.includes(v))
          : [...new Set([...base, ...shown])]
      );
    }
    function clearColumn() {
      setFilters((prev) => {
        const n = { ...prev };
        delete n[col];
        return n;
      });
    }

    // Open the panel under this funnel, nudged so it always stays fully on
    // screen: never past the right edge, never left of the sidebar, and flipped
    // above the header if there isn't room below.
    function openPanel(e: React.MouseEvent<HTMLButtonElement>) {
      setFilterSearch("");
      if (open) {
        setOpenFilter(null);
        return;
      }
      const r = e.currentTarget.getBoundingClientRect();
      const W = 256; // w-64
      const H = 380; // roughly the panel's tallest form
      const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
      const below = r.bottom + 6;
      const top = below + H > window.innerHeight ? Math.max(8, r.top - 6 - H) : below;
      setFilterPos({ top, left });
      setOpenFilter(col);
    }

    return (
      <th className={`px-2 py-2.5 ${align === "right" ? "text-right" : "text-left"}`} title={hint}>
        {/* Label then funnel, in that order, on every column — only the whole
            group shifts side, so the funnels line up with their headings. */}
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => handleSort(col)}
            className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-900" : ""}`}
          >
            {label}
            <SortIcon dir={active ? sortDir : null} />
          </button>
          <div>
            <button
              onClick={openPanel}
              className={`rounded p-0.5 hover:bg-slate-200 ${filterActive ? "text-brand" : "text-slate-400"}`}
              title={`Filter ${label.toLowerCase()}`}
            >
              <FunnelIcon active={filterActive} />
            </button>
            {open && filterPos && (
              <>
                {/* click-away backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setOpenFilter(null)} />
                <div
                  style={{ top: filterPos.top, left: filterPos.left }}
                  className="fixed z-50 w-64 rounded-lg border border-slate-200 bg-white text-left font-normal normal-case tracking-normal text-slate-700 shadow-xl"
                >
                  {/* search box */}
                  <div className="border-b border-slate-100 p-2">
                    <input
                      autoFocus
                      type="text"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder={`Search ${label.toLowerCase()}…`}
                      className={`${inputClass} w-full`}
                    />
                  </div>
                  {/* (Select all) */}
                  <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={allShownChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = !allShownChecked && someShownChecked;
                      }}
                      onChange={toggleSelectAll}
                    />
                    (Select all{filterSearch ? " shown" : ""})
                  </label>
                  {/* value checklist */}
                  <div className="max-h-60 overflow-y-auto py-1">
                    {shown.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-400">No matches.</p>
                    ) : (
                      shown.map((v) => (
                        <label
                          key={v}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-brand"
                            checked={isChecked(v)}
                            onChange={() => toggleValue(v)}
                          />
                          <span className="truncate">{keyLabel(col, v)}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {/* footer */}
                  <div className="flex items-center justify-between border-t border-slate-100 p-2">
                    <button
                      onClick={clearColumn}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700"
                    >
                      Clear filter
                    </button>
                    <button
                      onClick={() => setOpenFilter(null)}
                      className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                    >
                      OK
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </th>
    );
  }

  /* A sortable header with no filter funnel — for ageing, where a checklist of
     every distinct day-count would be useless. */
  function PlainHeader({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <th className="px-2 py-2.5 text-right">
        <button
          onClick={() => handleSort(col)}
          className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-900" : ""}`}
        >
          {label}
          <SortIcon dir={active ? sortDir : null} />
        </button>
      </th>
    );
  }

  return (
    <div>
      {/* Screen-only controls — hidden when printing */}
      <div className="print:hidden">
        <button
          onClick={() => router.back()}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <BackArrow />
          Back
        </button>
        <PageHeader
          title="Invoice Print Preview"
          subtitle="Search, filter and sort your invoices. Tick many to batch-print, or use the print button on any row to print just that one."
          action={
            selectedRows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds([])}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Clear selection
                </button>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  <PrinterIcon /> Print {selectedRows.length} {selectedRows.length === 1 ? "Invoice" : "Invoices"}
                </button>
              </div>
            )
          }
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Headline numbers — what a room reads first. These follow the filters,
            so they always describe the list actually on screen. */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Total Invoiced"
            value={inr.format(totals.total)}
            hint={`${visibleRows.length} invoice${visibleRows.length === 1 ? "" : "s"}`}
          />
          <StatTile
            label="Received"
            value={inr.format(totals.received)}
            hint={`${collectedPct}% collected`}
            tone="good"
          />
          <StatTile
            label="Outstanding"
            value={inr.format(totals.due)}
            hint="Allocated receipts only"
          />
          <StatTile
            label="Overdue"
            value={inr.format(totals.overdueAmount)}
            hint={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"} past due`}
            tone={totals.overdueCount > 0 ? "bad" : "good"}
          />
        </div>

        {/* A filtered list is a subset — say so, loudly, so nobody quotes a
            partial total as if it were the whole book. */}
        {hasFilters && (
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>
              <strong>Filtered view</strong> — showing {visibleRows.length} of {allRows.length} invoices.
              The tiles and totals below describe only these rows.
            </span>
            <button
              onClick={clearFilters}
              className="shrink-0 font-semibold underline underline-offset-2 hover:text-amber-900"
            >
              Show all
            </button>
          </div>
        )}

        {/* Toolbar — filtering lives in each column header (the funnel icons) */}
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-700">{visibleRows.length}</span> of {allRows.length}{" "}
            invoices · Due <span className="font-semibold text-red-600">{inr.format(totals.due)}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={visibleRows.length === 0}
              title={
                selectedRows.length > 0
                  ? `Export ${selectedRows.length} selected invoice${selectedRows.length === 1 ? "" : "s"} to CSV`
                  : "Export the shown list to CSV (Excel / Google Sheets)"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <DownloadIcon /> Export CSV
            </button>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* How-to-save hint — adapts to Windows or Mac */}
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <p>
            <strong>Save as PDF:</strong>{" "}
            {isMac
              ? "press ⌘ + P, then open the PDF ▾ menu at the bottom-left and choose “Save as PDF”."
              : "press Ctrl + P, then set the printer to “Save as PDF” (or “Microsoft Print to PDF”)."}{" "}
            Prefer a spreadsheet? Use <strong>Export CSV</strong> — it opens in Excel or Google Sheets.
          </p>
        </div>

        {/* Invoice table */}
        {loading ? (
          /* Skeleton rows rather than a bare "Loading…" line: the table's shape
             shows up immediately, so the wait reads as filling-in, not hanging. */
          <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Loading invoices…
            </div>
            <div className="animate-pulse divide-y divide-slate-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-4 w-4 shrink-0 rounded bg-slate-200" />
                  <div className="h-3 w-24 rounded bg-slate-200" />
                  <div className="h-3 w-20 rounded bg-slate-100" />
                  <div className="h-3 flex-1 rounded bg-slate-100" />
                  <div className="h-3 w-24 rounded bg-slate-200" />
                  <div className="h-3 w-16 rounded bg-slate-100" />
                  <div className="h-5 w-16 shrink-0 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-6 max-h-[65vh] overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[5]">
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-12 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="h-4 w-4 accent-brand"
                      title="Select all shown"
                    />
                  </th>
                  <ColumnHeader label="Invoice No." col="invoice_no" />
                  <ColumnHeader label="Date" col="invoice_date" />
                  <ColumnHeader label="Due Date" col="due_date" />
                  <ColumnHeader label="Customer" col="customer" />
                  <ColumnHeader label="Total" col="total" align="right" />
                  <ColumnHeader
                    label="Received"
                    col="received"
                    align="right"
                    hint="Receipts allocated against this invoice. Money received on account but not yet knocked off does not appear here."
                  />
                  <ColumnHeader label="Due" col="due" align="right" />
                  <PlainHeader label="Days Overdue" col="overdue_days" />
                  <ColumnHeader label="Status" col="status" align="right" />
                  <th className="px-4 py-2.5 text-right">Print</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                      No invoices match these filters. Open a column’s filter to adjust.
                    </td>
                  </tr>
                )}
                {visibleRows.map((r) => (
                  /* Selection is on the checkbox only. A whole-row click meant that
                     pointing at a figure during a demo silently ticked an invoice. */
                  <tr
                    key={r.id}
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selectedIds.includes(r.id) ? "bg-brand/5" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="h-4 w-4 cursor-pointer accent-brand"
                        title={`Select invoice ${r.invoice_no}`}
                      />
                    </td>
                    <td className="px-2 py-2.5 font-medium tabular-nums text-slate-900">{r.invoice_no}</td>
                    <td className="px-2 py-2.5 tabular-nums text-slate-600">{formatDate(r.invoice_date)}</td>
                    <td className="px-2 py-2.5 tabular-nums text-slate-600">{formatDate(r.due_date)}</td>
                    <td className="px-2 py-2.5 text-slate-800">{r.customers?.name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">{inr.format(r.total)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{inr.format(r.received)}</td>
                    {/* Red is reserved for money that is actually late — otherwise a
                        perfectly healthy ledger reads as a crisis. */}
                    <td
                      className={`px-2 py-2.5 text-right font-medium tabular-nums ${
                        r.effStatus === "overdue"
                          ? "text-red-600"
                          : r.due > EPSILON
                            ? "text-slate-800"
                            : "text-green-600"
                      }`}
                    >
                      {r.due < -EPSILON ? `(${inr.format(-r.due)})` : inr.format(r.due)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {r.overdueDays > 0 ? (
                        <span className="font-semibold text-red-600">{r.overdueDays}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[r.effStatus] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {r.effStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSoloPrintId(r.id);
                        }}
                        title={`Print invoice ${r.invoice_no}`}
                        className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:border-brand hover:bg-brand/5 hover:text-brand"
                      >
                        <PrinterIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className={visibleRows.length === 0 ? "hidden" : ""}>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <td className="px-4 py-2.5" colSpan={5}>
                    {visibleRows.length} invoice{visibleRows.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-900">{inr.format(totals.total)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{inr.format(totals.received)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-red-600">{inr.format(totals.due)}</td>
                  <td className="px-2 py-2.5" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Preview toolbar — a clear Back out of the preview, plus Print (screen only) */}
      {printRows.length > 0 && (
        <div className="print:hidden mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <BackArrow />
            Back
          </button>
          <span className="text-sm text-slate-500">
            Print preview — {printRows.length} invoice{printRows.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <PrinterIcon /> Print
          </button>
        </div>
      )}

      {/* The printable documents — one per invoice, each on its own page */}
      <div className="space-y-8 print:space-y-0">
        {printRows.map((r, idx) => (
          <div
            key={r.id}
            className={idx < printRows.length - 1 ? "print:break-after-page" : ""}
          >
            <InvoiceDocument
              invoice={r}
              company={company}
              received={r.received}
              status={r.effStatus}
            />
          </div>
        ))}
      </div>

      {printRows.length === 0 && !loading && (
        <div className="print:hidden rounded-xl border border-dashed border-slate-300 bg-white px-4 py-16 text-center text-slate-400">
          Tick one or more invoices above (or use the print button on a row) to see the print preview.
        </div>
      )}
    </div>
  );
}
