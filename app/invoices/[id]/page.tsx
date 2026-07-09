"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type {
  Company,
  Customer,
  GLAccount,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
} from "@/lib/types";
import { formatMoney } from "@/lib/balances";
import { invoiceGlImpact } from "@/lib/gl";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { VerveLogo } from "@/components/VerveLogo";
import { CollectionFollowups } from "@/components/CollectionFollowups";
import { GlImpactReview } from "@/components/GlImpactReview";

/*
  Sales Invoice — View (one invoice in full detail, with amount still outstanding).
  Route: /invoices/[id]

  Presented as a professional TAX INVOICE on Verve Advisory letterhead.
  Outstanding is DERIVED, never stored: total − sum of this invoice's
  receipt_allocations.amount (see CLAUDE.md). We also show how it was paid down
  (the receipts that were knocked off against this invoice).
*/

/** One payment knocked off against this invoice (allocation + its parent receipt). */
interface Payment {
  id: string;
  amount: number;
  receipt_no: string | null;
  receipt_date: string | null;
  mode: string | null;
  reference: string | null;
}

/** Shape of the receipt_allocations row with its parent receipt embedded. */
interface AllocationRow {
  id: string;
  amount: number | string;
  receipts: {
    receipt_no: string | null;
    receipt_date: string | null;
    mode: string | null;
    reference: string | null;
  } | null;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Whole days that `due` is in the past (>0 means overdue). Today counts as not overdue. */
function daysOverdue(due: string | null): number {
  if (!due) return 0;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86_400_000);
}

/** Effective tax %, derived from tax_amount / subtotal. "18" not "18.00". */
function taxPercent(subtotal: number, tax: number): string {
  if (subtotal <= 0) return "0";
  const r = Math.round((tax / subtotal) * 10000) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Indian-system number to words (12,34,567 → Twelve Lakh …). */
function numToWordsIndian(numIn: number): string {
  let n = Math.floor(numIn);
  if (n === 0) return "Zero";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x);

  let words = "";
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) words += `${three(crore)} Crore `;
  if (lakh) words += `${two(lakh)} Lakh `;
  if (thousand) words += `${two(thousand)} Thousand `;
  if (n) words += three(n);
  return words.trim();
}

/** "Indian Rupees Twenty Three Thousand … Only" (with paise if any). */
function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let out = `Indian Rupees ${numToWordsIndian(rupees)}`;
  if (paise > 0) out += ` and ${numToWordsIndian(paise)} Paise`;
  return `${out} Only`;
}

/**
 * Whether a recorded payment has cleared the bank. Cash and electronic transfers
 * (upi/neft) settle at once; a cheque clears after ~3 days, so a very recent
 * cheque still shows as Pending. (The backend has no clearing field to store this.)
 */
function paymentCleared(mode: string | null, date: string | null): boolean {
  if ((mode ?? "").toLowerCase() !== "cheque") return true;
  return date ? daysOverdue(date) >= 3 : false;
}

/**
 * SAC (Services Accounting Code) shown on each service line. The backend stores no
 * per-item SAC, so we use Verve's standard advisory-services code. Change here if a
 * line needs a different code, or wire it to a real field once one exists.
 */
