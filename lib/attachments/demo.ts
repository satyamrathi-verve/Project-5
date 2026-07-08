/*
  Attachments — DEMO SUPPORTING DOCUMENTS (server-only, modular).
  ==============================================================
  Populates each major GL account with 2–5 realistic *supporting* documents an
  accountant would upload and retain for audit — purchase invoices, agreements,
  certificates, policies, cheques, resolutions, photos — NOT system-generated
  ERP reports. Files are generated as REAL bytes (PDF / PNG / XLSX) and written
  to the normal DMS storage folder, so View / Download / preview all work through
  the existing UI with zero changes to it.

  ── Modular on/off ────────────────────────────────────────────────────────────
    ATTACHMENTS_DEMO = true   → the DMS lazily seeds these docs the first time a
                                GL account's Attachments tab is opened.
    ATTACHMENTS_DEMO = false  → nothing is seeded; delete storage/attachments/gl
                                to clear anything already generated.
  Real uploads always take precedence: seeding only runs when a record has no
  manifest yet, so it never overwrites or resurrects user files.

  Server-only (uses node:zlib + fs via the caller). Never imported by the client.
*/

import zlib from "zlib";
import { buildAccounts } from "@/lib/gl-coa.mjs";
import type { AttachmentMeta, HistoryEntry, RecordManifest } from "./types";

/** THE SINGLE SWITCH. */
export const ATTACHMENTS_DEMO = true;

type Ext = "pdf" | "png" | "xlsx";
interface DocSpec {
  title: string; // becomes the file name (without extension)
  ext: Ext;
  description: string;
  tags: string[];
  party?: string; // counterparty printed inside the document
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CONTENT_TYPE: Record<Ext, string> = { pdf: "application/pdf", png: "image/png", xlsx: XLSX_MIME };

const USERS = ["Priya Sharma", "Rahul Verma", "Aarti Nair", "Vikram Iyer", "Neha Kapoor", "CA Suresh Menon", "Admin"];
const VENDORS = ["Metro Supplies Pvt Ltd", "SwiftParts Ltd", "TechCloud Systems", "GreenLeaf Services", "Skyline Realty", "PowerGrid Utilities", "Apex Freight"];
const CUSTOMERS = ["Acme Corp", "Zenith Traders", "BlueOak Ltd", "Sterling Retail", "Nova Industries"];
const BANKS = ["HDFC Bank", "ICICI Bank", "Axis Bank", "State Bank of India"];

// ── deterministic PRNG (stable file set per account) ──────────────────────────
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
function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = <T>(arr: T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length)];
const refNo = (prefix: string, rnd: () => number) => `${prefix}-2024-${String(1000 + Math.floor(rnd() * 8999)).padStart(4, "0")}`;

