/*
  Verve ERP — GL account import template (Excel .xlsx + CSV).
  ==========================================================
  Kept out of the UI so any import screen can reuse it. ExcelJS is dynamically
  imported (code-split) so it only loads when a user downloads / uploads Excel —
  no impact on the main bundle.

  Reality note: the fixed gl_accounts table stores only code, name, type and
  parent_group. Normal Balance is auto-derived from the type, and Status /
  Description have no columns — they are reference-only in the template.
*/

export const TEMPLATE_HEADERS = [
  "Account Code",
  "Account Name",
  "Account Type",
  "Parent Group",
  "Normal Balance",
  "Status",
  "Description",
] as const;

export const TEMPLATE_SAMPLE: string[][] = [
  ["1000", "Cash on Hand", "Asset", "Current Assets", "Debit", "Active", "Cash available in hand"],
  ["1010", "Petty Cash", "Asset", "Current Assets", "Debit", "Active", "Office petty cash"],
  ["2000", "Accounts Payable", "Liability", "Current Liabilities", "Credit", "Active", "Trade payables"],
  ["4000", "Product Sales", "Revenue", "Revenue", "Credit", "Active", "Sales revenue"],
  ["6000", "Rent Expense", "Expense", "Operating Expenses", "Debit", "Active", "Office rent"],
];

export const TEMPLATE_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense", "Other Income", "Other Expense"];
export const TEMPLATE_BALANCES = ["Debit", "Credit"];
export const TEMPLATE_STATUSES = ["Active", "Inactive"];
export const TEMPLATE_GROUPS = [
  "Current Assets",
  "Inventory",
  "Fixed Assets",
  "Accumulated Depreciation",
  "Current Liabilities",
  "Long-Term Liabilities",
  "Equity",
  "Revenue",
  "Other Income",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Other Expenses",
];

const BRAND_ARGB = "FF4F46E5"; // indigo-600
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV version of the template (headers + sample rows). */
export function csvTemplate(): string {
  return [TEMPLATE_HEADERS as readonly string[], ...TEMPLATE_SAMPLE].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Professional .xlsx template: styled Accounts sheet + Instructions sheet. */
export async function xlsxTemplate(): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Verve ERP";
  wb.created = new Date();

  // ---------------- Accounts sheet ----------------
  const ws = wb.addWorksheet("Accounts", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Account Code", key: "code", width: 14 },
    { header: "Account Name", key: "name", width: 30 },
    { header: "Account Type", key: "type", width: 16 },
    { header: "Parent Group", key: "group", width: 24 },
    { header: "Normal Balance", key: "balance", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Description", key: "description", width: 40 },
  ];

  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_ARGB } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });

  TEMPLATE_SAMPLE.forEach((r) => ws.addRow(r));

  // dropdown data-validation for a generous range of rows
  const list = (items: string[]) => [`"${items.join(",")}"`];
  for (let row = 2; row <= 500; row += 1) {
    ws.getCell(`C${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      formulae: list(TEMPLATE_TYPES),
      errorTitle: "Invalid Account Type",
      error: "Choose a value from the list.",
    };
    ws.getCell(`D${row}`).dataValidation = { type: "list", allowBlank: true, formulae: list(TEMPLATE_GROUPS) };
    ws.getCell(`E${row}`).dataValidation = { type: "list", allowBlank: true, formulae: list(TEMPLATE_BALANCES) };
    ws.getCell(`F${row}`).dataValidation = { type: "list", allowBlank: true, formulae: list(TEMPLATE_STATUSES) };
  }

  // ---------------- Instructions sheet ----------------
  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ width: 26 }, { width: 82 }];
  const title = ins.addRow(["Verve ERP — GL Account Import Guide"]);
  title.font = { bold: true, size: 14, color: { argb: BRAND_ARGB } };
  ins.addRow([]);

  const section = (label: string, lines: string[] | string) => {
    const h = ins.addRow([label]);
    h.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
    (Array.isArray(lines) ? lines : [lines]).forEach((l) => {
      const r = ins.addRow(["", l]);
      r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    });
    ins.addRow([]);
  };

  section("Required fields", [
    "Account Code — unique, 3–5 digits (e.g. 1000).",
    "Account Name — the account's display name.",
    "Account Type — one of the accepted types below.",
  ]);
  section("Optional fields", [
    "Parent Group — sub-category (defaults to none).",
    "Normal Balance — informational; auto-derived from Account Type.",
    "Status — Active or Inactive (defaults to Active).",
    "Description — free text (reference only).",
  ]);
  section("Accepted Account Types", TEMPLATE_TYPES.join("   ·   "));
  section("Accepted Parent Groups", TEMPLATE_GROUPS.join("   ·   "));
  section("Debit / Credit rules", [
    "Assets & Expenses are Debit-normal.",
    "Liabilities, Equity & Revenue are Credit-normal.",
    "Normal Balance is derived automatically — you don't need to set it.",
  ]);
  section("Status values", "Active   ·   Inactive");
  section("Import guidelines", [
    "Keep the header row exactly as provided; don't rename columns.",
    "One account per row. Account Codes must be unique.",
    "Code bands: Assets 1000s · Liabilities 2000s · Equity 3000s · Revenue 4000s/8000s · Expenses 5000–7999/9000s.",
    "Only Account Code, Account Name, Account Type and Parent Group are written to the ledger. Normal Balance, Status and Description are reference-only in this build.",
    "Save/upload the file back on the Import dialog to validate every row before importing.",
  ]);
  section("Common validation errors", [
    "Duplicate Account Code — the code already exists.",
    "Blank Account Name.",
    "Unrecognised Account Type — use a value from the list.",
    "Code outside the type's band — tick 'manual override' in the form to allow it.",
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/**
 * Read an uploaded file into CSV text so the SAME parser/validator handles both
 * formats. .xlsx is parsed with ExcelJS (Accounts sheet); .csv is read as text.
 */
export async function fileToCsvText(file: File): Promise<string> {
  if (/\.xlsx$/i.test(file.name) || file.type === XLSX_MIME) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet("Accounts") ?? wb.worksheets[0];
    if (!ws) return "";
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(vals.map((v) => (v == null ? "" : String(v))));
    });
    return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  }
  return file.text();
}