const DEFAULT_SAC = "998311"; // Management consulting & advisory services

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  open: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  partial: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  paid: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
  overdue: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function InvoiceViewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // Print / Export dropdown
  const [showTaxBreakup, setShowTaxBreakup] = useState(false); // GST breakup expander
  const [waCopied, setWaCopied] = useState(false); // "message copied" toast for WhatsApp

  useEffect(() => {
    if (!supabase || !id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);

      // 1) The invoice itself.
      const invRes = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (invRes.error) {
        setError(invRes.error.message);
        setLoading(false);
        return;
      }
      if (!invRes.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const inv = invRes.data as Invoice;
      setInvoice(inv);

      // 2) Everything hanging off it, in parallel (including the chart of
      // accounts, for the GL impact preview).
      const [custRes, coRes, itemRes, allocRes, glRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", inv.customer_id).maybeSingle(),
        supabase.from("company").select("*").limit(1).maybeSingle(),
        supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
        supabase
          .from("receipt_allocations")
          .select("id, amount, receipts ( receipt_no, receipt_date, mode, reference )")
          .eq("invoice_id", inv.id),
        supabase.from("gl_accounts").select("*"),
      ]);
      if (cancelled) return;

      const firstErr = custRes.error || coRes.error || itemRes.error || allocRes.error || glRes.error;
      if (firstErr) setError(firstErr.message);

      setCustomer((custRes.data as Customer) ?? null);
      setCompany((coRes.data as Company) ?? null);
      setItems((itemRes.data as InvoiceItem[]) ?? []);
      setGlAccounts(glRes.data ?? []);

      const allocs = (allocRes.data as unknown as AllocationRow[]) ?? [];
      setPayments(
        allocs
          .map((a) => ({
            id: a.id,
            amount: num(a.amount),
            receipt_no: a.receipts?.receipt_no ?? null,
            receipt_date: a.receipts?.receipt_date ?? null,
            mode: a.receipts?.mode ?? null,
            reference: a.receipts?.reference ?? null,
          }))
          .sort((x, y) => (x.receipt_date ?? "").localeCompare(y.receipt_date ?? "")),
      );

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Give this page its own document title so the browser's print header shows the
  // invoice number (e.g. "Invoice INV-0007") instead of the app-wide "Verve ERP —
  // AR Manager". Restored when you leave the page. (To drop the header line
  // entirely, untick "Headers and footers" in the browser's print dialog.)
  useEffect(() => {
    if (!invoice) return;
    const previous = document.title;
    document.title = `Invoice ${invoice.invoice_no}`;
    return () => {
      document.title = previous;
    };
  }, [invoice]);

  // Warm the PDF module up front so the WhatsApp share stays inside the click gesture.
  useEffect(() => {
    import("@/lib/invoicePdf").catch(() => {});
  }, []);

  const paid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const total = num(invoice?.total);
  const outstanding = Math.max(0, total - paid);
  const collectedPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const overdueDays = invoice ? daysOverdue(invoice.due_date) : 0;
  const isOverdue = outstanding > 0.005 && overdueDays > 0;
  const settled = outstanding <= 0.005;
  // How long the money has been owed: days since the invoice date (0 once settled).
  const daysOutstanding = invoice && !settled ? Math.max(0, daysOverdue(invoice.invoice_date)) : 0;

  if (!supabase) return <NotConfigured />;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-16 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
        Loading invoice…
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <PageHeader title="Invoice not found" subtitle="We couldn't find an invoice with that link." />
        <Link href="/invoices" className="text-sm font-medium text-brand hover:underline">
          ← Back to Sales Invoices
        </Link>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Something went wrong loading this invoice."}
      </div>
    );
  }

  // `invoice` is non-null past the guards above; capture it so the closures below
  // (WhatsApp / CSV) keep the non-null narrowing.
  const inv = invoice;
  const taxPct = taxPercent(num(inv.subtotal), num(inv.tax_amount));
  const subtotalVal = num(inv.subtotal);
  const taxTotal = num(inv.tax_amount);

  // Supplier (Verve) is in Maharashtra (GSTIN starts 27). A Maharashtra customer is
  // intra-state → CGST + SGST (half each); anyone else is inter-state → IGST.
  const isMaharashtra =
    (customer?.gstin ?? "").trim().startsWith("27") ||
    (customer?.address ?? "").toLowerCase().includes("maharashtra");
  const halfPct = (() => {
    const h = Number(taxPct) / 2;
    return Number.isInteger(h) ? String(h) : h.toFixed(2);
  })();
  const taxLines = isMaharashtra
    ? [
        { label: `CGST @ ${halfPct}%`, amount: taxTotal / 2 },
        { label: `SGST @ ${halfPct}%`, amount: taxTotal / 2 },
      ]
    : [{ label: `IGST @ ${taxPct}%`, amount: taxTotal }];

  // Debit/credit preview for GL Master — reuses the same intra/inter-state
  // split as the printed tax breakup above, just reshaped for invoiceGlImpact.
  const glImpact = invoiceGlImpact(glAccounts, {
    subtotal: subtotalVal,
    gst: isMaharashtra
      ? { intraState: true, customerState: "Maharashtra", cgst: taxTotal / 2, sgst: taxTotal / 2, igst: 0 }
      : { intraState: false, customerState: customer?.address ?? null, cgst: 0, sgst: 0, igst: taxTotal },
  });

  /**
   * Personalised plain-text invoice message for WhatsApp — every value is pulled
   * from this invoice. The full tax breakup rides along in the attached PDF, so the
   * message itself stays short. (WhatsApp drops shared text when a file is attached,
   * so sendWhatsApp() also copies this to the clipboard to paste in one keystroke.)
   */
  function invoiceAsText(): string {
    const co = company?.name ?? "Verve Advisory Pvt Ltd";
    const email = company?.email ?? "accounts@verveadvisory.com";
    const contact = customer?.contact_person?.trim();
    const greetName = contact || customer?.name?.trim() || "Sir/Madam";
    const greeting = contact ? `Hello ${greetName} ji,` : `Hello ${greetName},`;

    const L: string[] = [];
    L.push(`*TAX INVOICE — ${inv.invoice_no}*`);
    L.push("");
    L.push(greeting);
    L.push("");
    L.push(`Please find attached the tax invoice PDF for professional advisory services provided by ${co}.`);
    L.push("");
    L.push(`*Invoice Total:* ${formatMoney(total)}`);
    L.push(`*Amount Received:* ${formatMoney(paid)}`);
    L.push(`*Balance Due:* ${formatMoney(outstanding)}`);
    L.push(`*Due Date:* ${fmtDate(inv.due_date)}`);
    L.push("");
    if (outstanding > 0.005) {
      L.push(`Kindly process the pending balance by the due date and mention *${inv.invoice_no}* in the payment reference.`);
    } else {
      L.push(`This invoice has been fully settled — thank you for your payment.`);
    }
    L.push("");
    L.push(`For any billing query, please contact ${email}`);
    L.push("");
    L.push("Thank you,");
    L.push(co);
    return L.join("\n");
  }

  async function sendWhatsApp() {
    const text = invoiceAsText();

    // WhatsApp ignores the shared text when a file is attached, so copy the message
    // to the clipboard first (within the click gesture) — the user pastes it with
    // one keystroke after picking the chat. Show a hint that it's ready.
    try {
      await navigator.clipboard.writeText(text);
      setWaCopied(true);
      window.setTimeout(() => setWaCopied(false), 9000);
    } catch {
      /* clipboard blocked — the text still goes via the wa.me fallback below */
    }

    // Build the invoice PDF (jsPDF loaded on demand).
    let doc: import("jspdf").jsPDF | null = null;
    try {
      const { buildInvoicePdf } = await import("@/lib/invoicePdf");
      doc = buildInvoicePdf({
        invoiceNo: inv.invoice_no,
        status: inv.status,
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        company,
        customer,
        items: items.map((it) => ({
          description: it.description,
          sac: DEFAULT_SAC,
          qty: num(it.qty),
          rate: num(it.rate),
          amount: num(it.amount),
        })),
        subtotal: subtotalVal,
        taxLines,
        total,
        paid,
        outstanding,
        amountInWords: amountInWords(total),
      });
    } catch {
      doc = null;
    }

    // Preferred: share the PDF as a real attachment via the device share sheet —
    // pick WhatsApp there and the invoice PDF goes along with the message.
    if (doc) {
      const file = new File([doc.output("blob")], `Invoice ${inv.invoice_no}.pdf`, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (data?: { files?: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], text, title: `Invoice ${inv.invoice_no}` });
          return; // shared with the PDF attached
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return; // user cancelled the share
          // any other failure → fall through to the download + link fallback
        }
      }
      // Fallback: download the PDF so it can be attached manually…
      doc.save(`Invoice ${inv.invoice_no}.pdf`);
    }

    // …and open WhatsApp with the prefilled message.
    let phone = (customer?.phone ?? "").replace(/\D/g, "");
    if (phone.length === 10) phone = `91${phone}`; // assume India if no country code
    const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
    window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank");
  }

  /** Download the invoice (header, line items with SAC, tax breakup, totals) as CSV. */
  function downloadCsv() {
    const cell = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: (string | number)[][] = [];
    rows.push(["Invoice No", inv.invoice_no]);
    rows.push(["Invoice Date", inv.invoice_date]);
    rows.push(["Due Date", inv.due_date]);
    rows.push(["Bill To", customer?.name ?? ""]);
    rows.push(["Status", inv.status]);
    rows.push([]);
    rows.push(["#", "Description", "SAC", "Qty", "Rate", "Amount"]);
    items.forEach((it, i) => rows.push([i + 1, it.description, DEFAULT_SAC, num(it.qty), num(it.rate), num(it.amount)]));
    rows.push([]);
    rows.push(["Subtotal", subtotalVal]);
    taxLines.forEach((t) => rows.push([t.label, t.amount]));
    rows.push(["Total", total]);
    rows.push(["Amount Received", paid]);
    rows.push(["Balance Due", outstanding]);
    const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inv.invoice_no}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* "Message copied" toast — WhatsApp can't auto-fill text alongside a file. */}
      {waCopied && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg print:hidden dark:bg-slate-700">
          <span className="font-semibold">Message copied ✓</span> — after choosing the chat, paste it in the message box with{" "}
          <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>+
          <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs">V</kbd>. The PDF is already attached.
        </div>
      )}

      {/* Action bar — never printed. */}
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Invoice {invoice.invoice_no}
          </h2>
          {customer && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Billed to {customer.name}</p>}
        </div>
        <div className="flex flex-none items-center gap-2">
          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ← Back
          </Link>
          <button
            onClick={sendWhatsApp}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.14c-.25.69-1.45 1.32-1.99 1.4-.51.08-1.15.11-1.86-.12-.43-.14-.98-.32-1.69-.62-2.98-1.29-4.92-4.29-5.07-4.49-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.59-.37.79-.37.2 0 .39 0 .56.01.18.01.42-.07.66.5.25.59.84 2.03.91 2.18.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12.99 2.06 1.3 2.36 1.45.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.39-.25.66-.15.27.1 1.72.81 2.01.96.3.15.5.22.56.35.06.12.06.72-.19 1.41z"/>
            </svg>
            WhatsApp
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print / Export
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      window.print();
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      downloadCsv();
                    }}
                    className="block w-full border-t border-slate-100 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Download as CSV
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      {/* Money summary — compact quick glance on screen, hidden on the printed invoice. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Amount</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{formatMoney(total)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount Received</p>
          <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(paid)}</p>
        </div>
        <div
          className={`rounded-lg border p-3.5 ${
            settled
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
              : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">Balance Due</p>
          <p className={`mt-1 text-xl font-bold ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
            {formatMoney(outstanding)}
          </p>
        </div>
        <div
          className={`rounded-lg border p-3.5 ${
            isOverdue
              ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Days Outstanding</p>
          <p className={`mt-1 text-xl font-bold ${isOverdue ? "text-red-700 dark:text-red-300" : "text-slate-900 dark:text-white"}`}>
            {settled ? "—" : `${daysOutstanding} day${daysOutstanding === 1 ? "" : "s"}`}
          </p>
          {isOverdue ? (
            <p className="mt-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
              {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
            </p>
          ) : settled ? (
            <p className="mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Fully paid</p>
          ) : null}
        </div>
      </div>

      {/* ============ THE TAX INVOICE DOCUMENT ============ */}
      <div
        id="invoice-doc"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 print:rounded-none print:border-0 print:shadow-none"
      >
        {/* Letterhead */}
        <div className="flex flex-col gap-6 border-b-4 border-[#2b4c9c] px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div>
            <VerveLogo className="text-[24px]" />
            <div className="mt-3 space-y-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {company?.address && <p className="whitespace-pre-line">{company.address}</p>}
              {company?.gstin && <p>GSTIN: {company.gstin}</p>}
              {(company?.email || company?.phone) && (
                <p>{[company?.email, company?.phone].filter(Boolean).join("  ·  ")}</p>
              )}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-bold uppercase tracking-wide text-slate-900 dark:text-white">Tax Invoice</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{invoice.invoice_no}</p>
            <div className="mt-2 sm:flex sm:justify-end">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>

        {/* Bill To + invoice meta */}
        <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2b4c9c]">Bill To</p>
            <p className="mt-1.5 text-base font-semibold text-slate-900 dark:text-white">{customer?.name ?? "—"}</p>
            <div className="mt-1 space-y-0.5 text-sm text-slate-500 dark:text-slate-400">
              {customer?.code && <p>Customer Code: {customer.code}</p>}
              {customer?.address && <p className="whitespace-pre-line">{customer.address}</p>}
              {customer?.gstin && <p>GSTIN: {customer.gstin}</p>}
              {customer?.contact_person && <p>Attn: {customer.contact_person}</p>}
              {customer?.email && <p>{customer.email}</p>}
              {customer?.phone && <p>{customer.phone}</p>}
            </div>
          </div>
          <div className="sm:justify-self-end">
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50 print:bg-slate-50">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-8">
                  <dt className="text-slate-500 dark:text-slate-400">Invoice Date</dt>
                  <dd className="font-medium text-slate-900 dark:text-white">{fmtDate(invoice.invoice_date)}</dd>
                </div>
                <div className="flex justify-between gap-8">
                  <dt className="text-slate-500 dark:text-slate-400">Due Date</dt>
                  <dd className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
                    {fmtDate(invoice.due_date)}
                  </dd>
                </div>
                <div className="flex justify-between gap-8">
                  <dt className="text-slate-500 dark:text-slate-400">Days Overdue</dt>
                  <dd className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
                    {settled
                      ? "—"
                      : overdueDays > 0
                        ? `${overdueDays} day${overdueDays === 1 ? "" : "s"}`
                        : "Not overdue"}
                  </dd>
                </div>
                <div className="flex justify-between gap-8 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <dt className="text-slate-500 dark:text-slate-400">Balance Due</dt>
                  <dd className={`font-bold ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                    {formatMoney(outstanding)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="px-6 sm:px-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#2b4c9c] text-left text-white">
                  <th className="rounded-l-lg px-3 py-2.5 font-semibold w-10 text-center">#</th>
                  <th className="px-3 py-2.5 font-semibold">Description of Services</th>
                  <th className="px-3 py-2.5 text-center font-semibold w-24">SAC</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-16">Qty</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">Rate</th>
                  <th className="rounded-r-lg px-3 py-2.5 text-right font-semibold w-36">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No line items on this invoice.
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={it.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                      <td className="px-3 py-3 text-center font-medium tabular-nums text-slate-400">{i + 1}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{it.description}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {num(it.qty)} × {formatMoney(num(it.rate))} per unit
                        </p>
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{DEFAULT_SAC}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{num(it.qty)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatMoney(num(it.rate))}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(num(it.amount))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end px-6 pt-5 sm:px-8">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
              <dd className="tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(num(invoice.subtotal))}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <span>
                  GST <span className="text-slate-400">@ {taxPct}%</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowTaxBreakup((v) => !v)}
                  aria-label={showTaxBreakup ? "Hide tax breakup" : "Show tax breakup"}
                  title={showTaxBreakup ? "Hide tax breakup" : "Show CGST/SGST/IGST breakup"}
                  className="grid h-4 w-4 place-items-center rounded-full border border-slate-300 text-[11px] font-bold leading-none text-slate-500 transition hover:border-brand hover:text-brand dark:border-slate-600 print:hidden"
                >
                  {showTaxBreakup ? "−" : "+"}
                </button>
              </dt>
              <dd className="tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(taxTotal)}</dd>
            </div>
            {/* Tax breakup — collapsed on screen until "+"; always shown when printing. */}
            {taxLines.map((t) => (
              <div
                key={t.label}
                className={`justify-between pl-3 text-xs text-slate-500 dark:text-slate-400 ${
                  showTaxBreakup ? "flex" : "hidden print:flex"
                }`}
              >
                <dt>{t.label}</dt>
                <dd className="tabular-nums">{formatMoney(t.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
              <dt className="font-semibold text-slate-900 dark:text-white">Total</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatMoney(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Amount Received</dt>
              <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">− {formatMoney(paid)}</dd>
            </div>
            <div
              className={`-mx-3 flex justify-between rounded-lg px-3 py-2 ${
                settled ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-amber-50 dark:bg-amber-900/20"
              }`}
            >
              <dt className="font-bold text-slate-900 dark:text-white">Balance Due</dt>
              <dd className={`font-bold tabular-nums ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                {formatMoney(outstanding)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Amount in words */}
        <div className="mt-5 border-t border-slate-100 px-6 py-4 dark:border-slate-800 sm:px-8">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Amount in words: </span>
            {amountInWords(total)}
          </p>
        </div>

        {/* Collection progress */}
        <div className="px-6 pb-2 sm:px-8">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              {settled ? "Payment complete" : `${collectedPct}% collected`}
            </span>
            <span className="text-slate-400">
              {formatMoney(paid)} received out of {formatMoney(total)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${settled ? "bg-emerald-500" : "bg-[#2b4c9c]"}`}
              style={{ width: `${Math.max(collectedPct, paid > 0 ? 3 : 0)}%` }}
            />
          </div>
        </div>

        {/* Notes + terms */}
        <div className="mt-4 grid grid-cols-1 gap-6 border-t border-slate-100 px-6 py-5 dark:border-slate-800 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
            {invoice.notes?.trim() && (
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {invoice.notes}
              </p>
            )}
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Thank you for choosing Verve Advisory. For any billing query, contact accounts@verveadvisory.com.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <li>Payment due within 30 days.</li>
              <li>Late payment may attract interest as per agreed engagement terms.</li>
            </ul>
          </div>
        </div>

        {/* Document footer */}
        <div className="border-t border-slate-100 px-6 py-3 text-center dark:border-slate-800 sm:px-8">
          <p className="text-xs text-slate-400">
            For {company?.name ?? "Verve Advisory"} · This is a computer-generated invoice.
          </p>
        </div>
      </div>

      {/* GL Impact Review (internal accounting view — screen only) */}
      <div className="mt-6 print:hidden">
        <GlImpactReview lines={glImpact} />
      </div>

      {/* Payments knocked off against this invoice (screen only) */}
      <div className="mt-6 print:hidden">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Payments received against this invoice
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-center dark:border-slate-800 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Receipt No.</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Mode</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Reference</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Amount</th>
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No payments received yet — the full amount is outstanding.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 text-center last:border-0 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{p.receipt_no ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{fmtDate(p.receipt_date)}</td>
                    <td className="px-4 py-3 uppercase text-slate-600 dark:text-slate-400">{p.mode ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.reference ?? "—"}</td>
                    <td className="px-4 py-3 font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatMoney(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {paymentCleared(p.mode, p.receipt_date) ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          Cleared
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collection follow-up log (screen only) */}
      <CollectionFollowups invoiceId={invoice.id} />
    </div>
  );
}
