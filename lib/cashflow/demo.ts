/*
  Cash Flow — DEMO DATA (presentation / UI testing only).
  =======================================================
  This is the ONLY place demo cash-flow data lives. It is completely isolated
  from business logic, the database schema and the future transaction engine.
  It feeds the module through the exact same seam real data will (engine.ts →
  fetchTransactions / fetchBankAccounts / fetchForecast), so switching to live
  data later is a one-line change and this file can simply be deleted.

  ── ENABLE / DISABLE WITH A SINGLE FLAG ───────────────────────────────────────
      CASHFLOW_DEMO = true   → the module renders this rich demo dataset.
      CASHFLOW_DEMO = false  → the module uses the real engine (empty/₹0.00 today,
                               real posted transactions once modules ship).
  Nothing else needs to change. To remove demo data permanently: set the flag to
  false (and, if you like, delete this file — engine.ts imports are the only refs).

  The dataset is fully deterministic (seeded PRNG, no Math.random / Date.now at
  module scope) and engineered so the headline KPIs land EXACTLY:
      Opening ₹24,50,000 · In ₹82,50,000 · Out ₹64,80,000 · Net ₹17,70,000 ·
      Closing ₹42,20,000  (Opening = Σ bank opening balances; Closing = Opening+Net)
*/

import type {
  BankAccount,
  CashFlowCategoryId,
  CashFlowTxn,
  DateRange,
  ForecastItem,
  ForecastSourceId,
  TxnStatus,
  TxnTypeId,
} from "./types";
import { toISODate } from "./dates";

/** THE SINGLE SWITCH. Flip to false to disable all demo data. */
export const CASHFLOW_DEMO = true;

const TARGET_IN = 8_250_000;
const TARGET_OUT = 6_480_000;

// ── deterministic PRNG (seeded — stable across renders, no hydration drift) ───
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(arr: T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length)];

/** Split `total` into `count` positive amounts (multiples of `step`) summing EXACTLY to total. */
function distribute(total: number, count: number, rnd: () => number, step = 100): number[] {
  if (count <= 1) return [total];
  const out: number[] = [];
  let remaining = total;
  for (let i = 0; i < count - 1; i++) {
    const slotsLeft = count - i;
    const avg = remaining / slotsLeft;
    let a = Math.round((avg * (0.55 + rnd() * 0.9)) / step) * step;
    const maxA = remaining - step * (slotsLeft - 1);
    if (a > maxA) a = maxA;
    if (a < step) a = step;
    out.push(a);
    remaining -= a;
  }
  out.push(remaining);
  return out;
}

// ── bank accounts (opening balances sum to ₹24,50,000) ────────────────────────
const BANKS = {
  main: { id: "demo-bank-main", name: "Main Operating Account", bank: "HDFC Bank", accountNo: "••••1042", currency: "INR", openingBalance: 1_500_000 },
  payroll: { id: "demo-bank-payroll", name: "Payroll Account", bank: "ICICI Bank", accountNo: "••••5588", currency: "INR", openingBalance: 450_000 },
  savings: { id: "demo-bank-savings", name: "Savings Account", bank: "Axis Bank", accountNo: "••••9931", currency: "INR", openingBalance: 480_000 },
  petty: { id: "demo-bank-petty", name: "Petty Cash", bank: "Cash", accountNo: null as string | null, currency: "INR", openingBalance: 20_000 },
} as const;

export function demoBankAccounts(): BankAccount[] {
  return Object.values(BANKS).map((b) => ({ ...b }));
}

