"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Company, Customer, Invoice } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { Icon } from "@/components/icons";

/*
  Report — AR Ageing.
  One row per customer: their unpaid/partial invoice outstandings split into age
  buckets by (today - due_date): Not due, 0–30, 31–60, 61–90, 90+ days, plus a
  Total column and a grand-total row. Worst offenders float to the top and the
  older buckets are tinted red. Print-ready (sidebar/header hide on print).

  Outstanding = invoice.total - sum of its receipt_allocations.amount.
  Ageing is invoice-based (documents with due dates); opening balances aren't aged.
*/

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const dmed = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

/** Bucket columns, oldest-most-severe last. `dot` tints the header + heavy cells. */
const BUCKETS = [
  { key: "notDue", label: "Not due", dot: "bg-slate-300 dark:bg-slate-600", heavy: false },
  { key: "d0_30", label: "0–30 days", dot: "bg-amber-400", heavy: false },
  { key: "d31_60", label: "31–60 days", dot: "bg-orange-400", heavy: false },
  { key: "d61_90", label: "61–90 days", dot: "bg-red-400", heavy: true },
  { key: "d90", label: "90+ days", dot: "bg-red-600", heavy: true },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

interface AgeRow {
  id: string;
  code: string;
  name: string;
  notDue: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90: number;
  total: number;
}

const emptyBuckets = () => ({ notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 });

export default function AgeingReportPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [rows, setRows] = useState<AgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const [coRes, custRes, invRes, allocRes] = await Promise.all([
      supabase.from("company").select("*").limit(1),
      supabase.from("customers").select("id, code, name"),
      supabase.from("invoices").select("id, customer_id, due_date, total, status"),
      supabase.from("receipt_allocations").select("invoice_id, amount"),
    ]);
    const firstError = coRes.error || custRes.error || invRes.error || allocRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    setCompany((coRes.data?.[0] as Company) ?? null);

    const paidByInvoice = new Map<string, number>();
    for (const a of (allocRes.data ?? []) as { invoice_id: string; amount: number }[]) {
      paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const byCustomer = new Map<string, ReturnType<typeof emptyBuckets>>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const inv of (invRes.data ?? []) as Pick<Invoice, "id" | "customer_id" | "due_date" | "total" | "status">[]) {
      if (inv.status === "paid") continue;
      const outstanding = Number(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0) continue;

      const due = new Date(`${inv.due_date}T00:00:00`);
      const b = byCustomer.get(inv.customer_id) ?? emptyBuckets();
      let bucket: BucketKey;
      if (due >= today) {
        bucket = "notDue";
      } else {
        const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
        bucket = days <= 30 ? "d0_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90";
      }
      b[bucket] += outstanding;
      b.total += outstanding;
      byCustomer.set(inv.customer_id, b);
    }

    const custById = new Map<string, Pick<Customer, "id" | "code" | "name">>();
    for (const c of (custRes.data ?? []) as Pick<Customer, "id" | "code" | "name">[]) custById.set(c.id, c);

    const list: AgeRow[] = [...byCustomer.entries()]
      .filter(([, b]) => b.total > 0)
      .map(([cid, b]) => {
        const c = custById.get(cid);
        return { id: cid, code: c?.code ?? "—", name: c?.name ?? "Unknown", ...b };
      })
      .sort((a, b) => b.total - a.total);

    setRows(list);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const t = emptyBuckets();
    for (const r of rows) {
      t.notDue += r.notDue;
      t.d0_30 += r.d0_30;
      t.d31_60 += r.d31_60;
      t.d61_90 += r.d61_90;
      t.d90 += r.d90;
      t.total += r.total;
    }
    return t;
  }, [rows]);

  const overdueTotal = totals.total - totals.notDue;

  if (!supabase) return <NotConfigured />;

  const cell = (v: number, heavy: boolean) =>
    v === 0 ? (
      <span className="text-slate-300 dark:text-slate-600">—</span>
    ) : (
      <span className={heavy ? "font-semibold text-red-600 dark:text-red-400" : ""}>{inr.format(v)}</span>
    );

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="AR Ageing"
          subtitle="Who owes what, and how late — outstanding split into age buckets."
          action={
            rows.length > 0 && (
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                <Icon name="download" size={17} />
                Print / Save as PDF
              </button>
            )
          }
        />
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Summary tiles */}
        {!loading && rows.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Total outstanding" value={inr.format(totals.total)} />
            <Tile label="Overdue (past due)" value={inr.format(overdueTotal)} accent="red" />
            <Tile label="90+ days" value={inr.format(totals.d90)} accent="red" sub="worst bucket" />
            <Tile label="Customers with dues" value={String(rows.length)} />
          </div>
        )}
      </div>

      {/* Print-only heading */}
      <div className="mb-4 hidden print:block">
        <h2 className="text-lg font-bold text-black">{company?.name ?? "AR Ageing"}</h2>
        <p className="text-sm text-slate-600">AR Ageing report · as at {dmed.format(new Date())}</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Building the ageing report…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Nothing outstanding — every customer is paid up. 🎉
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 print:rounded-none print:border-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50 print:bg-slate-100">
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 print:text-black">Customer</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 print:text-black">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 flex-none rounded-full ${b.dot}`} />
                      {b.label}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200 print:text-black">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/reports/statement?customer=${r.id}`}
                      className="font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-200 print:text-black print:no-underline"
                      title="Open account statement"
                    >
                      {r.name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-400">{r.code}</span>
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 print:text-black">
                      {cell(r[b.key], b.heavy)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white print:text-black">
                    {inr.format(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800/50 print:bg-slate-100">
                <td className="px-4 py-3 text-slate-800 dark:text-white print:text-black">Grand total</td>
                {BUCKETS.map((b) => (
                  <td key={b.key} className="px-4 py-3 text-right text-slate-800 dark:text-slate-100 print:text-black">
                    {totals[b.key] === 0 ? <span className="text-slate-300 dark:text-slate-600">—</span> : inr.format(totals[b.key])}
                  </td>
                ))}
                <td className="px-4 py-3 text-right text-brand print:text-black">{inr.format(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <p className="mt-3 text-xs text-slate-400 print:text-slate-500">
          Ageing by due date · as at {dmed.format(new Date())} · outstanding = invoice total minus receipts allocated to it.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "red" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${accent === "red" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
