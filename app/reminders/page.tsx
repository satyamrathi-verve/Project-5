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

  Smarts on top:
  - Reminder history: reads reminder_log to show when each invoice was last
    chased and how many times, and auto-unticks anything chased in the last few
    days so you don't spam the same customer.
  - Ageing severity: each row is tinted by how late it is (0–30 → 90+).
  - Sent history: a second view listing every reminder ever logged.
*/

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** Don't re-chase anything reminded within this many days (auto-unticked). */
const RECENT_DAYS = 3;

interface Reminder {
  id: string; // the invoice id — also what we log against
  invoice_no: string;
  customer_name: string;
  to_email: string | null;
  outstanding: number;
  days_overdue: number;
  times_reminded: number;
  days_since_reminded: number | null; // null = never chased
  subject: string;
  body: string;
}

interface HistoryRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  to_email: string | null;
  subject: string | null;
  status: string;
  sent_at: string;
}

/** Ageing bucket → label + tints, matching an AR ageing report. */
function ageing(days: number) {
  if (days <= 30)
    return { label: "0–30 days", dot: "bg-amber-400", row: "bg-amber-50/70 dark:bg-amber-500/[0.07]", text: "text-amber-600 dark:text-amber-400" };
  if (days <= 60)
    return { label: "31–60 days", dot: "bg-orange-400", row: "bg-orange-50/80 dark:bg-orange-500/[0.08]", text: "text-orange-600 dark:text-orange-400" };
  if (days <= 90)
    return { label: "61–90 days", dot: "bg-red-400", row: "bg-red-50/80 dark:bg-red-500/[0.09]", text: "text-red-600 dark:text-red-400" };
  return { label: "90+ days", dot: "bg-red-600", row: "bg-red-100/80 dark:bg-red-500/[0.16]", text: "font-semibold text-red-700 dark:text-red-400" };
}