const USERS = ["Priya Sharma", "Rahul Verma", "Aarti Nair", "Vikram Iyer", "Neha Kapoor", "System"];
const CUSTOMERS = ["Acme Corp", "Zenith Traders", "BlueOak Ltd", "Sterling Retail", "Nova Industries", "Orbit Systems", "Vertex Foods", "Lumen Tech", "Crest Logistics", "Pinnacle Motors"];
const VENDORS = ["OfficeMart", "PowerGrid Utilities", "Skyline Realty", "TechCloud Inc", "SwiftParts Ltd", "Metro Supplies", "GreenLeaf Services", "Apex Freight", "CloudNet", "PrintWorks"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── date helpers (all relative to the caller's `now`, all in the past) ────────
function monthlyDate(now: Date, offset: number, day: number): Date {
  return new Date(now.getFullYear(), now.getMonth() - offset, Math.min(day, 28));
}
function randomPastDate(now: Date, rnd: () => number, maxDays = 363): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - (2 + Math.floor(rnd() * (maxDays - 2))));
  return d;
}
function statusFor(date: Date, now: Date, rnd: () => number): TxnStatus {
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays < 4) return rnd() < 0.5 ? "pending" : "posted";
  const r = rnd();
  return r < 0.55 ? "reconciled" : r < 0.85 ? "cleared" : "posted";
}

interface StreamCfg {
  key: string;
  type: TxnTypeId;
  category: CashFlowCategoryId;
  dir: "in" | "out";
  gl: { code: string; name: string };
  bankId: string;
  refPrefix: string;
  dept: string;
  cadence: "monthly" | "quarterly" | "random";
  day?: number; // for monthly cadence
  desc: (rnd: () => number) => string;
}

const LOCATIONS = ["Mumbai HQ", "Bengaluru", "Delhi NCR", "Pune", null, null];
const PROJECTS = ["Project Atlas", "Project Orion", null, null, null];

