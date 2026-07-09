"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import { parseCsv, toCsv, normaliseHeader } from "@/lib/csv";
import { downloadBlob, fileToCsvText } from "@/lib/import-template";
import { formatMoney } from "@/lib/balances";
import { gstinError, panError, emailError, dateError, numberError } from "@/lib/validation";

/*
  Upload Report — bulk-import Customers or Invoices from a CSV/Excel file.
  The team uploads a file, sees every parsed row with its errors called out,
  fixes bad cells inline, then imports only the rows that are valid.
*/

type ImportType = "customers" | "invoices";

interface Field {
  key: string;
  label: string;
  required?: boolean;
  /** Right-align + treat as a number in the preview. */
  numeric?: boolean;
  width?: string;
}

/*
  Columns mirror what the manual forms ask for, so a record is held to the same
  standard whichever door it comes through:
    • Customer Master form  → code + name required; GSTIN/PAN/email format-checked.
    • Invoice Punch form    → invoice no, date, customer, due date and at least
      one line item required. Hence `description` is required here: every imported
      invoice gets a real line item, exactly like a punched one.
*/
const FIELDS: Record<ImportType, Field[]> = {
  customers: [
    { key: "code", label: "Code", required: true, width: "w-28" },
    { key: "name", label: "Name", required: true },
    { key: "gstin", label: "GSTIN", width: "w-40" },
    { key: "pan", label: "PAN", width: "w-32" },
    { key: "contact_person", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone", width: "w-36" },
    { key: "credit_days", label: "Credit Days", numeric: true, width: "w-28" },
    { key: "credit_limit", label: "Credit Limit", numeric: true, width: "w-32" },
    { key: "opening_balance", label: "Opening Bal.", numeric: true, width: "w-32" },
  ],
  invoices: [
    { key: "invoice_no", label: "Invoice No", required: true, width: "w-32" },
    { key: "invoice_date", label: "Invoice Date", required: true, width: "w-36" },
    { key: "customer_code", label: "Customer Code", required: true, width: "w-32" },
    { key: "due_date", label: "Due Date", width: "w-36" },
    { key: "description", label: "Line Item", required: true },
    { key: "subtotal", label: "Subtotal", required: true, numeric: true, width: "w-32" },
    { key: "tax_amount", label: "Tax", numeric: true, width: "w-28" },
    { key: "notes", label: "Notes" },
  ],
};

const SAMPLE: Record<ImportType, string[][]> = {
  customers: [
    ["CUST900", "Aurora Textiles Pvt Ltd", "27AABCS1111A1Z1", "AABCS1111A", "Ritu Shah", "ritu@aurora.example", "9820011223", "30", "500000", "0"],
    ["CUST901", "Bluewave Logistics", "", "", "Imran Khan", "imran@bluewave.example", "9820044556", "45", "250000", "0"],
    ["", "Missing Code Ltd", "BADGSTIN", "", "Nobody", "not-an-email", "", "abc", "100000", "0"],
  ],
  invoices: [
    ["INV-9001", "2026-06-01", "CUST001", "", "Advisory retainer — June", "50000", "9000", ""],
    ["INV-9002", "2026-06-15", "CUST002", "", "Implementation phase 1", "22000", "3960", ""],
    ["INV-9003", "2026-06-20", "NOSUCH", "", "", "18000", "3240", "Bad customer code, no line item"],
  ],
};

interface Row {
  id: string;
  cells: Record<string, string>;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function UploadReportPage() {
  const [type, setType] = useState<ImportType>("customers");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [existingInvoiceNos, setExistingInvoiceNos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = FIELDS[type];

  async function loadReference() {
    if (!supabase) return;
    setLoading(true);
    const [c, i] = await Promise.all([
      supabase.from("customers").select("*").order("code"),
      supabase.from("invoices").select("invoice_no"),
    ]);
    if (c.error || i.error) setError((c.error ?? i.error)!.message);
    else {
      setCustomers(c.data ?? []);
      setExistingInvoiceNos(new Set((i.data ?? []).map((r) => String(r.invoice_no).toLowerCase())));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadReference();
  }, []);

  const customerByCode = useMemo(
    () => new Map(customers.map((c) => [c.code.toLowerCase(), c])),
    [customers],
  );
  const existingCustomerCodes = useMemo(
    () => new Set(customers.map((c) => c.code.toLowerCase())),
    [customers],
  );

  /** rowId -> { field -> problem }. Recomputed on every edit so fixes clear instantly. */
  const errorsByRow = useMemo(() => {
    const out = new Map<string, Record<string, string>>();
    const seen = new Map<string, number>(); // duplicate key -> first row index

    rows.forEach((row, idx) => {
      const e: Record<string, string> = {};
      const get = (k: string) => (row.cells[k] ?? "").trim();

      for (const f of fields) {
        if (f.required && !get(f.key)) e[f.key] = "Required";
      }

      /** Record a validator's message against a field, if it produced one. */
      const check = (key: string, msg: string | null) => {
        if (msg && !e[key]) e[key] = msg;
      };

      if (type === "customers") {
        const code = get("code").toLowerCase();
        if (code) {
          if (existingCustomerCodes.has(code)) e.code = "Already exists";
          else if (seen.has(code) && seen.get(code) !== idx) e.code = "Duplicate in file";
          else seen.set(code, idx);
        }
        check("gstin", gstinError(get("gstin")));
        check("pan", panError(get("pan")));
        check("email", emailError(get("email")));
        check("credit_days", numberError(get("credit_days")));
        check("credit_limit", numberError(get("credit_limit")));
        check("opening_balance", numberError(get("opening_balance")));
      } else {
        const no = get("invoice_no").toLowerCase();
        if (no) {
          if (existingInvoiceNos.has(no)) e.invoice_no = "Already exists";
          else if (seen.has(no) && seen.get(no) !== idx) e.invoice_no = "Duplicate in file";
          else seen.set(no, idx);
        }
        check("invoice_date", dateError(get("invoice_date")));
        check("due_date", dateError(get("due_date")));
        const cust = get("customer_code");
        if (cust && !customerByCode.has(cust.toLowerCase())) e.customer_code = "No such customer";
        check("subtotal", numberError(get("subtotal")));
        check("tax_amount", numberError(get("tax_amount")));
      }

      if (Object.keys(e).length) out.set(row.id, e);
    });
    return out;
  }, [rows, fields, type, existingCustomerCodes, existingInvoiceNos, customerByCode]);

  const validRows = rows.filter((r) => !errorsByRow.has(r.id));
  const badCount = rows.length - validRows.length;

  if (!supabase) return <NotConfigured />;

  function resetPreview() {
    setRows([]);
    setFileName("");
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function switchType(t: ImportType) {
    setType(t);
    resetPreview();
  }

  /** Turn parsed CSV rows into our field-keyed rows, matching headers loosely. */
  function ingest(text: string, name: string) {
    const table = parseCsv(text);
    if (table.length === 0) {
      setError("That file looks empty.");
      return;
    }
    const header = table[0].map(normaliseHeader);
    // map each expected field to the column index it was found at
    const indexOf: Record<string, number> = {};
    for (const f of fields) {
      const i = header.indexOf(normaliseHeader(f.key));
      indexOf[f.key] = i >= 0 ? i : header.indexOf(normaliseHeader(f.label));
    }
    const found = fields.filter((f) => indexOf[f.key] >= 0);
    if (found.length === 0) {
      setError(
        `None of the expected columns were found. The first row should be headers like: ${fields.map((f) => f.key).join(", ")}`,
      );
      return;
    }

    const parsed: Row[] = table.slice(1).map((cells, i) => {
      const rec: Record<string, string> = {};
      for (const f of fields) {
        const idx = indexOf[f.key];
        rec[f.key] = idx >= 0 ? (cells[idx] ?? "").trim() : "";
      }
      return { id: `r${i}`, cells: rec };
    });

    setRows(parsed);
    setFileName(name);
    setError(null);
    setResult(null);
  }

  async function onFile(file: File) {
    try {
      const text = await fileToCsvText(file);
      ingest(text, file.name);
    } catch (err) {
      setError(`Could not read that file: ${(err as Error).message}`);
    }
  }

  function loadSample() {
    ingest(toCsv(fields.map((f) => f.key), SAMPLE[type]), "sample.csv");
  }

  function downloadTemplate() {
    const csv = toCsv(fields.map((f) => f.key), []);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${type}-template.csv`);
  }

  function editCell(rowId: string, key: string, value: string) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
  }

  function removeRow(rowId: string) {
    setRows((rs) => rs.filter((r) => r.id !== rowId));
  }

  async function runImport() {
    if (!supabase || validRows.length === 0) return;
    setImporting(true);
    setError(null);

    const cell = (r: Row, k: string) => (r.cells[k] ?? "").trim();

    if (type === "customers") {
      const payload = validRows.map((r) => ({
        code: cell(r, "code"),
        name: cell(r, "name"),
        gstin: cell(r, "gstin").toUpperCase() || null,
        pan: cell(r, "pan").toUpperCase() || null,
        contact_person: cell(r, "contact_person") || null,
        email: cell(r, "email") || null,
        phone: cell(r, "phone") || null,
        credit_days: Number(cell(r, "credit_days")) || 0,
        credit_limit: Number(cell(r, "credit_limit")) || 0,
        opening_balance: Number(cell(r, "opening_balance")) || 0,
      }));
      const { error: insErr } = await supabase.from("customers").insert(payload);
      setImporting(false);
      if (insErr) {
        setError(`Import failed — nothing was saved. ${insErr.message}`);
        return;
      }
      setResult(`Imported ${payload.length} customer${payload.length > 1 ? "s" : ""} successfully.`);
    } else {
      // Derive due date, total and status from the same rules the punch form uses.
      const payload = validRows.map((r) => {
        const cust = customerByCode.get(cell(r, "customer_code").toLowerCase())!;
        const invoiceDate = cell(r, "invoice_date");
        const dueDate = cell(r, "due_date") || addDays(invoiceDate, cust.credit_days ?? 0);
        const subtotal = Number(cell(r, "subtotal")) || 0;
        const tax = Number(cell(r, "tax_amount")) || 0;
        return {
          invoice_no: cell(r, "invoice_no"),
          invoice_date: invoiceDate,
          customer_id: cust.id,
          due_date: dueDate,
          subtotal,
          tax_amount: tax,
          total: subtotal + tax,
          status: dueDate < today() ? "overdue" : "open",
          notes: cell(r, "notes") || null,
        };
      });

      // Insert invoices, then give each one its line item — a punched invoice always
      // has at least one, so an imported one must too.
      const { data: inserted, error: insErr } = await supabase.from("invoices").insert(payload).select("id,invoice_no");
      if (insErr || !inserted) {
        setImporting(false);
        setError(`Import failed — nothing was saved. ${insErr?.message ?? "No rows returned."}`);
        return;
      }

      const idByNo = new Map(inserted.map((i) => [i.invoice_no, i.id]));
      const items = validRows.map((r) => {
        const subtotal = Number(cell(r, "subtotal")) || 0;
        return {
          invoice_id: idByNo.get(cell(r, "invoice_no"))!,
          description: cell(r, "description"),
          qty: 1,
          rate: subtotal,
          amount: subtotal,
        };
      });
      const { error: itemErr } = await supabase.from("invoice_items").insert(items);
      setImporting(false);
      if (itemErr) {
        setError(
          `Invoices were saved, but their line items failed: ${itemErr.message}. Open the affected invoices and add the line item by hand.`,
        );
        return;
      }
      setResult(`Imported ${payload.length} invoice${payload.length > 1 ? "s" : ""}, each with its line item.`);
    }
    setRows([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
    loadReference();
  }

  const totalValue =
    type === "invoices"
      ? validRows.reduce((s, r) => s + (Number(r.cells.subtotal) || 0) + (Number(r.cells.tax_amount) || 0), 0)
      : 0;

  return (
    <div>
      <PageHeader
        title="Upload Report"
        subtitle="Bulk-import customers or invoices from a CSV or Excel file."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}
      {result && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300">
          {result}
        </div>
      )}

      {/* Step 1 — pick what you're importing */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          1 · What are you importing?
        </h3>
        <div className="mb-5 flex gap-2">
          {(["customers", "invoices"] as ImportType[]).map((t) => (
            <button
              key={t}
              onClick={() => switchType(t)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize transition ${
                type === t
                  ? "bg-brand text-white"
                  : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          2 · Choose your file
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            className="text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90 dark:text-slate-400"
          />
          <button
            onClick={downloadTemplate}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Download blank template
          </button>
          <button
            onClick={loadSample}
            className="rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand hover:text-white"
          >
            Try a sample file
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Expected columns: {fields.map((f) => f.key + (f.required ? "*" : "")).join(", ")} — * required.
          {type === "invoices" && " Due date, total and status are worked out for you from the customer's credit days."}
        </p>
      </div>

      {/* Step 2 — preview & fix */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                3 · Check the rows {fileName && <span className="normal-case text-slate-400">· {fileName}</span>}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-green-600 dark:text-green-400">{validRows.length} ready</span>
                {badCount > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-red-600 dark:text-red-400">{badCount} need fixing</span>
                  </>
                )}
                {type === "invoices" && validRows.length > 0 && <> · worth {formatMoney(totalValue)}</>}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetPreview}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Clear
              </button>
              <button
                onClick={runImport}
                disabled={importing || validRows.length === 0}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {importing ? "Importing…" : `Import ${validRows.length} row${validRows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {badCount > 0 && (
            <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Rows with a red cell won&apos;t be imported. Type over the cell to fix it, or delete the row.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                  <th className="w-12 px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">#</th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className={`px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 ${f.width ?? ""}`}
                    >
                      {f.label}
                      {f.required && <span className="text-red-500"> *</span>}
                    </th>
                  ))}
                  <th className="w-16 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const errs = errorsByRow.get(row.id) ?? {};
                  const ok = Object.keys(errs).length === 0;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                        ok ? "" : "bg-red-50/50 dark:bg-red-950/20"
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      {fields.map((f) => (
                        <td key={f.key} className="px-3 py-2">
                          <input
                            className={`w-full rounded-md border px-2 py-1 text-sm outline-none transition ${
                              f.numeric ? "text-right" : ""
                            } ${
                              errs[f.key]
                                ? "border-red-400 bg-white text-slate-800 focus:ring-1 focus:ring-red-500 dark:bg-slate-800 dark:text-slate-100"
                                : "border-transparent bg-transparent text-slate-700 hover:border-slate-300 focus:border-brand focus:ring-1 focus:ring-brand dark:text-slate-300 dark:hover:border-slate-600"
                            }`}
                            value={row.cells[f.key] ?? ""}
                            onChange={(e) => editCell(row.id, f.key, e.target.value)}
                            title={errs[f.key] ?? ""}
                          />
                          {errs[f.key] && (
                            <span className="mt-0.5 block text-[11px] font-medium text-red-600 dark:text-red-400">
                              {errs[f.key]}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeRow(row.id)}
                          className="text-xs font-medium text-slate-400 hover:text-red-500"
                          title="Remove this row"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && !loading && !result && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-slate-400 dark:border-slate-700 dark:bg-slate-900">
          Pick a file above to see its rows here before anything is saved.
        </div>
      )}
    </div>
  );
}
