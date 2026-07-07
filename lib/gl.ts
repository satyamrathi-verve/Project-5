/*
  GL Master — business logic (pure, framework-free, unit-testable).

  Purpose
  -------
  Everything the Chart of Accounts screen needs that is NOT React or Supabase:
  account-type metadata, the automatic code-numbering scheme, validation rules,
  CSV import/export, and hierarchy grouping. Kept separate from the UI so the
  rules live in one place, are easy to reason about, and could be reused by any
  future GL-aware module (Journal Entries, Reports…) without dragging UI along.

  Reality note
  ------------
  The backend table `gl_accounts` is fixed (id, code, name, type, parent_group)
  and `type` is one of exactly four values. Classic ERP charts separate Equity and
  split expenses/income into more bands than four types allow, so the numbering
  bands below MAP those conventions onto the four available types (e.g. Equity codes
  live under `liability`, Other Income under `income`, COGS/Other Expense under
  `expense`). This keeps codes conventional without inventing columns we can't store.
*/

import type { GLAccount } from "./types";

export type AccountType = GLAccount["type"];

export interface AccountTypeMeta {
  type: AccountType;
  label: string; // singular, e.g. "Asset"
  plural: string; // e.g. "Assets"
  /** Primary band used when auto-suggesting the next code for a NEW account. */
  primaryBand: [number, number];
  /** All code ranges considered valid for this type (superset of primaryBand). */
  ranges: Array<[number, number]>;
  /** Tailwind classes for the type badge (light + dark). */
  badge: string;
  /** Tailwind gradient classes (from/to) for the summary card. */
  cardGradient: string;
  /** Solid accent colour class (e.g. bg-emerald-500) for dots/bars. */
  dot: string;
  /** Accounting normal balance — surfaced in the account detail view. */
  normalBalance: "debit" | "credit";
  /** Suggested sub-groups (parent_group values) offered in the form. */
  groups: string[];
}

export const ACCOUNT_TYPES: AccountTypeMeta[] = [
  {
    type: "asset",
    label: "Asset",
    plural: "Assets",
    primaryBand: [1000, 1999],
    ranges: [[1000, 1999]],
    badge:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25",
    cardGradient: "from-emerald-500 to-green-600",
    dot: "bg-emerald-500",
    normalBalance: "debit",
    groups: ["Current Assets", "Fixed Assets", "Other Assets"],
  },
  {
    type: "liability",
    label: "Liability",
    plural: "Liabilities",
    primaryBand: [2000, 2999],
    // Equity (3000–3999) has no dedicated enum value, so it is grouped here.
    ranges: [[2000, 3999]],
    badge:
      "bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/25",
    cardGradient: "from-orange-500 to-amber-600",
    dot: "bg-orange-500",
    normalBalance: "credit",
    groups: [
      "Current Liabilities",
      "Long-Term Liabilities",
      "Equity",
      "Duties & Taxes",
    ],
  },
  {
    type: "income",
    label: "Income",
    plural: "Income",
    primaryBand: [4000, 4999],
    // Operating revenue 4000–4999, other income 8000–8999.
    ranges: [
      [4000, 4999],
      [8000, 8999],
    ],
    badge:
      "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/25",
    cardGradient: "from-blue-500 to-indigo-600",
    dot: "bg-blue-500",
    normalBalance: "credit",
    groups: ["Revenue", "Direct Income", "Other Income"],
  },
  {
    type: "expense",
    label: "Expense",
    plural: "Expenses",
    primaryBand: [5000, 5999],
    // COGS 5000–7999, other expense 9000–9999.
    ranges: [
      [5000, 7999],
      [9000, 9999],
    ],
    badge:
      "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/25",
    cardGradient: "from-red-500 to-rose-600",
    dot: "bg-red-500",
    normalBalance: "debit",
    groups: [
      "Cost of Goods Sold",
      "Direct Expenses",
      "Indirect Expenses",
      "Other Expenses",
    ],
  },
];

const TYPE_BY_KEY: Record<AccountType, AccountTypeMeta> = ACCOUNT_TYPES.reduce(
  (acc, t) => {
    acc[t.type] = t;
    return acc;
  },
  {} as Record<AccountType, AccountTypeMeta>,
);

