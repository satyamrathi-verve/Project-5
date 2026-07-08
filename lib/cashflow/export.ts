/*
  Cash Flow — export utilities (Excel / CSV / PDF / Print).
  =========================================================
  Reusable across every view. ExcelJS is dynamically imported (code-split) so it
  only loads when the user actually exports .xlsx. PDF/Print reuse the browser's
  own print pipeline (a styled print window), avoiding a heavy PDF dependency
  while still producing a clean, printable/"Save as PDF" document.

  Works on already-computed rows, so it exports exactly what the user sees
  (respecting filters, sort and visible columns).
*/

import { downloadBlob } from "@/lib/import-template";
import { formatMoney } from "@/lib/balances";
import type { CashFlowRow } from "./types";
import { txnTypeLabel, TXN_STATUS_LABEL, type ColumnDef, type ColumnKey } from "./config";
import { formatDate } from "./dates";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BRAND_ARGB = "FF4F46E5";

function cellValue(row: CashFlowRow, key: ColumnKey): string | number {
  switch (key) {
    case "date":
      return formatDate(row.date);
    case "documentNo":
      return row.documentNo;
    case "type":
      return txnTypeLabel(row.type);
    case "description":
      return row.description;
    case "glAccount":
      return row.glAccountCode ? `${row.glAccountCode} · ${row.glAccountName ?? ""}`.trim() : row.glAccountName ?? "";
    case "bankAccount":
      return row.bankAccountName ?? "";
    case "cashIn":
      return row.cashIn || 0;
    case "cashOut":
      return row.cashOut || 0;
    case "runningBalance":
      return row.runningBalance || 0;
    case "status":
      return TXN_STATUS_LABEL[row.status] ?? row.status;
    case "reference":
      return row.reference ?? "";
    case "user":
      return row.user ?? "";
  }
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ExportContext {
  columns: ColumnDef[]; // visible, ordered
  rows: CashFlowRow[];
  title: string;
  subtitle?: string;
  currency: string;
}

/** Build a display string (money for numeric cells) for CSV / print. */
function displayValue(row: CashFlowRow, col: ColumnDef, currency: string): string {
  const v = cellValue(row, col.key);
  if (col.numeric) return formatMoney(Number(v) || 0, currency);
  return String(v);
}

export function exportCsv(ctx: ExportContext, filename: string): void {
  const header = ctx.columns.map((c) => csvEscape(c.label)).join(",");
  const body = ctx.rows
    .map((r) => ctx.columns.map((c) => csvEscape(displayValue(r, c, ctx.currency))).join(","))
    .join("\r\n");
  const blob = new Blob([`${header}\r\n${body}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

export async function exportXlsx(ctx: ExportContext, filename: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Verve ERP";

  const ws = wb.addWorksheet("Cash Flow", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = ctx.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.numeric ? 18 : c.key === "description" ? 34 : 20,
  }));

  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_ARGB } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  for (const r of ctx.rows) {
    const record: Record<string, string | number> = {};
    for (const c of ctx.columns) record[c.key] = cellValue(r, c.key);
    const row = ws.addRow(record);
    for (const c of ctx.columns) {
      if (c.numeric) {
        const cell = row.getCell(c.key);
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

/** Open a styled print window (user chooses Print or Save as PDF). */
export function printReport(ctx: ExportContext): void {
  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) return;
  const thead = ctx.columns.map((c) => `<th class="${c.numeric ? "num" : ""}">${c.label}</th>`).join("");
  const tbody = ctx.rows
    .map(
      (r) =>
        `<tr>${ctx.columns
          .map((c) => `<td class="${c.numeric ? "num" : ""}">${escapeHtml(displayValue(r, c, ctx.currency))}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  win.document.write(`<!doctype html><html><head><title>${escapeHtml(ctx.title)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#0f172a;margin:32px}
      h1{font-size:20px;margin:0 0 4px} .sub{color:#64748b;font-size:13px;margin:0 0 20px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0}
      th{background:#4f46e5;color:#fff;font-weight:600}
      td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
      tr:nth-child(even) td{background:#f8fafc}
      .empty{color:#94a3b8;padding:24px;text-align:center}
      @media print{body{margin:12mm}}
    </style></head><body>
    <h1>${escapeHtml(ctx.title)}</h1>
    ${ctx.subtitle ? `<p class="sub">${escapeHtml(ctx.subtitle)}</p>` : ""}
    <table><thead><tr>${thead}</tr></thead><tbody>${
      tbody || `<tr><td class="empty" colspan="${ctx.columns.length}">No cash movement in this period.</td></tr>`
    }</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Print an arbitrary report body (already-built, trusted HTML) with the same
 * house print styling. Used by the Cash Flow Statement / Bank Summary reports.
 */
export function printHtml(title: string, subtitle: string | undefined, bodyHtml: string): void {
  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#0f172a;margin:32px}
      h1{font-size:20px;margin:0 0 4px} .sub{color:#64748b;font-size:13px;margin:0 0 20px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}
      th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0}
      th{color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
      .section{font-weight:700;background:#f1f5f9}
      .total{font-weight:700;border-top:2px solid #cbd5e1}
      @media print{body{margin:12mm}}
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}
    ${bodyHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`);
  win.document.close();
}

export { escapeHtml };