// Fixed streams (totals are exact; the two "rest" streams below absorb the remainder).
const STREAMS: { cfg: StreamCfg; total: number; count: number }[] = [
  // INFLOWS
  { total: 5_000_000, count: 55, cfg: { key: "cust", type: "customer_payment", category: "operating", dir: "in", gl: { code: "1200", name: "Accounts Receivable" }, bankId: BANKS.main.id, refPrefix: "RCP", dept: "Collections", cadence: "random", desc: (r) => `Payment received — ${pick(CUSTOMERS, r)}` } },
  { total: 2_200_000, count: 34, cfg: { key: "sales", type: "bank_deposit", category: "operating", dir: "in", gl: { code: "4000", name: "Product Sales" }, bankId: BANKS.main.id, refPrefix: "DEP", dept: "Sales", cadence: "random", desc: (r) => `Sales receipt deposit — ${pick(CUSTOMERS, r)}` } },
  { total: 180_000, count: 12, cfg: { key: "intinc", type: "interest", category: "financing", dir: "in", gl: { code: "4200", name: "Interest Income" }, bankId: BANKS.savings.id, refPrefix: "INT", dept: "Finance", cadence: "monthly", day: 20, desc: () => "Interest credited — savings" } },
  // OUTFLOWS
  { total: 1_300_000, count: 26, cfg: { key: "vend", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "2000", name: "Accounts Payable" }, bankId: BANKS.main.id, refPrefix: "PAY", dept: "Operations", cadence: "random", desc: (r) => `Payment to ${pick(VENDORS, r)}` } },
  { total: 1_000_000, count: 18, cfg: { key: "inv", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "1300", name: "Inventory" }, bankId: BANKS.main.id, refPrefix: "INV", dept: "Inventory", cadence: "random", desc: (r) => `Inventory purchase — ${pick(VENDORS, r)}` } },
  { total: 1_500_000, count: 12, cfg: { key: "pay", type: "payroll", category: "operating", dir: "out", gl: { code: "6000", name: "Salaries & Wages" }, bankId: BANKS.payroll.id, refPrefix: "PYR", dept: "Payroll", cadence: "monthly", day: 28, desc: (r) => `Monthly payroll run — ${MONTHS[Math.floor(r() * 12)]}` } },
  { total: 480_000, count: 12, cfg: { key: "rent", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "6100", name: "Rent Expense" }, bankId: BANKS.main.id, refPrefix: "RNT", dept: "Rent", cadence: "monthly", day: 1, desc: () => "Office rent — Skyline Realty" } },
  { total: 200_000, count: 12, cfg: { key: "util", type: "bank_withdrawal", category: "operating", dir: "out", gl: { code: "6200", name: "Utilities Expense" }, bankId: BANKS.main.id, refPrefix: "UTL", dept: "Utilities", cadence: "monthly", day: 12, desc: () => "Electricity & water — PowerGrid" } },
  { total: 280_000, count: 5, cfg: { key: "equip", type: "investment", category: "investing", dir: "out", gl: { code: "1500", name: "Equipment" }, bankId: BANKS.main.id, refPrefix: "CAP", dept: "Operations", cadence: "random", desc: (r) => `Equipment purchase — ${pick(VENDORS, r)}` } },
  // Disposal of old/replaced equipment — a real investing INFLOW. This is the
  // only source the Indirect statement's "Gain/Loss on Asset Sales" and the
  // Investing section's "Sale of Fixed Assets" line derive from (see
  // lib/cashflow/logic.ts indirectStatement) — never a separately hardcoded figure.
  { total: 150_000, count: 2, cfg: { key: "assetsale", type: "investment", category: "investing", dir: "in", gl: { code: "1510", name: "Proceeds from Sale of Fixed Assets" }, bankId: BANKS.main.id, refPrefix: "DSP", dept: "Operations", cadence: "random", desc: () => "Sale of old equipment (replaced)" } },
  { total: 240_000, count: 12, cfg: { key: "loan", type: "loan_payment", category: "financing", dir: "out", gl: { code: "2500", name: "Loan Payable" }, bankId: BANKS.main.id, refPrefix: "LON", dept: "Finance", cadence: "monthly", day: 15, desc: () => "Term loan EMI — HDFC Bank" } },
  { total: 100_000, count: 12, cfg: { key: "intexp", type: "interest", category: "financing", dir: "out", gl: { code: "6300", name: "Interest Expense" }, bankId: BANKS.main.id, refPrefix: "INE", dept: "Finance", cadence: "monthly", day: 15, desc: () => "Loan interest charged" } },
  { total: 260_000, count: 4, cfg: { key: "tax", type: "tax", category: "operating", dir: "out", gl: { code: "2600", name: "Taxes Payable" }, bankId: BANKS.main.id, refPrefix: "TAX", dept: "Taxes", cadence: "quarterly", desc: () => "Quarterly GST / advance tax" } },
  { total: 90_000, count: 4, cfg: { key: "ins", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "6500", name: "Insurance Expense" }, bankId: BANKS.main.id, refPrefix: "INS", dept: "Administration", cadence: "quarterly", desc: () => "Business insurance premium" } },
  { total: 60_000, count: 10, cfg: { key: "office", type: "bank_withdrawal", category: "operating", dir: "out", gl: { code: "6600", name: "Office Supplies" }, bankId: BANKS.petty.id, refPrefix: "OFS", dept: "Administration", cadence: "random", desc: () => "Office supplies — OfficeMart" } },
  { total: 120_000, count: 10, cfg: { key: "travel", type: "bank_withdrawal", category: "operating", dir: "out", gl: { code: "6700", name: "Travel Expense" }, bankId: BANKS.petty.id, refPrefix: "TRV", dept: "Operations", cadence: "random", desc: (r) => `Travel & lodging — ${pick(["Mumbai", "Delhi", "Bengaluru", "Chennai"], r)}` } },
  { total: 90_000, count: 12, cfg: { key: "subs", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "6800", name: "Software Subscriptions" }, bankId: BANKS.main.id, refPrefix: "SUB", dept: "Administration", cadence: "monthly", day: 5, desc: (r) => `SaaS subscription — ${pick(["TechCloud", "CloudNet", "PrintWorks"], r)}` } },
  { total: 110_000, count: 8, cfg: { key: "mkt", type: "vendor_payment", category: "operating", dir: "out", gl: { code: "6900", name: "Marketing Expense" }, bankId: BANKS.main.id, refPrefix: "MKT", dept: "Marketing", cadence: "random", desc: () => "Digital marketing campaign" } },
];