// ── business-purpose → document set (2–5 per account) ─────────────────────────
function docsFor(name: string, type: string, group: string, rnd: () => number): DocSpec[] {
  const n = name.toLowerCase();
  const g = (group || "").toLowerCase();
  // Contra / control / provision accounts don't carry supporting documents.
  if (/accum|allowance|provision|suspense|rounding|clearing|contra|doubtful|depreciation/.test(n)) return [];

  const vendor = pick(VENDORS, rnd);
  const customer = pick(CUSTOMERS, rnd);
  const bank = pick(BANKS, rnd);
  const specs: DocSpec[] = [];

  if (/loan|borrow|debenture|mortgage|overdraft/.test(n)) {
    specs.push(
      { title: `Loan Agreement - ${bank}`, ext: "pdf", description: `Term loan agreement with ${bank}.`, tags: ["Agreement", "Bank"], party: bank },
      { title: "Sanction Letter", ext: "pdf", description: `Loan sanction letter ${refNo("SL", rnd)}.`, tags: ["Bank"], party: bank },
      { title: "Board Resolution", ext: "pdf", description: "Board resolution authorising the borrowing.", tags: ["Board Resolution"] },
      { title: "Repayment Schedule", ext: "xlsx", description: "Contractual EMI / repayment schedule.", tags: ["Supporting Document"], party: bank },
      { title: "Collateral Documents", ext: "pdf", description: "Security / collateral papers.", tags: ["Bank"] },
    );
  } else if (/bank/.test(n)) {
    specs.push(
      { title: `Bank Account Opening Letter - ${bank}`, ext: "pdf", description: `Account opening confirmation from ${bank}.`, tags: ["Bank"], party: bank },
      { title: "Cancelled Cheque", ext: "png", description: "Cancelled cheque leaf for account verification.", tags: ["Bank"], party: bank },
      { title: "Bank KYC & Signature Card", ext: "pdf", description: "Authorised signatory and KYC documentation.", tags: ["Bank", "Compliance"], party: bank },
    );
  } else if (/petty cash|cash on hand|undeposited/.test(n)) {
    specs.push(
      { title: "Cash Custody Authorization", ext: "pdf", description: "Authority letter for cash custodian.", tags: ["Supporting Document"] },
      { title: "Physical Cash Count Certificate", ext: "pdf", description: "Signed cash count verification.", tags: ["Audit"] },
    );
  } else if (/receivable|debtor|customer/.test(n)) {
    specs.push(
      { title: `Customer Contract - ${customer}`, ext: "pdf", description: `Master sales agreement with ${customer}.`, tags: ["Customer", "Agreement"], party: customer },
      { title: `Signed Purchase Order - ${customer}`, ext: "pdf", description: `Customer PO ${refNo("PO", rnd)}.`, tags: ["Customer"], party: customer },
      { title: `Customer GST Certificate - ${customer}`, ext: "pdf", description: "GST registration certificate on file.", tags: ["GST", "Compliance"], party: customer },
      { title: "Credit Approval Form", ext: "pdf", description: "Internal credit limit approval.", tags: ["Supporting Document"] },
    );
  } else if (/invent|raw material|work in progress|finished goods|stock/.test(n)) {
    specs.push(
      { title: `Purchase Invoice - ${vendor}`, ext: "pdf", description: `Supplier invoice ${refNo("INV", rnd)} for inventory.`, tags: ["Invoice", "Vendor"], party: vendor },
      { title: "Goods Received Note", ext: "png", description: "Scanned GRN acknowledging stock receipt.", tags: ["Supporting Document"], party: vendor },
      { title: `Supplier Agreement - ${vendor}`, ext: "pdf", description: `Supply terms with ${vendor}.`, tags: ["Agreement", "Vendor"], party: vendor },
      { title: "Stock Insurance Policy", ext: "pdf", description: "Insurance cover for inventory in warehouse.", tags: ["Insurance"] },
    );
  } else if (g.includes("fixed asset") || /machinery|equipment|furniture|computer|vehicle|building|plant|land|leasehold|fixture/.test(n)) {
    specs.push(
      { title: `Purchase Invoice - ${vendor}`, ext: "pdf", description: `Capital purchase invoice ${refNo("INV", rnd)}.`, tags: ["Invoice", "Vendor"], party: vendor },
      { title: "Warranty Certificate", ext: "pdf", description: "Manufacturer warranty certificate.", tags: ["Warranty"], party: vendor },
      { title: "AMC Contract", ext: "pdf", description: "Annual maintenance contract.", tags: ["AMC", "Agreement"], party: vendor },
      { title: "Installation Certificate", ext: "pdf", description: "Signed installation & commissioning report.", tags: ["Supporting Document"], party: vendor },
      { title: "Asset Photograph", ext: "png", description: "Photograph of the asset for the fixed-asset register.", tags: ["Asset"] },
    );
  } else if (/gst|vat|input tax|tds|tax/.test(n)) {
    specs.push(
      { title: "GST Registration Certificate", ext: "pdf", description: "GSTIN registration certificate.", tags: ["GST", "Compliance"] },
      { title: "PAN Card", ext: "pdf", description: "Company PAN card copy.", tags: ["Compliance"] },
      { title: "Tax Department Approval Letter", ext: "pdf", description: "Approval / acknowledgement from tax authority.", tags: ["Compliance"] },
    );
  } else if (/prepaid|insurance/.test(n)) {
    specs.push(
      { title: "Insurance Policy Document", ext: "pdf", description: "Policy schedule and terms.", tags: ["Insurance"] },
      { title: "Premium Payment Receipt", ext: "pdf", description: `Premium receipt ${refNo("PR", rnd)}.`, tags: ["Insurance"] },
      { title: "Policy Coverage Schedule", ext: "xlsx", description: "Covered items and sum insured.", tags: ["Insurance"] },
    );
  } else if (/payable|creditor|vendor|supplier/.test(n)) {
    specs.push(
      { title: `Vendor Agreement - ${vendor}`, ext: "pdf", description: `Master service agreement with ${vendor}.`, tags: ["Agreement", "Vendor"], party: vendor },
      { title: `Purchase Invoice - ${vendor}`, ext: "pdf", description: `Vendor invoice ${refNo("INV", rnd)}.`, tags: ["Invoice", "Vendor"], party: vendor },
      { title: `Vendor GST Certificate - ${vendor}`, ext: "pdf", description: "Vendor GST registration on file.", tags: ["GST", "Vendor"], party: vendor },
      { title: "Cancelled Cheque - Vendor", ext: "png", description: "Vendor bank details for payments.", tags: ["Bank", "Vendor"], party: vendor },
    );
  } else if (g.includes("equity") || /capital|equity|share|reserve|retained/.test(n)) {
    specs.push(
      { title: "Share Certificate", ext: "pdf", description: "Issued share certificate.", tags: ["Share Certificate"] },
      { title: "Board Resolution", ext: "pdf", description: "Resolution approving capital / allotment.", tags: ["Board Resolution"] },
      { title: "Certificate of Incorporation", ext: "pdf", description: "Company incorporation certificate.", tags: ["Compliance"] },
      { title: "Shareholders Agreement", ext: "pdf", description: "Signed shareholders agreement.", tags: ["Agreement"] },
    );
  } else if (/salar|wage|payroll|\bpf\b|\besi\b|gratuity|bonus|staff|employee/.test(n)) {
    specs.push(
      { title: "Employment Agreement", ext: "pdf", description: "Signed employment contract (specimen).", tags: ["Agreement"] },
      { title: "PF Registration Certificate", ext: "pdf", description: "Provident Fund registration.", tags: ["Compliance"] },
      { title: "ESI Registration Certificate", ext: "pdf", description: "Employees' State Insurance registration.", tags: ["Compliance"] },
      { title: "Appointment Letter", ext: "pdf", description: "Signed appointment letter (specimen).", tags: ["Supporting Document"] },
    );
  } else if (/rent|lease/.test(n)) {
    specs.push(
      { title: "Lease Agreement", ext: "pdf", description: "Registered lease / rental agreement.", tags: ["Agreement"], party: "Skyline Realty" },
      { title: `Rent Invoice - ${refNo("RENT", rnd)}`, ext: "pdf", description: "Monthly rent invoice from landlord.", tags: ["Invoice"], party: "Skyline Realty" },
      { title: "Landlord PAN Card", ext: "pdf", description: "Landlord PAN for TDS compliance.", tags: ["Compliance"] },
    );
  } else if (/utilit|electric|telephone|internet|water|software|subscription|license|licence/.test(n)) {
    specs.push(
      { title: `Service Agreement - ${vendor}`, ext: "pdf", description: `Service contract with ${vendor}.`, tags: ["Agreement", "Vendor"], party: vendor },
      { title: "Connection / License Letter", ext: "pdf", description: "Service connection or licence document.", tags: ["Compliance"], party: vendor },
      { title: "AMC Contract", ext: "pdf", description: "Annual maintenance / support contract.", tags: ["AMC"], party: vendor },
    );
  } else if (/interest|bank charge|finance cost/.test(n)) {
    specs.push(
      { title: `Loan Sanction Letter - ${bank}`, ext: "pdf", description: "Sanction letter supporting interest charges.", tags: ["Bank"], party: bank },
      { title: "Interest Certificate", ext: "pdf", description: `Bank interest certificate for the year.`, tags: ["Bank"], party: bank },
    );
  } else if (/sales|revenue|income|service/.test(n)) {
    specs.push(
      { title: `Customer Contract - ${customer}`, ext: "pdf", description: `Signed contract with ${customer}.`, tags: ["Customer", "Agreement"], party: customer },
      { title: `Service Agreement - ${customer}`, ext: "pdf", description: "Scope of services agreement.", tags: ["Agreement"], party: customer },
      { title: `Signed Sales Order - ${refNo("SO", rnd)}`, ext: "pdf", description: "Customer-signed sales order.", tags: ["Customer"], party: customer },
    );
  } else if (type === "expense") {
    specs.push(
      { title: `Vendor Purchase Invoice - ${vendor}`, ext: "pdf", description: `Expense invoice ${refNo("INV", rnd)}.`, tags: ["Invoice", "Vendor"], party: vendor },
      { title: `Service Agreement - ${vendor}`, ext: "pdf", description: `Supporting agreement with ${vendor}.`, tags: ["Agreement", "Vendor"], party: vendor },
      { title: "Approval Voucher", ext: "pdf", description: "Internal expense approval voucher.", tags: ["Supporting Document"] },
    );
  } else if (type === "asset") {
    specs.push(
      { title: `Purchase Invoice - ${vendor}`, ext: "pdf", description: `Acquisition invoice ${refNo("INV", rnd)}.`, tags: ["Invoice", "Vendor"], party: vendor },
      { title: "Ownership / Title Document", ext: "pdf", description: "Proof of ownership on file.", tags: ["Supporting Document"] },
    );
  } else {
    return [];
  }

  return specs.slice(0, 5);
}

