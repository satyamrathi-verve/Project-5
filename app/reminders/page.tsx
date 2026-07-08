"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Customer, Invoice, ReminderTemplate } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";

/*
  AR Followup — Auto Email Shoot.
  Finds every overdue invoice, builds a personalised reminder from the saved
  template (reminder_templates), and "sends" them by logging one row per email
  into reminder_log. No real mailbox — the sent list IS the proof it worked.

  Overdue      = not fully paid AND due_date < today AND outstanding > 0.
  Outstanding  = invoice.total - sum of its receipt_allocations.amount.
  days_overdue = today - due_date, in whole days.
*/

/* ₹45,000 for display; 45,000 (no symbol) for the {amount} placeholder. */
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** One generated reminder, ready to send. */
interface Reminder {
  id: string; // the invoice id — also what we log against
  invoice_no: string;
  customer_name: string;
  to_email: string | null;
  outstanding: number;
  days_overdue: number;
  subject: string;
  body: string;
}

/** Swap the template placeholders for this invoice's real values. */
function fillTemplate(
  text: string,
  vars: { customer: string; amount: string; days_overdue: number; invoice_no: string }
): string {
  return text
    .split("{customer}").join(vars.customer)
    .split("{amount}").join(vars.amount)
    .split("{days_overdue}").join(String(vars.days_overdue))
    .split("{invoice_no}").join(vars.invoice_no);
}

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ReminderTemplate | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Reminder[] | null>(null);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setSent(null);
    setPreviewId(null);

    const [tplRes, custRes, invRes, allocRes] = await Promise.all([
      supabase.from("reminder_templates").select("*").order("name").limit(1),
      supabase.from("customers").select("id, name, email"),
      supabase.from("invoices").select("id, invoice_no, customer_id, due_date, total, status"),
      supabase.from("receipt_allocations").select("invoice_id, amount"),
    ]);

    const firstError = tplRes.error || custRes.error || invRes.error || allocRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const tpl = (tplRes.data?.[0] as ReminderTemplate) ?? null;
    setTemplate(tpl);

    // Sum how much has been knocked off each invoice.
    const paidByInvoice = new Map<string, number>();
    for (const a of (allocRes.data ?? []) as { invoice_id: string; amount: number }[]) {
      paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const custById = new Map<string, Pick<Customer, "id" | "name" | "email">>();
    for (const c of (custRes.data ?? []) as Pick<Customer, "id" | "name" | "email">[]) {
      custById.set(c.id, c);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const list: Reminder[] = [];
    for (const inv of (invRes.data ?? []) as Pick<
      Invoice,
      "id" | "invoice_no" | "customer_id" | "due_date" | "total" | "status"
    >[]) {
      if (inv.status === "paid") continue;
      const due = new Date(`${inv.due_date}T00:00:00`);
      if (!(due < today)) continue; // not yet overdue
      const outstanding = Number(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0) continue;

      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      const cust = custById.get(inv.customer_id);
      const customerName = cust?.name ?? "Customer";
      const vars = {
        customer: customerName,
        amount: num.format(outstanding),
        days_overdue: daysOverdue,
        invoice_no: inv.invoice_no,
      };
      list.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        customer_name: customerName,
        to_email: cust?.email ?? null,
        outstanding,
        days_overdue: daysOverdue,
        subject: tpl ? fillTemplate(tpl.subject, vars) : "",
        body: tpl ? fillTemplate(tpl.body, vars) : "",
      });
    }

    // Worst offenders first.
    list.sort((a, b) => b.days_overdue - a.days_overdue);
    setReminders(list);
    setSelected(new Set(list.map((r) => r.id)));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalOutstanding = useMemo(
    () => reminders.reduce((s, r) => s + r.outstanding, 0),
    [reminders]
  );

  if (!supabase) return <NotConfigured />;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = reminders.length > 0 && selected.size === reminders.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(reminders.map((r) => r.id)));
  }

  async function sendAll() {
    if (!supabase) return;
    const toSend = reminders.filter((r) => selected.has(r.id));
    if (toSend.length === 0) return;
    setSending(true);
    setError(null);
    const payload = toSend.map((r) => ({
      invoice_id: r.id,
      to_email: r.to_email,
      subject: r.subject,
      body: r.body,
      status: "sent",
    }));
    const { error } = await supabase.from("reminder_log").insert(payload);
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(toSend);
  }

  const preview = previewId ? reminders.find((r) => r.id === previewId) ?? null : null;

  const columns: Column<Reminder>[] = [
    {
      key: "select",
      header: "",
      className: "w-10",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          className="h-4 w-4 cursor-pointer accent-brand"
          aria-label={`Select ${r.customer_name}`}
        />
      ),
    },
    { key: "customer_name", header: "Customer", className: "font-medium" },
    {
      key: "to_email",
      header: "Email",
      render: (r) =>
        r.to_email ?? <span className="text-slate-400 dark:text-slate-500">no email on file</span>,
    },
    { key: "invoice_no", header: "Invoice", className: "w-28" },
    {
      key: "days_overdue",
      header: "Days Overdue",
      className: "text-right w-32",
      render: (r) => (
        <span className="font-medium text-red-600 dark:text-red-400">{r.days_overdue}</span>
      ),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right w-36",
      render: (r) => inr.format(r.outstanding),
    },
    {
      key: "preview",
      header: "",
      className: "w-20 text-right",
      render: (r) => (
        <button
          onClick={() => setPreviewId(r.id)}
          className="text-sm font-medium text-brand hover:underline"
        >
          Preview
        </button>
      ),
    },
  ];

  /* ---- Sent confirmation view ---- */
  if (sent) {
    const sentColumns: Column<Reminder>[] = [
      { key: "customer_name", header: "Customer", className: "font-medium" },
      {
        key: "to_email",
        header: "Email",
        render: (r) => r.to_email ?? <span className="text-slate-400">—</span>,
      },
      { key: "invoice_no", header: "Invoice", className: "w-28" },
      { key: "subject", header: "Subject" },
      {
        key: "status",
        header: "Status",
        className: "w-24",
        render: () => (
          <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
            Sent
          </span>
        ),
      },
    ];
    return (
      <div>
        <PageHeader
          title="Auto Email Shoot"
          subtitle="Reminders sent — every one below was logged to the reminders table."
          action={
            <button
              onClick={load}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Back to overdue list
            </button>
          }
        />
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
          <span className="text-base">✓</span>
          Sent {sent.length} reminder{sent.length === 1 ? "" : "s"}.
        </div>
        <DataTable columns={sentColumns} rows={sent} empty="Nothing sent." />
      </div>
    );
  }

  /* ---- Compose / shoot view ---- */
  return (
    <div>
      <PageHeader
        title="Auto Email Shoot"
        subtitle="Chase every overdue customer in one go — review, then send."
        action={
          <button
            onClick={sendAll}
            disabled={sending || selected.size === 0 || !template}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : `Send ${selected.size} reminder${selected.size === 1 ? "" : "s"}`}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !template && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No reminder template found. Add one to the <code className="rounded bg-amber-100 px-1">reminder_templates</code> table first.
        </div>
      )}

      {/* Summary strip */}
      {!loading && reminders.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-white">{reminders.length}</span> overdue invoice{reminders.length === 1 ? "" : "s"}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-white">{inr.format(totalOutstanding)}</span> total outstanding
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-white">{selected.size}</span> selected
          </span>
          <button
            onClick={toggleAll}
            className="ml-auto text-sm font-medium text-brand hover:underline"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
      )}

      {/* Email preview card */}
      {preview && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Email preview
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                To: <span className="font-medium text-slate-700 dark:text-slate-200">
                  {preview.customer_name}
                  {preview.to_email ? ` <${preview.to_email}>` : " (no email on file)"}
                </span>
              </p>
            </div>
            <button
              onClick={() => setPreviewId(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700 dark:text-slate-300">
            {preview.body}
          </pre>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Finding overdue invoices…
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={reminders}
          empty="No overdue invoices — everyone's paid up. 🎉"
        />
      )}
    </div>
  );
}