// The two remainder streams — totals computed at generation time to hit targets exactly.
const REST_IN: StreamCfg = { key: "miscin", type: "miscellaneous", category: "operating", dir: "in", gl: { code: "4900", name: "Miscellaneous Income" }, bankId: BANKS.main.id, refPrefix: "MSI", dept: "Operations", cadence: "random", desc: () => "Miscellaneous income" };
const REST_OUT: StreamCfg = { key: "miscout", type: "miscellaneous", category: "operating", dir: "out", gl: { code: "6950", name: "Miscellaneous Expense" }, bankId: BANKS.petty.id, refPrefix: "MSE", dept: "Operations", cadence: "random", desc: () => "Miscellaneous expense" };
const REST_IN_COUNT = 8;
const REST_OUT_COUNT = 8;

// Internal bank transfers (net zero cash — equal in & out legs across own accounts).
const TRANSFER_TOTAL = 600_000;
const TRANSFER_PAIRS = 6;

export function demoTransactions(now: Date): CashFlowTxn[] {
  const rnd = mulberry32(20260709);
  const rows: Omit<CashFlowTxn, "id">[] = [];
  const seqByPrefix: Record<string, number> = {};
  let inSoFar = 0;
  let outSoFar = 0;

  const nextRef = (prefix: string) => {
    seqByPrefix[prefix] = (seqByPrefix[prefix] ?? 0) + 1;
    return `${prefix}-${now.getFullYear()}-${String(seqByPrefix[prefix]).padStart(4, "0")}`;
  };

  const emit = (cfg: StreamCfg, amount: number, date: Date) => {
    const bank = Object.values(BANKS).find((b) => b.id === cfg.bankId)!;
    const isIn = cfg.dir === "in";
    if (isIn) inSoFar += amount;
    else outSoFar += amount;
    rows.push({
      date: toISODate(date),
      documentNo: nextRef(cfg.refPrefix),
      type: cfg.type,
      description: cfg.desc(rnd),
      glAccountId: `demo-gl-${cfg.gl.code}`,
      glAccountCode: cfg.gl.code,
      glAccountName: cfg.gl.name,
      bankAccountId: bank.id,
      bankAccountName: bank.name,
      category: cfg.category,
      cashIn: isIn ? amount : 0,
      cashOut: isIn ? 0 : amount,
      status: statusFor(date, now, rnd),
      reference: `${cfg.refPrefix}/${String(seqByPrefix[cfg.refPrefix]).padStart(3, "0")}`,
      user: pick(USERS, rnd),
      companyId: null,
      department: cfg.dept,
      location: pick(LOCATIONS, rnd),
      project: pick(PROJECTS, rnd),
    });
  };

  const runStream = (cfg: StreamCfg, total: number, count: number) => {
    const amounts = distribute(total, count, rnd, 100);
    for (let i = 0; i < count; i++) {
      let date: Date;
      if (cfg.cadence === "monthly") date = monthlyDate(now, i + 1, cfg.day ?? 15);
      else if (cfg.cadence === "quarterly") date = monthlyDate(now, Math.round((12 * (i + 0.5)) / count) + 1, 15);
      else date = randomPastDate(now, rnd);
      emit(cfg, amounts[i], date);
    }
  };

  // 1) internal transfers (equal in + out legs → net zero, but real per-bank movement)
  const transferAmounts = distribute(TRANSFER_TOTAL, TRANSFER_PAIRS, rnd, 1000);
  for (let i = 0; i < TRANSFER_PAIRS; i++) {
    const amount = transferAmounts[i];
    const date = randomPastDate(now, rnd);
    const target = i % 2 === 0 ? BANKS.savings : BANKS.payroll;
    const ref = nextRef("TRF");
    const status = statusFor(date, now, rnd);
    const user = pick(USERS, rnd);
    // out-leg (from Main)
    outSoFar += amount;
    rows.push({
      date: toISODate(date), documentNo: `${ref}-A`, type: "transfer", description: `Transfer to ${target.name}`,
      glAccountId: "demo-gl-1000", glAccountCode: "1000", glAccountName: "Bank & Cash", bankAccountId: BANKS.main.id, bankAccountName: BANKS.main.name,
      category: "operating", cashIn: 0, cashOut: amount, status, reference: ref, user, companyId: null, department: "Finance", location: "Mumbai HQ", project: null,
    });
    // in-leg (to target)
    inSoFar += amount;
    rows.push({
      date: toISODate(date), documentNo: `${ref}-B`, type: "transfer", description: `Transfer from ${BANKS.main.name}`,
      glAccountId: "demo-gl-1000", glAccountCode: "1000", glAccountName: "Bank & Cash", bankAccountId: target.id, bankAccountName: target.name,
      category: "operating", cashIn: amount, cashOut: 0, status, reference: ref, user, companyId: null, department: "Finance", location: "Mumbai HQ", project: null,
    });
  }

  // 2) all fixed streams
  for (const s of STREAMS) runStream(s.cfg, s.total, s.count);

  // 3) remainder streams — make grand totals EXACTLY the KPI targets
  runStream(REST_IN, Math.max(REST_IN_COUNT * 100, TARGET_IN - inSoFar), REST_IN_COUNT);
  runStream(REST_OUT, Math.max(REST_OUT_COUNT * 100, TARGET_OUT - outSoFar), REST_OUT_COUNT);

  // sort chronologically and assign stable ids
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows.map((r, i) => ({ ...r, id: `demo-txn-${String(i + 1).padStart(4, "0")}` }));
}

