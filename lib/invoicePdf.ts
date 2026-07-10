import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Company, Customer } from "./types";
import { logoWidthFor, type LoadedLogo } from "./logo";

/*
  Builds a real .pdf of one sales invoice (jsPDF + autotable), matching the
  on-screen Tax Invoice: Verve letterhead, Bill To, line items with SAC, the
  CGST/SGST or IGST breakup, totals, amount in words, notes and terms.

  Note: jsPDF's built-in fonts can't draw the ₹ glyph, so amounts print as "Rs"
  (same convention the Customer Statement PDF uses).

  Returned as a jsPDF doc so the caller can either .save() it (download) or
  .output("blob") it (to attach/share via the Web Share API).
*/

export interface InvoicePdfInput {
  invoiceNo: string;
  status: string;
  invoiceDate: string; // ISO
  dueDate: string; // ISO
  company: Company | null;
  customer: Customer | null;
  items: { description: string; sac: string; qty: number; rate: number; amount: number }[];
  subtotal: number;
  taxLines: { label: string; amount: number }[];
  total: number;
  paid: number;
  outstanding: number;
  amountInWords: string;
  /** Official letterhead logo. Omit (or pass null) to draw the text wordmark. */
  logo?: LoadedLogo | null;
}

const numIN2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmed = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const rs = (n: number) => `Rs ${numIN2.format(Number.isFinite(n) ? n : 0)}`;
const fdate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dmed.format(d);
};
const VERVE: [number, number, number] = [43, 76, 156]; // #2b4c9c, the letterhead blue
const finalY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

/** Draw the invoice and return the jsPDF document (not yet saved). */
export function buildInvoicePdf(d: InvoicePdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;

  // ---- Letterhead: official logo, or the drawn wordmark if it isn't installed ----
  if (d.logo) {
    const h = 40;
    doc.addImage(d.logo.dataUrl, "PNG", M, 30, logoWidthFor(d.logo, h), h);
  } else {
    doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...VERVE);
    doc.text("verve", M, 54);
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(40);
    doc.text("Advisory", M + 3, 68);
  }

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  let cy = 86;
  if (d.company?.address) {
    doc.text(d.company.address, M, cy);
    cy += 12;
  }
  const cline = [d.company?.gstin ? `GSTIN: ${d.company.gstin}` : null, d.company?.email, d.company?.phone]
    .filter(Boolean)
    .join("  ·  ");
  if (cline) {
    doc.text(cline, M, cy);
    cy += 12;
  }

  // Right side: TAX INVOICE + number + status
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
  doc.text("TAX INVOICE", W - M, 52, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(60);
  doc.text(d.invoiceNo, W - M, 68, { align: "right" });
  doc.setFontSize(9).setTextColor(120);
  doc.text(`Status: ${d.status.toUpperCase()}`, W - M, 82, { align: "right" });

  const rule = Math.max(cy, 92);
  doc.setDrawColor(...VERVE).setLineWidth(2).line(M, rule, W - M, rule);
  doc.setLineWidth(0.5);

  // ---- Bill To (left) + meta (right) ----
  const top = rule + 24;
  doc.setFontSize(8).setTextColor(...VERVE).text("BILL TO", M, top);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  doc.text(d.customer?.name ?? "-", M, top + 15);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  let ly = top + 29;
  (
    [
      d.customer?.code ? `Customer Code: ${d.customer.code}` : null,
      d.customer?.address,
      d.customer?.gstin ? `GSTIN: ${d.customer.gstin}` : null,
      d.customer?.contact_person ? `Attn: ${d.customer.contact_person}` : null,
    ].filter(Boolean) as string[]
  ).forEach((line) => {
    doc.text(line, M, ly);
    ly += 12;
  });

  const mx1 = W - M - 160;
  const mx2 = W - M;
  let my = top;
  (
    [
      ["Invoice Date", fdate(d.invoiceDate)],
      ["Due Date", fdate(d.dueDate)],
      ["Balance Due", rs(d.outstanding)],
    ] as [string, string][]
  ).forEach(([k, v]) => {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110).text(k, mx1, my);
    doc.setFont("helvetica", "bold").setTextColor(20).text(v, mx2, my, { align: "right" });
    my += 15;
  });

  // ---- Line items ----
  autoTable(doc, {
    startY: Math.max(ly, my) + 12,
    theme: "grid",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: 30 },
    headStyles: { fillColor: VERVE, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 24 },
      2: { halign: "center", cellWidth: 62 },
      3: { halign: "right", cellWidth: 42 },
      4: { halign: "right", cellWidth: 80 },
      5: { halign: "right", cellWidth: 92 },
    },
    head: [["#", "Description of Services", "SAC", "Qty", "Rate", "Amount"]],
    body: d.items.map((it, i) => [
      String(i + 1),
      it.description,
      it.sac,
      String(it.qty),
      rs(it.rate),
      rs(it.amount),
    ]),
  });

  // ---- Totals (right aligned) ----
  let y = finalY(doc) + 18;
  const lx = W - M - 160;
  const vx = W - M;
  const totals: [string, string, boolean?][] = [
    ["Subtotal", rs(d.subtotal)],
    ...d.taxLines.map((t) => [t.label, rs(t.amount)] as [string, string]),
    ["Total", rs(d.total), true],
    ["Amount Received", `- ${rs(d.paid)}`],
    ["Balance Due", rs(d.outstanding), true],
  ];
  doc.setFontSize(9);
  totals.forEach(([k, v, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setTextColor(bold ? 20 : 110);
    doc.text(k, lx, y);
    doc.text(v, vx, y, { align: "right" });
    y += 15;
  });

  // ---- Amount in words ----
  y += 8;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(`Amount in words: ${d.amountInWords}`, M, y, { maxWidth: W - 2 * M });
  y += 24;

  // ---- Notes + Terms ----
  const colR = W / 2 + 10;
  doc.setFontSize(8).setTextColor(150).text("NOTES", M, y);
  doc.setFontSize(8).setTextColor(150).text("TERMS", colR, y);
  doc.setFontSize(9).setTextColor(90);
  doc.text(
    doc.splitTextToSize(
      "Thank you for choosing Verve Advisory. For any billing query, contact accounts@verveadvisory.com.",
      W / 2 - M - 10,
    ),
    M,
    y + 13,
  );
  doc.text(
    ["- Payment due within 30 days.", "- Late payment may attract interest as per agreed engagement terms."],
    colR,
    y + 13,
  );

  // ---- Footer ----
  doc.setFontSize(8).setTextColor(150);
  doc.text(
    `For ${d.company?.name ?? "Verve Advisory"} · This is a computer-generated invoice.`,
    W / 2,
    H - 28,
    { align: "center" },
  );

  return doc;
}