export function typeMeta(type: AccountType): AccountTypeMeta {
  return TYPE_BY_KEY[type];
}

export function typeLabel(type: AccountType): string {
  return TYPE_BY_KEY[type]?.label ?? type;
}

/** All distinct parent_group values present in the data, plus type suggestions. */
export function knownGroups(accounts: GLAccount[]): string[] {
  const set = new Set<string>();
  for (const t of ACCOUNT_TYPES) t.groups.forEach((g) => set.add(g));
  for (const a of accounts) if (a.parent_group) set.add(a.parent_group);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Current balance of an account from its posted debit/credit totals, using the
 * standard accounting sign convention:
 *   debit-normal  (Assets, Expenses)             -> debit − credit
 *   credit-normal (Liabilities, Equity, Revenue) -> credit − debit
 * Equity is stored under `liability` (credit-normal), so it is handled correctly.
 * Pure + framework-free so it can be reused by reports and the future ledger.
 */
export function computeBalance(type: AccountType, totals: { debit: number; credit: number }): number {
  const debit = totals.debit || 0;
  const credit = totals.credit || 0;
  return typeMeta(type).normalBalance === "debit" ? debit - credit : credit - debit;
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** True when `code` is a clean 3–5 digit account number. */
export function isValidCode(code: string): boolean {
  return /^\d{3,5}$/.test(code.trim());
}

/** True when the numeric code falls inside one of the type's allowed ranges. */
export function codeInBand(code: string, type: AccountType): boolean {
  if (!isValidCode(code)) return false;
  const n = Number(code);
  return typeMeta(type).ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

/**
 * Suggest the next free code for a new account of `type`.
 * Convention: continue from the highest existing code in the primary band,
 * rounded up to the next multiple of 10; fall back to band start + 100.
 * Guaranteed not to collide with an existing code.
 */
export function suggestNextCode(type: AccountType, accounts: GLAccount[]): string {
  const [lo, hi] = typeMeta(type).primaryBand;
  const used = new Set(accounts.map((a) => a.code));
  const inBand = accounts
    .map((a) => Number(a.code))
    .filter((n) => !Number.isNaN(n) && n >= lo && n <= hi);

  let base = inBand.length ? Math.max(...inBand) : lo + 90;
  let next = Math.ceil((base + 1) / 10) * 10; // next multiple of 10 above base
  if (next < lo + 100) next = lo + 100;

  while ((used.has(String(next)) || next > hi) && next <= hi) next += 10;
  // If the tidy band is exhausted, fall back to first free slot anywhere in band.
  if (next > hi || used.has(String(next))) {
    for (let n = lo; n <= hi; n += 1) {
      if (!used.has(String(n))) return String(n);
    }
  }
  return String(next);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface AccountDraft {
  code: string;
  name: string;
  type: AccountType;
  parent_group: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<keyof AccountDraft | "form", string | undefined>;
}

/**
 * Validate a draft account against the current set.
 * Rules enforced (those the fixed schema can actually back):
 *   - code required, well-formed, unique
 *   - code should sit in the type's band (blocked unless `allowOverride`)
 *   - name required, and unique within the same parent_group
 * `excludeId` skips the row being edited so it doesn't clash with itself.
 */
export function validateAccount(
  draft: AccountDraft,
  accounts: GLAccount[],
  opts: { excludeId?: string; allowOverride?: boolean } = {},
): ValidationResult {
  const errors: ValidationResult["errors"] = {
    code: undefined,
    name: undefined,
    type: undefined,
    parent_group: undefined,
    form: undefined,
  };

  const others = accounts.filter((a) => a.id !== opts.excludeId);
  const code = draft.code.trim();
  const name = draft.name.trim();

  if (!code) {
    errors.code = "Account code is required.";
  } else if (!isValidCode(code)) {
    errors.code = "Code must be 3–5 digits (e.g. 1100).";
  } else if (others.some((a) => a.code === code)) {
    errors.code = `Code ${code} is already used by “${
      others.find((a) => a.code === code)?.name
    }”.`;
  } else if (!opts.allowOverride && !codeInBand(code, draft.type)) {
    const [lo, hi] = typeMeta(draft.type).primaryBand;
    errors.code = `${typeLabel(draft.type)} codes belong in ${lo}–${hi}. Tick “manual override” to use ${code} anyway.`;
  }

  if (!name) {
    errors.name = "Account name is required.";
  } else if (
    others.some(
      (a) =>
        a.name.trim().toLowerCase() === name.toLowerCase() &&
        (a.parent_group ?? "") === (draft.parent_group ?? ""),
    )
  ) {
    errors.name = `“${name}” already exists under ${
      draft.parent_group || "no group"
    }.`;
  }

  const ok = !errors.code && !errors.name && !errors.type && !errors.parent_group;
  return { ok, errors };
}

// ---------------------------------------------------------------------------
// Hierarchy grouping (type → parent_group → accounts)
// ---------------------------------------------------------------------------

export interface GroupNode {
  group: string;
  accounts: GLAccount[];
}
export interface TypeNode {
  type: AccountType;
  meta: AccountTypeMeta;
  groups: GroupNode[];
  count: number;
}

/** Build the two-level tree the "Grouped" view renders. */
export function buildTree(accounts: GLAccount[]): TypeNode[] {
  return ACCOUNT_TYPES.map((meta) => {
    const ofType = accounts
      .filter((a) => a.type === meta.type)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const byGroup = new Map<string, GLAccount[]>();
    for (const a of ofType) {
      const key = a.parent_group ?? "Ungrouped";
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(a);
    }
    const groups: GroupNode[] = Array.from(byGroup.entries())
      .map(([group, accs]) => ({ group, accounts: accs }))
      .sort((a, b) => a.group.localeCompare(b.group));
    return { type: meta.type, meta, groups, count: ofType.length };
  }).filter((n) => n.count > 0);
}

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = ["code", "name", "type", "parent_group"] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serialize accounts to a CSV string (code,name,type,parent_group). */
export function toCSV(accounts: GLAccount[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = accounts.map((a) =>
    [a.code, a.name, a.type, a.parent_group ?? ""].map((v) => csvEscape(String(v))).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, commas, CRLF. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ParsedImportRow {
  draft: AccountDraft;
  errors: string[];
  raw: string[];
}

/**
 * Parse a pasted/uploaded CSV into validated draft rows for preview.
 * Accepts a header row (matched case-insensitively) or positional columns in
 * the order code,name,type,parent_group. Validation runs against the existing
 * accounts PLUS earlier rows in the same file so intra-file duplicates surface.
 */
export function parseImport(text: string, existing: GLAccount[]): ParsedImportRow[] {
  const table = parseCSV(text);
  if (table.length === 0) return [];

  let startIdx = 0;
  const first = table[0].map((c) => c.trim().toLowerCase());
  const looksLikeHeader = first.includes("code") && first.includes("name");
  const colIndex: Record<string, number> = { code: 0, name: 1, type: 2, parent_group: 3 };
  if (looksLikeHeader) {
    startIdx = 1;
    CSV_COLUMNS.forEach((col) => {
      const idx = first.indexOf(col);
      if (idx >= 0) colIndex[col] = idx;
    });
  }

  const validTypes = ACCOUNT_TYPES.map((t) => t.type) as string[];
  const running: GLAccount[] = [...existing];
  const out: ParsedImportRow[] = [];

  for (let r = startIdx; r < table.length; r += 1) {
    const cells = table[r];
    const code = (cells[colIndex.code] ?? "").trim();
    const name = (cells[colIndex.name] ?? "").trim();
    const typeRaw = (cells[colIndex.type] ?? "").trim().toLowerCase();
    const group = (cells[colIndex.parent_group] ?? "").trim() || null;

    const errors: string[] = [];
    const typeOk = validTypes.includes(typeRaw);
    if (!typeOk) errors.push(`Type must be one of ${validTypes.join(", ")}.`);
    const type = (typeOk ? typeRaw : "asset") as AccountType;

    const draft: AccountDraft = { code, name, type, parent_group: group };
    const result = validateAccount(draft, running, { allowOverride: true });
    if (result.errors.code) errors.push(result.errors.code);
    if (result.errors.name) errors.push(result.errors.name);

    if (errors.length === 0) {
      // Add to running set so later rows see it (catches in-file duplicates).
      running.push({ id: `import-${r}`, ...draft });
    }
    out.push({ draft, errors, raw: cells });
  }
  return out;
}