// ── file byte generators (all produce REAL, valid files) ──────────────────────
function ascii(s: string): string {
  return s.replace(/[₹]/g, "Rs.").replace(/[·—–]/g, "-").replace(/[^\x20-\x7E]/g, "");
}

function buildPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => ascii(s).replace(/([\\()])/g, "\\$1");
  let stream = `BT\n/F1 20 Tf\n60 790 Td\n(${esc(title)}) Tj\n/F2 11 Tf\n`;
  let first = true;
  for (const ln of lines) {
    stream += `${first ? "0 -34" : "0 -16"} Td\n(${esc(ln)}) Tj\n`;
    first = false;
  }
  stream += "ET";
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[5] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  objects[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function buildPng(bg: [number, number, number], band: [number, number, number]): Buffer {
  const w = 520;
  const h = 340;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const bandH = Math.floor(h * 0.17);
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    const inBand = y < bandH;
    // faux "text lines" in the body
    const bodyY = y - bandH - 20;
    const isLine = !inBand && bodyY > 0 && bodyY % 26 < 4;
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      let col = inBand ? band : bg;
      if (isLine && x > w * 0.08 && x < w * (0.55 + ((y % 7) * 0.03))) col = [176, 183, 194];
      raw[p] = col[0];
      raw[p + 1] = col[1];
      raw[p + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function buildXlsx(title: string, header: string[], rows: (string | number)[][]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Verve ERP";
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const head = ws.addRow(header);
  head.font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function generateBytes(spec: DocSpec, account: { code: string; name: string }, rev: number): Promise<Buffer> {
  const stamp = `Generated ${new Date().toLocaleDateString("en-GB")}`;
  if (spec.ext === "png") {
    const isCheque = /cheque/i.test(spec.title);
    return buildPng(isCheque ? [232, 240, 250] : [238, 240, 236], isCheque ? [37, 99, 235] : [16, 122, 90]);
  }
  if (spec.ext === "xlsx") {
    if (/repayment/i.test(spec.title)) {
      return buildXlsx("Repayment Schedule", ["Installment", "Due Date", "Principal (Rs.)", "Interest (Rs.)", "Balance (Rs.)"], Array.from({ length: 8 }, (_, i) => [i + 1, `2024-${String((i % 12) + 1).padStart(2, "0")}-05`, 50000, 8500 - i * 400, 400000 - (i + 1) * 50000]));
    }
    return buildXlsx(spec.title, ["Item", "Description", "Value (Rs.)"], [["1", "Covered item A", 250000], ["2", "Covered item B", 120000], ["3", "Covered item C", 90000]]);
  }
  // PDF
  const lines = [
    spec.description,
    "",
    `GL Account : ${account.code} - ${account.name}`,
    spec.party ? `Counterparty: ${spec.party}` : "Counterparty: -",
    `Reference  : ${spec.title}`,
    rev > 1 ? `Revision   : ${rev}` : "Revision   : 1",
    stamp,
    "",
    "This is a demo supporting document retained for audit purposes.",
    "Verve ERP - Document Management System (demo data).",
  ];
  return buildPdf(spec.title, lines);
}

// ── build a full seeded record (files + manifest) for one GL code ─────────────
const ACCOUNTS = (buildAccounts() as { code: string; name: string; type: string; parent_group: string }[]);
const BY_CODE = new Map(ACCOUNTS.map((a) => [a.code, a]));

export interface DemoSeed {
  files: { storedName: string; buffer: Buffer }[];
  manifest: RecordManifest;
}

export async function seedDemoForCode(code: string): Promise<DemoSeed | null> {
  const acc = BY_CODE.get(code);
  if (!acc) return null;
  const rnd = mulberry32(hashCode(code));
  const specs = docsFor(acc.name, acc.type, acc.parent_group, rnd);
  if (specs.length === 0) return null;

  const now = Date.now();
  const files: { storedName: string; buffer: Buffer }[] = [];
  const metas: AttachmentMeta[] = [];
  const history: HistoryEntry[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const id = `att_demo_${code}_${i}`;
    const fileName = `${spec.title}.${spec.ext}`;
    const contentType = CONTENT_TYPE[spec.ext];
    const uploadedBy = pick(USERS, rnd);
    const daysAgo = 20 + Math.floor(rnd() * 680);
    const at1 = new Date(now - daysAgo * 86_400_000).toISOString();

    const buf1 = await generateBytes(spec, acc, 1);
    const sn1 = `${id}__v1.${spec.ext}`;
    files.push({ storedName: sn1, buffer: buf1 });
    const versions = [{ version: 1, size: buf1.length, storedName: sn1, contentType, uploadedBy, uploadedAt: at1 }];
    history.push({ id: `h_${id}_1`, action: "uploaded", file: fileName, user: uploadedBy, at: at1, detail: "v1" });

    let current = 1;
    let size = buf1.length;
    let modAt = at1;
    let modBy = uploadedBy;
    if (rnd() < 0.22) {
      const at2 = new Date(now - Math.floor(daysAgo * 0.4) * 86_400_000).toISOString();
      const upBy2 = pick(USERS, rnd);
      const buf2 = await generateBytes(spec, acc, 2);
      const sn2 = `${id}__v2.${spec.ext}`;
      files.push({ storedName: sn2, buffer: buf2 });
      versions.push({ version: 2, size: buf2.length, storedName: sn2, contentType, uploadedBy: upBy2, uploadedAt: at2 });
      history.push({ id: `h_${id}_2`, action: "replaced", file: fileName, user: upBy2, at: at2, detail: "v2" });
      current = 2;
      size = buf2.length;
      modAt = at2;
      modBy = upBy2;
    }

    metas.push({
      id,
      name: fileName,
      ext: spec.ext,
      contentType,
      size,
      description: spec.description,
      tags: spec.tags,
      version: current,
      versions,
      uploadedBy,
      uploadedAt: at1,
      modifiedBy: modBy,
      modifiedAt: modAt,
    });
  }

  history.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { files, manifest: { module: "gl", recordId: code, files: metas, history } };
}
