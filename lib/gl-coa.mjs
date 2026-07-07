/*
  Chart of Accounts — single source of truth (pure data, no side effects)
  =======================================================================
  Shared by BOTH the app (lib is type-checked via allowJs) and the seeder
  (scripts/seed-coa.mjs). Edit this list to add/change accounts, then re-run
  `node scripts/seed-coa.mjs` to push the changes to the database.

  Each item is [name, description]. Codes are assigned per section as
  `start + index*step`, keeping them unique, ordered, and inside the band that
  lib/gl.ts enforces:
      asset 1000–1999 · liability/equity 2000–3999 · income 4000–4999 & 8000–8999
      expense 5000–7999 & 9000–9999

  The `type` is the DB enum; `group` becomes parent_group. Equity uses
  type "liability" because the enum has no "equity" value. `description` is NOT a
  column on gl_accounts — it lives here as the source and is surfaced in the app's
  Account Details view via GL_DESCRIPTIONS below.
*/

export const SECTIONS = [
  // ===================== ASSETS (1000–1999) =====================
  { type: "asset", group: "Current Assets", start: 1000, step: 10, items: [
    ["Cash on Hand", "Physical cash held at business premises."],
    ["Petty Cash", "Small cash float for minor day-to-day expenses."],
    ["Undeposited Funds", "Receipts collected but not yet deposited to the bank."],
    ["Main Bank Account", "Primary operating current account."],
    ["Savings Bank Account", "Interest-bearing savings account."],
    ["Accounts Receivable", "Amounts owed by customers on credit sales (control)."],
    ["Allowance for Doubtful Accounts", "Contra-asset provision for estimated uncollectible receivables."],
    ["Inventory", "Goods held for sale or production (control account)."],
    ["Prepaid Expenses", "Expenses paid in advance (rent, insurance, subscriptions)."],
    ["Employee Advances", "Advances and loans issued to employees."],
    ["GST/VAT Receivable", "Recoverable GST/VAT paid on purchases."],
    ["Input Tax Credit", "Input tax credit available to offset output tax."],
  ]},
  { type: "asset", group: "Inventory", start: 1150, step: 10, items: [
    ["Raw Materials", "Materials awaiting use in production."],
    ["Work in Progress", "Partially completed goods still in production."],
    ["Finished Goods", "Completed goods ready for sale."],
  ]},
  { type: "asset", group: "Fixed Assets", start: 1200, step: 10, items: [
    ["Land", "Land owned by the business (not depreciated)."],
    ["Buildings", "Owned buildings and permanent structures."],
    ["Machinery", "Production and processing machinery."],
    ["Plant & Equipment", "Plant and heavy operating equipment."],
    ["Furniture & Fixtures", "Office furniture and fixtures."],
    ["Computers", "Computers, laptops and servers."],
    ["Office Equipment", "Printers, phones and other office equipment."],
    ["Vehicles", "Company-owned vehicles."],
    ["Leasehold Improvements", "Improvements made to leased premises."],
  ]},
  { type: "asset", group: "Accumulated Depreciation", start: 1400, step: 10, items: [
    ["Accum. Depreciation - Buildings", "Contra-asset: accumulated depreciation on buildings."],
    ["Accum. Depreciation - Machinery", "Contra-asset: accumulated depreciation on machinery."],
    ["Accum. Depreciation - Plant & Equipment", "Contra-asset: accumulated depreciation on plant & equipment."],
    ["Accum. Depreciation - Furniture & Fixtures", "Contra-asset: accumulated depreciation on furniture & fixtures."],
    ["Accum. Depreciation - Computers", "Contra-asset: accumulated depreciation on computers."],
    ["Accum. Depreciation - Office Equipment", "Contra-asset: accumulated depreciation on office equipment."],
    ["Accum. Depreciation - Vehicles", "Contra-asset: accumulated depreciation on vehicles."],
    ["Accum. Depreciation - Leasehold Improvements", "Contra-asset: accumulated depreciation on leasehold improvements."],
  ]},

  // ===================== LIABILITIES (2000–2999) =====================
  { type: "liability", group: "Current Liabilities", start: 2000, step: 10, items: [
    ["Accounts Payable", "Amounts owed to suppliers on credit purchases (control)."],
    ["Trade Creditors", "Trade payables for goods and services received."],
    ["Accrued Expenses", "Expenses incurred but not yet invoiced or paid."],
    ["Salaries Payable", "Net salaries owed to employees."],
    ["Payroll Taxes Payable", "Payroll taxes withheld and owed to authorities."],
    ["GST/VAT Payable", "Output GST/VAT collected and owed to authorities."],
    ["Sales Tax Payable", "Sales tax collected and owed to authorities."],
    ["Income Tax Payable", "Corporate income tax owed for the period."],
    ["Customer Deposits", "Advance deposits received from customers."],
    ["Unearned Revenue", "Payments received for goods/services not yet delivered."],
    ["Short-Term Loans", "Loans and borrowings due within twelve months."],
    ["Credit Card Payable", "Outstanding balances on company credit cards."],
    ["Provident Fund Payable", "Employee/employer PF contributions owed."],
    ["Retention Payable", "Amounts retained from contractors, payable later."],
  ]},
  { type: "liability", group: "Long-Term Liabilities", start: 2300, step: 10, items: [
    ["Bank Loans", "Long-term bank loans due beyond twelve months."],
    ["Lease Liabilities", "Present value of long-term lease obligations."],
    ["Mortgage Payable", "Mortgage financing on owned property."],
    ["Deferred Tax Liability", "Taxes deferred to future periods."],
  ]},

  // ===================== EQUITY (3000–3999, stored as liability) =====================
  { type: "liability", group: "Equity", start: 3000, step: 10, items: [
    ["Owner's Capital", "Capital contributed by the owner(s)."],
    ["Share Capital", "Par value of issued shares."],
    ["Additional Paid-In Capital", "Amounts received above par value on shares."],
    ["Retained Earnings", "Accumulated profits retained in the business."],
    ["Current Year Earnings", "Net profit/loss for the current financial year."],
    ["Drawings / Owner Withdrawals", "Contra-equity: amounts withdrawn by the owner(s)."],
  ]},

  // ===================== REVENUE (4000–4999) =====================
  { type: "income", group: "Revenue", start: 4000, step: 10, items: [
    ["Product Sales", "Revenue from sale of products."],
    ["Service Revenue", "Revenue from services rendered."],
    ["Subscription Revenue", "Recurring subscription revenue."],
    ["Consulting Revenue", "Revenue from consulting engagements."],
    ["Commission Income", "Commissions earned."],
    ["Rental Income", "Income from renting out property or equipment."],
    ["Interest Income", "Interest earned on deposits and investments."],
    ["Dividend Income", "Dividends received on investments."],
    ["Other Operating Revenue", "Miscellaneous operating revenue."],
    ["Sales Returns & Allowances", "Contra-revenue: returns and allowances on sales."],
  ]},

  // ===================== COST OF GOODS SOLD (5000–5999) =====================
  { type: "expense", group: "Cost of Goods Sold", start: 5000, step: 10, items: [
    ["Material Cost", "Cost of materials consumed in production/sales."],
    ["Direct Labour", "Wages of labour directly tied to production."],
    ["Manufacturing Overheads", "Indirect production costs (power, factory rent)."],
    ["Freight In", "Inbound freight and carriage on purchases."],
    ["Purchase Discounts", "Contra-COGS: discounts received on purchases."],
    ["Inventory Adjustments", "Write-downs and shrinkage adjustments to inventory."],
  ]},

  // ===================== OPERATING EXPENSES (6000–7999) =====================
  { type: "expense", group: "Operating Expenses", start: 6000, step: 10, items: [
    ["Salaries & Wages", "Administrative and non-production salaries and wages."],
    ["Bonus Expense", "Performance and annual bonuses."],
    ["Employer Contributions", "Employer share of PF, insurance and statutory contributions."],
    ["Rent", "Office and premises rent."],
    ["Utilities", "Electricity, water and gas."],
    ["Telephone", "Landline and mobile telephone charges."],
    ["Internet", "Internet and broadband charges."],
    ["Office Supplies", "Consumable office supplies."],
    ["Printing & Stationery", "Printing, stationery and postage."],
    ["Repairs & Maintenance", "Upkeep of premises and equipment."],
    ["Travel Expense", "Business travel — airfare, lodging, transport."],
    ["Meals & Entertainment", "Business meals and client entertainment."],
    ["Fuel Expense", "Fuel for company vehicles."],
    ["Vehicle Expense", "Vehicle running, servicing and insurance."],
    ["Insurance", "Business insurance premiums."],
    ["Professional Fees", "Fees for professional and consulting services."],
    ["Legal Fees", "Legal and litigation costs."],
    ["Audit Fees", "External audit and assurance fees."],
    ["Bank Charges", "Bank service and transaction charges."],
    ["Merchant Fees", "Card processing and payment gateway fees."],
    ["Software Licenses", "Licensed software subscriptions and seats."],
    ["Cloud Services", "Cloud hosting and infrastructure costs."],
    ["IT Expenses", "General IT support and hardware consumables."],
    ["Marketing", "Marketing campaigns and collateral."],
    ["Advertising", "Paid advertising across channels."],
    ["Training", "Staff training and development."],
    ["Recruitment", "Hiring, agency and onboarding costs."],
    ["Depreciation Expense", "Periodic depreciation of fixed assets."],
    ["Amortization Expense", "Periodic amortization of intangible assets."],
    ["Bad Debt Expense", "Receivables written off / provisioned as uncollectible."],
    ["Miscellaneous Expense", "Sundry operating expenses not classified elsewhere."],
  ]},

  // ===================== OTHER INCOME (8000–8999) =====================
  { type: "income", group: "Other Income", start: 8000, step: 10, items: [
    ["Gain on Asset Sale", "Gain on disposal of fixed assets."],
    ["Foreign Exchange Gain", "Realized/unrealized gains on foreign currency."],
    ["Miscellaneous Income", "Non-operating miscellaneous income."],
  ]},

  // ===================== OTHER EXPENSES (9000–9999) =====================
  { type: "expense", group: "Other Expenses", start: 9000, step: 10, items: [
    ["Interest Expense", "Interest on loans and borrowings."],
    ["Foreign Exchange Loss", "Realized/unrealized losses on foreign currency."],
    ["Loss on Asset Disposal", "Loss on disposal of fixed assets."],
    ["Penalties & Fines", "Statutory penalties and fines."],
    ["Extraordinary Expenses", "One-off non-recurring expenses."],
  ]},
];

/** Flatten SECTIONS into account rows with generated codes. Throws on duplicates. */
export function buildAccounts() {
  const rows = [];
  const seen = new Set();
  for (const s of SECTIONS) {
    s.items.forEach(([name, description], i) => {
      const code = String(s.start + i * s.step);
      if (seen.has(code)) throw new Error(`Duplicate code generated: ${code} (${name})`);
      seen.add(code);
      rows.push({ code, name, type: s.type, parent_group: s.group, description });
    });
  }
  return rows;
}

/** code -> description, for the app's Account Details view. */
export const GL_DESCRIPTIONS = Object.freeze(
  Object.fromEntries(buildAccounts().map((a) => [a.code, a.description])),
);