const BUCKETS = [
  { label: "0–30 days", dot: "bg-amber-400" },
  { label: "31–60 days", dot: "bg-orange-400" },
  { label: "61–90 days", dot: "bg-red-400" },
  { label: "90+ days", dot: "bg-red-600" },
];

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
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [view, setView] = useState<"compose" | "history">("compose");

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Reminder[] | null>(null);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setSent(null);
    setPreviewId(null);

    const [tplRes, custRes, invRes, allocRes, logRes] = await Promise.all([
      supabase.from("reminder_templates").select("*").order("name").limit(1),
      supabase.from("customers").select("id, name, email"),
      supabase.from("invoices").select("id, invoice_no, customer_id, due_date, total, status"),
      supabase.from("receipt_allocations").select("invoice_id, amount"),
      supabase.from("reminder_log").select("invoice_id, to_email, subject, status, sent_at").order("sent_at", { ascending: false }),
    ]);

    const firstError = tplRes.error || custRes.error || invRes.error || allocRes.error || logRes.error;
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

    const invById = new Map<string, { invoice_no: string; customer_id: string }>();
    for (const inv of (invRes.data ?? []) as Pick<Invoice, "id" | "invoice_no" | "customer_id">[]) {
      invById.set(inv.id, { invoice_no: inv.invoice_no, customer_id: inv.customer_id });
    }

    // Reminder history per invoice: how many times, and when last chased.
    const now = Date.now();
    const histByInvoice = new Map<string, { last: string; count: number }>();
    const logRows = (logRes.data ?? []) as {
      invoice_id: string | null;
      to_email: string | null;
      subject: string | null;
      status: string;
      sent_at: string;
    }[];
    for (const l of logRows) {
      if (!l.invoice_id) continue;
      const cur = histByInvoice.get(l.invoice_id);
      if (!cur) histByInvoice.set(l.invoice_id, { last: l.sent_at, count: 1 });
      else {
        cur.count += 1;
        if (l.sent_at > cur.last) cur.last = l.sent_at;
      }
    }

    // Build the "sent history" view (every logged reminder, newest first).
    setHistory(
      logRows.map((l, i) => {
        const inv = l.invoice_id ? invById.get(l.invoice_id) : undefined;
        const cust = inv ? custById.get(inv.customer_id) : undefined;
        return {
          id: `${l.invoice_id ?? "x"}-${i}`,
          invoice_no: inv?.invoice_no ?? "—",
          customer_name: cust?.name ?? "—",
          to_email: l.to_email,
          subject: l.subject,
          status: l.status,
          sent_at: l.sent_at,
        };
      })
    );

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
      const hist = histByInvoice.get(inv.id);
      const daysSince = hist ? Math.floor((now - new Date(hist.last).getTime()) / 86_400_000) : null;
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
        times_reminded: hist?.count ?? 0,
        days_since_reminded: daysSince,
        subject: tpl ? fillTemplate(tpl.subject, vars) : "",
        body: tpl ? fillTemplate(tpl.body, vars) : "",
      });
    }

    // Worst offenders first.
    list.sort((a, b) => b.days_overdue - a.days_overdue);
    setReminders(list);
    // Default selection: everything EXCEPT anything chased in the last few days.
    setSelected(
      new Set(
        list
          .filter((r) => r.days_since_reminded === null || r.days_since_reminded > RECENT_DAYS)
          .map((r) => r.id)
      )
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalOutstanding = useMemo(() => reminders.reduce((s, r) => s + r.outstanding, 0), [reminders]);
  const selectedOutstanding = useMemo(
    () => reminders.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.outstanding, 0),
    [reminders, selected]
  );
  const recentlyChased = useMemo(
    () => reminders.filter((r) => r.days_since_reminded !== null && r.days_since_reminded <= RECENT_DAYS).length,
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

  function chasedBadge(r: Reminder) {
    if (r.days_since_reminded === null) return <span className="text-slate-400 dark:text-slate-500">Never</span>;
    const label = r.days_since_reminded === 0 ? "Today" : `${r.days_since_reminded}d ago`;
    const recent = r.days_since_reminded <= RECENT_DAYS;
    const cls = recent
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300";
    return (
      <span
        title={`Chased ${r.times_reminded} time${r.times_reminded === 1 ? "" : "s"}`}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
      >
        {label}
        {r.times_reminded > 1 ? ` · ×${r.times_reminded}` : ""}
      </span>
    );
  }

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
    { key: "customer_name", header: "Customer", className: "font-medium", value: (r) => r.customer_name },
    {
      key: "to_email",
      header: "Email",
      value: (r) => r.to_email ?? "",
      render: (r) =>
        r.to_email ?? <span className="text-slate-400 dark:text-slate-500">no email on file</span>,
    },
    { key: "invoice_no", header: "Invoice", className: "w-28", value: (r) => r.invoice_no },
    {
      key: "days_overdue",
      header: "Days Overdue",
      className: "text-right w-32",
      value: (r) => r.days_overdue,
      render: (r) => <span className={`font-medium ${ageing(r.days_overdue).text}`}>{r.days_overdue}</span>,
    },
    {
      key: "last_chased",
      header: "Last Chased",
      className: "w-32",
      value: (r) => r.days_since_reminded ?? 100000,
      render: (r) => chasedBadge(r),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right w-36",
      value: (r) => r.outstanding,
      render: (r) => inr.format(r.outstanding),
    },
    {
      key: "preview",
      header: "",
      className: "w-20 text-right",
      render: (r) => (
        <button onClick={() => setPreviewId(r.id)} className="text-sm font-medium text-brand hover:underline">
          Preview
        </button>
      ),
    },
  ];

  /* ---- Sent confirmation view ---- */
  if (sent) {
    const sentColumns: Column<Reminder>[] = [
      { key: "customer_name", header: "Customer", className: "font-medium" },
      { key: "to_email", header: "Email", render: (r) => r.to_email ?? <span className="text-slate-400">—</span> },
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

  /* ---- Sent history view ---- */
  if (view === "history") {
    const historyColumns: Column<HistoryRow>[] = [
      { key: "sent_at", header: "Sent", className: "w-48", value: (r) => r.sent_at, render: (r) => dt.format(new Date(r.sent_at)) },
      { key: "customer_name", header: "Customer", className: "font-medium" },
      { key: "invoice_no", header: "Invoice", className: "w-28" },
      { key: "to_email", header: "Email", render: (r) => r.to_email ?? <span className="text-slate-400">—</span> },
      { key: "subject", header: "Subject" },
      {
        key: "status",
        header: "Status",
        className: "w-24",
        render: (r) => (
          <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium capitalize text-green-700 dark:bg-green-500/15 dark:text-green-400">
            {r.status}
          </span>
        ),
      },
    ];
    return (
      <div>
        <PageHeader
          title="Auto Email Shoot"
          subtitle="Every reminder ever logged, newest first."
          action={
            <button
              onClick={() => setView("compose")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Back to chasing
            </button>
          }
        />
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
            Loading history…
          </div>
        ) : (
          <DataTable columns={historyColumns} rows={history} empty="No reminders have been sent yet." />
        )}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView("history")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Sent history
            </button>
            <button
              onClick={sendAll}
              disabled={sending || selected.size === 0 || !template}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Sending…" : `Send ${selected.size} reminder${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
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

      {/* Summary strip + ageing legend */}
      {!loading && reminders.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{reminders.length}</span> overdue invoice{reminders.length === 1 ? "" : "s"}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{inr.format(totalOutstanding)}</span> total outstanding
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{selected.size}</span> selected · <span className="font-semibold text-slate-900 dark:text-white">{inr.format(selectedOutstanding)}</span>
            </span>
            <button onClick={toggleAll} className="ml-auto text-sm font-medium text-brand hover:underline">
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="font-medium">Ageing:</span>
            {BUCKETS.map((b) => (
              <span key={b.label} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${b.dot}`} />
                {b.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Anti-spam note */}
      {!loading && recentlyChased > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {recentlyChased} invoice{recentlyChased === 1 ? " was" : "s were"} chased in the last {RECENT_DAYS} days, so {recentlyChased === 1 ? "it's" : "they're"} left unticked to avoid spamming. Use <span className="font-medium">Select all</span> to include {recentlyChased === 1 ? "it" : "them"} anyway.
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
                To:{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
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
          rowClassName={(r) => ageing(r.days_overdue).row}
          empty="No overdue invoices — everyone's paid up. 🎉"
        />
      )}
    </div>
  );
}
