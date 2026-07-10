import type { Company, Customer, Invoice, Receipt } from "./types";

/*
  Shared "account statement" logic:
  - buildStatement(): the ledger (invoices as debits, receipts as credits, running
    balance) plus the holistic summary. Used by the Customer Statement screen AND
    the PDF download, so both always agree.
  - downloadStatementPdf(): draws a real .pdf file (jsPDF, loaded on demand) and
    saves it as "Account Statement — <customer>.pdf".

  Note: jsPDF's built-in fonts can't draw the ₹ glyph, so the PDF prints "Rs".
*/

export interface StatementLedgerRow {
  id: string;
  date: string; // ISO date, "" for the opening row
  particulars: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export interface StatementSummary {
  totalInvoiced: number;
  totalReceived: number;
  closing: number;
  lastReceipt: Receipt | null;
  overdueAmount: number;
  oldestDays: number;
  partPaid: number;
}

export interface Statement {
  ledger: StatementLedgerRow[];
  summary: StatementSummary;
}

export function buildStatement(
  customer: Customer,
  invoices: Invoice[],
  receipts: Receipt[],
  allocations: { invoice_id: string; amount: number }[]
): Statement {
  type Entry = StatementLedgerRow & { kind: 0 | 1 };
  const entries: Entry[] = [
    ...invoices.map<Entry>((i) => ({
      id: `inv-${i.id}`,
      date: i.invoice_date,
      kind: 0, // invoices before receipts on the same day
      particulars: `Invoice ${i.invoice_no}`,
      debit: Number(i.total),
      credit: null,
      balance: 0,
    })),
    ...receipts.map<Entry>((r) => ({
      id: `rcpt-${r.id}`,
      date: r.receipt_date,
      kind: 1,
      particulars: `Receipt ${r.receipt_no} (${r.mode.toUpperCase()}${r.reference ? ` · ${r.reference}` : ""})`,
      debit: null,
      credit: Number(r.amount),
      balance: 0,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind - b.kind));

  let balance = Number(customer.opening_balance) || 0;
  const ledger: StatementLedgerRow[] = [
    { id: "opening", date: "", particulars: "Opening balance", debit: null, credit: null, balance },
  ];
  for (const e of entries) {
    balance += (e.debit ?? 0) - (e.credit ?? 0);
    ledger.push({ ...e, balance });
  }

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0);
  const totalReceived = receipts.reduce((s, r) => s + Number(r.amount), 0);
  const closing = (Number(customer.opening_balance) || 0) + totalInvoiced - totalReceived;
  const lastReceipt = receipts.length
    ? receipts.reduce((a, b) => (a.receipt_date > b.receipt_date ? a : b))
    : null;

  const paidByInvoice = new Map<string, number>();
  for (const a of allocations) {
    paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let overdueAmount = 0;
  let oldestDays = 0;
  let partPaid = 0;
  for (const i of invoices) {
    const alloc = paidByInvoice.get(i.id) ?? 0;
    const out = Number(i.total) - alloc;
    if (alloc > 0 && out > 0) partPaid++;
    if (i.status === "paid" || out <= 0) continue;
    const due = new Date(`${i.due_date}T00:00:00`);
    if (due < today) {
      overdueAmount += out;
      oldestDays = Math.max(oldestDays, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
    }
  }

  return {
    ledger,
    summary: { totalInvoiced, totalReceived, closing, lastReceipt, overdueAmount, oldestDays, partPaid },
  };
}

const numIN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dmed = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
const rs = (n: number) => `Rs ${numIN.format(n)}`;

const BRAND: [number, number, number] = [13, 148, 136]; // teal-600, the app's brand colour

/** Generate and save the real .pdf file for one customer's statement. */
export async function downloadStatementPdf(
  company: Company | null,
  customer: Customer,
  stmt: Statement
): Promise<void> {
  // Loaded on demand so screens don't pay for jsPDF until someone downloads.
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  // Company header
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
  doc.text(company?.name ?? "Account Statement", M, 50);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  if (company?.address) doc.text(company.address, M, 64);
  const companyLine = [company?.gstin ? `GSTIN: ${company.gstin}` : null, company?.email, company?.phone]
    .filter(Boolean)
    .join("  ·  ");
  if (companyLine) doc.text(companyLine, M, 76);

  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...BRAND);
  doc.text("ACCOUNT STATEMENT", W - M, 50, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  doc.text(`As at ${dmed.format(new Date())}`, W - M, 64, { align: "right" });

  doc.setDrawColor(226, 232, 240).line(M, 88, W - M, 88);

  // Customer block
  doc.setFontSize(8).setTextColor(150).text("STATEMENT FOR", M, 106);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  doc.text(`${customer.name} (${customer.code})`, M, 120);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  const customerLine = [customer.address, customer.email ?? "no email on file", customer.phone]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(customerLine, M, 133);

  // Summary — the holistic picture
  const s = stmt.summary;
  autoTable(doc, {
    startY: 148,
    theme: "grid",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 6, textColor: 30 },
    headStyles: { fillColor: [241, 245, 249], textColor: 100, fontStyle: "bold" },
    head: [["Total invoiced", "Total paid", "Outstanding", "Last payment", "Overdue now", "Part-paid invoices"]],
    body: [
      [
        rs(s.totalInvoiced),
        rs(s.totalReceived),
        rs(s.closing),
        s.lastReceipt
          ? `${rs(Number(s.lastReceipt.amount))}\n${dmed.format(new Date(s.lastReceipt.receipt_date))} · ${s.lastReceipt.mode.toUpperCase()}`
          : "no payments yet",
        s.overdueAmount > 0 ? `${rs(s.overdueAmount)}\noldest ${s.oldestDays} days` : "nothing overdue",
        String(s.partPaid),
      ],
    ],
  });

  // Ledger
  const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(doc, {
    startY: afterSummary + 16,
    theme: "striped",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: 30 },
    headStyles: { fillColor: BRAND, textColor: 255 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right", fontStyle: "bold" },
    },
    head: [["Date", "Particulars", "Debit", "Credit", "Balance"]],
    body: stmt.ledger.map((r) => [
      r.date ? dmed.format(new Date(r.date)) : "",
      r.particulars,
      r.debit !== null ? rs(r.debit) : "",
      r.credit !== null ? rs(r.credit) : "",
      rs(r.balance),
    ]),
    foot: [["", "Closing balance — amount still owed", "", "", rs(s.closing)]],
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
  });

  const afterLedger = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(150);
  doc.text(
    `Computer-generated statement · ${company?.name ?? ""} · ${dmed.format(new Date())}`,
    W / 2,
    Math.min(afterLedger + 22, doc.internal.pageSize.getHeight() - 24),
    { align: "center" }
  );

  doc.save(`Account Statement — ${customer.name}.pdf`);
}
