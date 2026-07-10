/*
  Document Management System — configuration (client-safe, no fs).
  ================================================================
  Central registry of modules, upload limits, allowed file types, tag presets and
  small helpers. Shared by the API routes, the client wrapper and the UI so limits
  and types are defined exactly once.
*/

// ── Modules ───────────────────────────────────────────────────────────────────
// Every ERP module that can own attachments. Adding a module is one line here;
// the reusable <AttachmentManager module="…" /> then works with no other change.
export const MODULES: Record<string, { label: string }> = {
  gl: { label: "GL Master" },
  cashflow: { label: "Cash Flow" },
  customers: { label: "Customers" },
  vendors: { label: "Vendors" },
  salesinvoices: { label: "Sales Invoices" },
  receipts: { label: "Receipts" },
  vendorbills: { label: "Vendor Bills" },
  journalentries: { label: "Journal Entries" },
  bankaccounts: { label: "Bank Accounts" },
  fixedassets: { label: "Fixed Assets" },
  employees: { label: "Employees" },
};

export type ModuleKey = keyof typeof MODULES | (string & {});

export function moduleLabel(key: string): string {
  return MODULES[key]?.label ?? key;
}
export function isKnownModule(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODULES, key);
}

// ── Upload limits + allowed types ─────────────────────────────────────────────
export const MAX_FILE_MB = 25;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** Allowed extensions (lower-case, no dot). Configurable in one place. */
export const ALLOWED_EXT = [
  "pdf",
  "xls",
  "xlsx",
  "doc",
  "docx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "csv",
  "txt",
  "zip",
] as const;

export const ACCEPTED_LABELS = ["PDF", "Excel", "Word", "Images", "CSV", "TXT", "ZIP"];

export const EXT_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

export const TAG_PRESETS = ["GST", "Invoice", "Audit", "Bank", "Vendor", "Agreement", "Supporting Document"];

// ── Category / preview helpers ────────────────────────────────────────────────
export type FileCategory = "pdf" | "image" | "excel" | "word" | "csv" | "text" | "archive" | "other";

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(ext: string): FileCategory {
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["xls", "xlsx"].includes(ext)) return "excel";
  if (["doc", "docx"].includes(ext)) return "word";
  if (ext === "csv") return "csv";
  if (ext === "txt") return "text";
  if (ext === "zip") return "archive";
  return "other";
}

export type PreviewKind = "pdf" | "image" | "text" | "none";
export function previewKindOf(ext: string): PreviewKind {
  const cat = categoryOf(ext);
  if (cat === "pdf") return "pdf";
  if (cat === "image") return "image";
  if (cat === "csv" || cat === "text") return "text";
  return "none";
}

export const CATEGORY_BADGE: Record<FileCategory, string> = {
  pdf: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  image: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  excel: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  word: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
  csv: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400",
  text: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
  archive: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  other: "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400",
};

export function isAllowedExt(ext: string): boolean {
  return (ALLOWED_EXT as readonly string[]).includes(ext);
}

export function contentTypeFor(ext: string): string {
  return EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/** Validate a file against the configured limits. */
export function validateUpload(name: string, size: number): { ok: boolean; error?: string } {
  const ext = extOf(name);
  if (!isAllowedExt(ext)) return { ok: false, error: `“.${ext || "?"}” files are not supported.` };
  if (size > MAX_FILE_BYTES) return { ok: false, error: `File exceeds the ${MAX_FILE_MB} MB limit.` };
  return { ok: true };
}
