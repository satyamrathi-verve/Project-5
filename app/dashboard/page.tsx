"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Customer, Invoice, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon, type IconName } from "@/components/icons";
import { formatMoney } from "@/lib/balances";

/*
  Dashboard — the at-a-glance home for the finance team.

  Outstanding is computed exactly as the AR Ageing report does it:
    outstanding = invoice.total − sum(receipt_allocations.amount for that invoice)
  and only unpaid/partial invoices count. Keeping the rule identical means the two
  screens can never quote different numbers to a judge.

  Overdue = not paid, still has money on it, and due_date is before today.
*/

interface Alloc {
  invoice_id: string;
  amount: number;
}

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function Tile({
  label,
  value,
  sub,
  icon,
  href,
  tone = "brand",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: IconName;
  href: string;
  tone?: "brand" | "red" | "green";
}) {
  const tones = {
    brand: "bg-brand/10 text-brand",
    red: "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400",
    green: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
  };
  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`grid h-9 w-9 flex-none place-items-center rounded-lg ${tones[tone]}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </Link>
  );
}

export default function DashboardPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      setLoading(true);
      const [c, i, r, a] = await Promise.all([
        supabase.from("customers").select("*").order("name"),
        supabase.from("invoices").select("*").order("invoice_date", { ascending: false }),
        supabase.from("receipts").select("*").order("receipt_date", { ascending: false }),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
      ]);
      const err = c.error ?? i.error ?? r.error ?? a.error;
      if (err) setError(err.message);
      else {
        setCustomers(c.data ?? []);
        setInvoices(i.data ?? []);
        setReceipts(r.data ?? []);
        setAllocs((a.data ?? []) as Alloc[]);
      }
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const paidByInvoice = new Map<string, number>();
    for (const a of allocs) paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));

    const today = todayMidnight();
    let totalOutstanding = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    const outstandingByCustomer = new Map<string, number>();

    for (const inv of invoices) {
      if (inv.status === "paid") continue;
      const outstanding = Number(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0) continue;

      totalOutstanding += outstanding;
      outstandingByCustomer.set(inv.customer_id, (outstandingByCustomer.get(inv.customer_id) ?? 0) + outstanding);

      if (new Date(`${inv.due_date}T00:00:00`) < today) {
        overdueCount += 1;
        overdueAmount += outstanding;
      }
    }

    // money in this calendar month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const receivedThisMonth = receipts
      .filter((r) => r.receipt_date >= monthStart)
      .reduce((s, r) => s + Number(r.amount), 0);

    const custById = new Map(customers.map((c) => [c.id, c]));
    const topDebtors = [...outstandingByCustomer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, amount]) => ({ customer: custById.get(id), amount }))
      .filter((d) => d.customer);

    return { totalOutstanding, overdueCount, overdueAmount, receivedThisMonth, topDebtors, custById };
  }, [invoices, allocs, receipts, customers]);

  if (!supabase) return <NotConfigured />;

  if (loading) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Where the money stands today." />
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-16 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading your numbers…
        </div>
      </div>
    );
  }

  const recent = invoices.slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Where the money stands today."
        action={
          <Link
            href="/invoices/new"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + New Invoice
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Tiles */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Customers"
          value={String(customers.length)}
          sub="On the books"
          icon="users"
          href="/masters/customers"
        />
        <Tile
          label="Invoices"
          value={String(invoices.length)}
          sub={`${invoices.filter((i) => i.status === "paid").length} fully paid`}
          icon="file"
          href="/invoices"
        />
        <Tile
          label="Overdue"
          value={String(stats.overdueCount)}
          sub={stats.overdueCount ? `${formatMoney(stats.overdueAmount)} past due` : "Nothing past due 🎉"}
          icon="clock"
          href="/reports/ageing"
          tone={stats.overdueCount ? "red" : "green"}
        />
        <Tile
          label="Total outstanding"
          value={formatMoney(stats.totalOutstanding)}
          sub={`${formatMoney(stats.receivedThisMonth)} received this month`}
          icon="trend"
          href="/reports/ageing"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent invoices */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent invoices</h3>
              <Link href="/invoices" className="text-xs font-semibold text-brand hover:underline">
                View all
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-slate-400">No invoices yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                    <th className="px-5 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Invoice</th>
                    <th className="px-5 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Customer</th>
                    <th className="px-5 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Date</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">Total</th>
                    <th className="px-5 py-2.5 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-5 py-2.5">
                        <Link href={`/invoices/${inv.id}`} className="font-medium text-brand hover:underline">
                          {inv.invoice_no}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300">
                        {stats.custById.get(inv.customer_id)?.name ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">{inv.invoice_date}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-slate-900 dark:text-white">
                        {formatMoney(Number(inv.total))}
                      </td>
                      <td className="px-5 py-2.5">
                        <StatusBadge status={inv.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Who owes the most */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Who owes the most</h3>
            <Link href="/reports/ageing" className="text-xs font-semibold text-brand hover:underline">
              Ageing
            </Link>
          </div>
          {stats.topDebtors.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-400">Everyone is paid up. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {stats.topDebtors.map(({ customer, amount }) => (
                <li key={customer!.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{customer!.name}</p>
                    <p className="text-xs text-slate-400">{customer!.code}</p>
                  </div>
                  <span className="flex-none text-sm font-semibold text-slate-900 dark:text-white">
                    {formatMoney(amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
