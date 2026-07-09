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
type Row = FullInvoice & { received: number; due: number };

type SortKey =
  | "invoice_no"
  | "invoice_date"
  | "due_date"
  | "customer"
  | "total"
  | "received"
  | "due"
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "partial", label: "Partial" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

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

/* Fresh, empty min/max ranges for the numeric column filters. */
function freshRanges(): Record<string, { min: string; max: string }> {
  return {
    total: { min: "", max: "" },
    received: { min: "", max: "" },
    due: { min: "", max: "" },
  };
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
    case "status":
      return a.status.localeCompare(b.status);
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
    "Subtotal", "Tax", "Total", "Received", "Balance Due", "Status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.invoice_no, r.invoice_date, r.due_date, r.customers?.name ?? "",
        r.customers?.gstin ?? "", r.subtotal, r.tax_amount, r.total,
        r.received, r.due, r.status,
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

/* One printable invoice document — rendered once per invoice being printed. */
function InvoiceDocument({
  invoice,
  company,
  received,
}: {
  invoice: FullInvoice;
  company: Company | null;
  received: number;
}) {
  const outstanding = invoice.total - received;
  const items = [...invoice.invoice_items].sort((a, b) =>
    a.description.localeCompare(b.description)
  );

  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      {/* Brand header band */}
      <div className="flex items-start justify-between gap-6 bg-gradient-to-r from-[#22397a] via-[#2b4c9c] to-[#3f6fd6] px-10 py-7 text-white print:px-[16mm] print:py-[12mm]">
        <div>
          <span className="inline-flex rounded-lg bg-white px-3 py-2 shadow-sm">
            <VerveLogo className="text-[15px]" />
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
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_STYLES[invoice.status] ?? "bg-white/20 text-white"}`}
          >
            {invoice.status}
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
          </dl>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 print:bg-transparent">
            <th className="w-10 px-2 py-2.5">#</th>
            <th className="px-2 py-2.5">Description</th>
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
              <td className="px-2 py-2.5 text-right text-slate-800">{it.qty}</td>
              <td className="px-2 py-2.5 text-right text-slate-800">{inr.format(it.rate)}</td>
              <td className="px-2 py-2.5 text-right font-medium text-slate-900">{inr.format(it.amount)}</td>
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
              <span className="text-slate-500">Subtotal</span>
              <span className="tabular-nums text-slate-800">{inr.format(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Tax</span>
              <span className="tabular-nums text-slate-800">{inr.format(invoice.tax_amount)}</span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-brand px-4 py-2.5 text-white">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold tabular-nums">{inr.format(invoice.total)}</span>
          </div>
          <div className="mt-1.5 flex justify-between px-4 text-sm">
            <span className="text-slate-500">Amount Received</span>
            <span className="tabular-nums text-slate-700">{inr.format(received)}</span>
          </div>
          <div
            className={`mt-2 flex items-center justify-between rounded-lg px-4 py-3 ${outstanding <= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
          >
            <span className="text-xs font-semibold uppercase tracking-wide">Balance Due</span>
            <span className="text-xl font-black tabular-nums">{inr.format(outstanding)}</span>
          </div>
        </div>
      </div>

        {/* Signature + footer */}
        <div className="mt-12 flex items-end justify-between border-t border-slate-100 pt-6">
          <p className="text-[10px] text-slate-400">
            This is a computer-generated invoice. Thank you for your business.
          </p>
          <div className="text-center">
            <div className="mb-1 flex h-12 w-48 items-end justify-center border-b border-slate-300">
              <span
                style={{ fontFamily: '"Segoe Script", "Brush Script MT", cursive' }}
                className="pb-1 text-2xl italic text-slate-700"
              >
                abc
              </span>
            </div>
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

  // Selection + filters (all persisted to sessionStorage).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [customerId, setCustomerId] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [duesOnly, setDuesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("invoice_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // A single invoice that a row's 🖨 button asked to print, printed on its own.
  const [soloPrintId, setSoloPrintId] = useState<string | null>(null);
  // Which column's filter dropdown is open (null = none).
  const [openFilter, setOpenFilter] = useState<SortKey | null>(null);
  // Custom min/max amount filters, keyed by column (total / received / due).
  const [ranges, setRanges] = useState<Record<string, { min: string; max: string }>>(freshRanges);
  // Per-column filters for the remaining fields.
  const [invNo, setInvNo] = useState(""); // Invoice No. contains
  const [dueFrom, setDueFrom] = useState(""); // Due Date range
  const [dueTo, setDueTo] = useState("");

  const restored = useRef(false);

  // Restore saved view (and any ?id= deep link) once, before writing anything back.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s) {
        setSearch(s.search ?? "");
        setStatus(s.status ?? "all");
        setCustomerId(s.customerId ?? "all");
        setFromDate(s.fromDate ?? "");
        setToDate(s.toDate ?? "");
        setDuesOnly(!!s.duesOnly);
        setSortKey(s.sortKey ?? "invoice_no");
        setSortDir(s.sortDir ?? "asc");
        setRanges(s.ranges && typeof s.ranges === "object" ? { ...freshRanges(), ...s.ranges } : freshRanges());
        setInvNo(s.invNo ?? "");
        setDueFrom(s.dueFrom ?? "");
        setDueTo(s.dueTo ?? "");
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
        JSON.stringify({
          search, status, customerId, fromDate, toDate, duesOnly, sortKey, sortDir, selectedIds, ranges,
          invNo, dueFrom, dueTo,
        })
      );
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [search, status, customerId, fromDate, toDate, duesOnly, sortKey, sortDir, selectedIds, ranges, invNo, dueFrom, dueTo]);

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

  // Detect the operating system once, on the client.
  useEffect(() => {
    const p = navigator.platform || "";
    const ua = navigator.userAgent || "";
    setIsMac(/Mac|iPhone|iPad|iPod/.test(p) || /Mac OS X/.test(ua));
  }, []);

  // Every invoice enriched with received + due (outstanding) amounts.
  const allRows: Row[] = useMemo(
    () =>
      invoices.map((i) => {
        const received = receivedByInvoice[i.id] ?? 0;
        return { ...i, received, due: i.total - received };
      }),
    [invoices, receivedByInvoice]
  );

  // Customers that actually appear on invoices, for the customer filter.
  const customerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allRows) {
      if (r.customers?.id) seen.set(r.customers.id, r.customers.name);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows]);

  // Apply all filters, then sort.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = allRows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (customerId !== "all" && r.customers?.id !== customerId) return false;
      if (fromDate && r.invoice_date < fromDate) return false;
      if (toDate && r.invoice_date > toDate) return false;
      if (dueFrom && r.due_date < dueFrom) return false;
      if (dueTo && r.due_date > dueTo) return false;
      if (invNo && !r.invoice_no.toLowerCase().includes(invNo.trim().toLowerCase())) return false;
      if (duesOnly && r.due <= 0) return false;
      for (const col of ["total", "received", "due"] as const) {
        const { min, max } = ranges[col];
        if (min !== "" && r[col] < Number(min)) return false;
        if (max !== "" && r[col] > Number(max)) return false;
      }
      if (q) {
        const hay = `${r.invoice_no} ${r.customers?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => compareRows(a, b, sortKey) * dir);
  }, [allRows, search, status, customerId, fromDate, toDate, duesOnly, sortKey, sortDir, ranges, invNo, dueFrom, dueTo]);

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
  const rangesActive = ["total", "received", "due"].some(
    (c) => ranges[c].min !== "" || ranges[c].max !== ""
  );
  const hasFilters =
    !!search || status !== "all" || customerId !== "all" || !!fromDate || !!toDate || duesOnly ||
    rangesActive || !!invNo || !!dueFrom || !!dueTo;

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
    setSearch("");
    setStatus("all");
    setCustomerId("all");
    setFromDate("");
    setToDate("");
    setDuesOnly(false);
    setRanges(freshRanges());
    setInvNo("");
    setDueFrom("");
    setDueTo("");
  }

  function setRange(col: string, part: "min" | "max", value: string) {
    setRanges((prev) => ({ ...prev, [col]: { ...prev[col], [part]: value } }));
  }

  // Export to CSV: the ticked invoices if any are selected, otherwise the whole
  // filtered list you're looking at.
  function exportCsv() {
    const rows = selectedRows.length > 0 ? selectedRows : visibleRows;
    if (rows.length === 0) return;
    const scope = selectedRows.length > 0 ? "selected" : "list";
    downloadCsv(`invoices-${scope}-${rows.length}.csv`, buildInvoiceCsv(rows));
  }

  // Column totals across the filtered rows — the finance-desk footer.
  const totals = visibleRows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.received += r.received;
      acc.due += r.due;
      return acc;
    },
    { total: 0, received: 0, due: 0 }
  );

  // A column header: click the label to sort; the funnel opens a filter menu
  // right on the column — a pick-list for Customer/Status, or a custom
  // min–max amount range for Total/Received/Due.
  function ColumnHeader({
    label,
    col,
    align = "left",
    filterType,
  }: {
    label: string;
    col: SortKey;
    align?: "left" | "right";
    filterType?: "status" | "customer" | "range" | "text" | "invdate" | "duedate";
  }) {
    const active = sortKey === col;
    const filterActive =
      (filterType === "status" && status !== "all") ||
      (filterType === "customer" && customerId !== "all") ||
      (filterType === "range" && (ranges[col]?.min !== "" || ranges[col]?.max !== "")) ||
      (filterType === "text" && invNo !== "") ||
      (filterType === "invdate" && (fromDate !== "" || toDate !== "")) ||
      (filterType === "duedate" && (dueFrom !== "" || dueTo !== ""));
    return (
      <th className={`px-2 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}>
        <div className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
          <button
            onClick={() => handleSort(col)}
            className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-900" : ""}`}
          >
            {label}
            <SortIcon dir={active ? sortDir : null} />
          </button>
          {filterType && (
            <div className="relative">
              <button
                onClick={() => setOpenFilter(openFilter === col ? null : col)}
                className={`rounded p-0.5 hover:bg-slate-200 ${filterActive ? "text-brand" : "text-slate-400"}`}
                title={`Filter by ${label.toLowerCase()}`}
              >
                <FunnelIcon active={filterActive} />
              </button>
              {openFilter === col && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setOpenFilter(null)} />
                  <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-left font-normal normal-case tracking-normal text-slate-700 shadow-lg">
                    {filterType === "status" &&
                      STATUS_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => {
                            setStatus(o.value);
                            setOpenFilter(null);
                          }}
                          className={`block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100 ${status === o.value ? "font-semibold text-brand" : ""}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    {filterType === "customer" && (
                      <>
                        <button
                          onClick={() => {
                            setCustomerId("all");
                            setOpenFilter(null);
                          }}
                          className={`block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100 ${customerId === "all" ? "font-semibold text-brand" : ""}`}
                        >
                          All customers
                        </button>
                        {customerOptions.map(([id, name]) => (
                          <button
                            key={id}
                            onClick={() => {
                              setCustomerId(id);
                              setOpenFilter(null);
                            }}
                            className={`block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100 ${customerId === id ? "font-semibold text-brand" : ""}`}
                          >
                            {name}
                          </button>
                        ))}
                      </>
                    )}
                    {filterType === "range" && (
                      <div className="p-2">
                        <p className="mb-2 px-1 text-xs font-semibold text-slate-500">
                          {label} between (₹)
                        </p>
                        <div className="flex items-center gap-2 px-1">
                          <input
                            type="number"
                            placeholder="Min"
                            value={ranges[col]?.min ?? ""}
                            onChange={(e) => setRange(col, "min", e.target.value)}
                            className={`${inputClass} w-20`}
                          />
                          <span className="text-slate-400">–</span>
                          <input
                            type="number"
                            placeholder="Max"
                            value={ranges[col]?.max ?? ""}
                            onChange={(e) => setRange(col, "max", e.target.value)}
                            className={`${inputClass} w-20`}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between px-1">
                          <button
                            onClick={() => setRanges((prev) => ({ ...prev, [col]: { min: "", max: "" } }))}
                            className="text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => setOpenFilter(null)}
                            className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                    {filterType === "text" && (
                      <div className="p-2">
                        <p className="mb-2 px-1 text-xs font-semibold text-slate-500">Invoice number contains</p>
                        <input
                          type="text"
                          placeholder="e.g. INV-0001"
                          value={invNo}
                          onChange={(e) => setInvNo(e.target.value)}
                          className={`${inputClass} w-full`}
                          autoFocus
                        />
                        <div className="mt-2 flex items-center justify-between px-1">
                          <button onClick={() => setInvNo("")} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                            Clear
                          </button>
                          <button onClick={() => setOpenFilter(null)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                    {(filterType === "invdate" || filterType === "duedate") && (
                      <div className="p-2">
                        <p className="mb-2 px-1 text-xs font-semibold text-slate-500">{label} between</p>
                        <div className="flex flex-col gap-2 px-1">
                          <input
                            type="date"
                            value={filterType === "invdate" ? fromDate : dueFrom}
                            onChange={(e) =>
                              filterType === "invdate" ? setFromDate(e.target.value) : setDueFrom(e.target.value)
                            }
                            className={`${inputClass} w-full`}
                          />
                          <input
                            type="date"
                            value={filterType === "invdate" ? toDate : dueTo}
                            onChange={(e) =>
                              filterType === "invdate" ? setToDate(e.target.value) : setDueTo(e.target.value)
                            }
                            className={`${inputClass} w-full`}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between px-1">
                          <button
                            onClick={() => {
                              if (filterType === "invdate") {
                                setFromDate("");
                                setToDate("");
                              } else {
                                setDueFrom("");
                                setDueTo("");
                              }
                            }}
                            className="text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            Clear
                          </button>
                          <button onClick={() => setOpenFilter(null)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
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
          <div className="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
            Loading invoices…
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="mb-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-400">
            No invoices match these filters.
          </div>
        ) : (
          <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
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
                  <ColumnHeader label="Invoice No." col="invoice_no" filterType="text" />
                  <ColumnHeader label="Date" col="invoice_date" filterType="invdate" />
                  <ColumnHeader label="Due Date" col="due_date" filterType="duedate" />
                  <ColumnHeader label="Customer" col="customer" filterType="customer" />
                  <ColumnHeader label="Total" col="total" align="right" filterType="range" />
                  <ColumnHeader label="Received" col="received" align="right" filterType="range" />
                  <ColumnHeader label="Due" col="due" align="right" filterType="range" />
                  <ColumnHeader label="Status" col="status" align="right" filterType="status" />
                  <th className="px-4 py-2.5 text-right">Print</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => toggleOne(r.id)}
                    className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selectedIds.includes(r.id) ? "bg-blue-50/50" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() => toggleOne(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-brand"
                      />
                    </td>
                    <td className="px-2 py-2.5 font-medium text-slate-900">{r.invoice_no}</td>
                    <td className="px-2 py-2.5 text-slate-600">{formatDate(r.invoice_date)}</td>
                    <td className="px-2 py-2.5 text-slate-600">{formatDate(r.due_date)}</td>
                    <td className="px-2 py-2.5 text-slate-800">{r.customers?.name}</td>
                    <td className="px-2 py-2.5 text-right text-slate-800">{inr.format(r.total)}</td>
                    <td className="px-2 py-2.5 text-right text-slate-600">{inr.format(r.received)}</td>
                    <td
                      className={`px-2 py-2.5 text-right font-medium ${r.due > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {inr.format(r.due)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {r.status}
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
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <td className="px-4 py-2.5" colSpan={5}>
                    {visibleRows.length} invoice{visibleRows.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-slate-900">{inr.format(totals.total)}</td>
                  <td className="px-2 py-2.5 text-right text-slate-700">{inr.format(totals.received)}</td>
                  <td className="px-2 py-2.5 text-right text-red-600">{inr.format(totals.due)}</td>
                  <td className="px-2 py-2.5" colSpan={2} />
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
            <InvoiceDocument invoice={r} company={company} received={r.received} />
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