// ── forecast (projected future cash over the next 90 days) ────────────────────
export function demoForecast(now: Date): ForecastItem[] {
  const rnd = mulberry32(77123);
  const items: ForecastItem[] = [];
  let n = 0;
  const add = (offsetDays: number, label: string, source: ForecastSourceId, dir: "in" | "out", amount: number, ref: string) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    items.push({ id: `demo-fc-${++n}`, date: toISODate(d), label, source, direction: dir, amount, reference: ref });
  };

  // open customer invoices (in)
  for (let i = 0; i < 14; i++) add(4 + Math.floor(rnd() * 82), `Invoice due — ${pick(CUSTOMERS, rnd)}`, "open_invoices", "in", 50_000 + Math.round(rnd() * 30) * 10_000, `INV-${2000 + i}`);
  // expected receipts (in)
  for (let i = 0; i < 8; i++) add(3 + Math.floor(rnd() * 55), `Expected receipt — ${pick(CUSTOMERS, rnd)}`, "expected_receipts", "in", 40_000 + Math.round(rnd() * 16) * 10_000, `EXR-${100 + i}`);
  // open vendor bills (out)
  for (let i = 0; i < 12; i++) add(5 + Math.floor(rnd() * 70), `Bill due — ${pick(VENDORS, rnd)}`, "open_bills", "out", 30_000 + Math.round(rnd() * 20) * 10_000, `BILL-${500 + i}`);
  // recurring expenses (out)
  [30, 60, 90].forEach((off, k) => {
    add(off, "Office rent — Skyline Realty", "recurring_expenses", "out", 40_000, `RNT-F${k}`);
    add(off - 3, "Utilities — PowerGrid", "recurring_expenses", "out", 18_000, `UTL-F${k}`);
    add(off - 5, "SaaS subscriptions", "recurring_expenses", "out", 9_000, `SUB-F${k}`);
  });
  // payroll (out)
  add(21, "Payroll run", "payroll", "out", 130_000, "PYR-F1");
  add(51, "Payroll run", "payroll", "out", 130_000, "PYR-F2");
  add(81, "Payroll run", "payroll", "out", 130_000, "PYR-F3");
  // scheduled payments (out)
  add(15, "Term loan EMI — HDFC", "scheduled_payments", "out", 20_000, "LON-F1");
  add(40, "Advance tax instalment", "scheduled_payments", "out", 60_000, "TAX-F1");

  return items;
}

/** Trailing-12-month range so the dashboard opens fully populated in demo mode. */
export function demoDefaultRange(now: Date): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  return { start: toISODate(start), end: toISODate(now) };
}
