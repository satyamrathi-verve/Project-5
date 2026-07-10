"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Customer, Invoice, ReminderTemplate } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { Icon } from "@/components/icons";
import { buildStatement, downloadStatementPdf } from "@/lib/statement";
import {
  classifyReminder,
  ensureTierTemplates,
  fillTemplate,
  tierContent,
  tierForDays,
  TIERS,
  type TierDef,
} from "@/lib/reminderTemplates";

/*
  AR Followup — Auto Email Shoot.
  Finds every overdue invoice, groups them BY CUSTOMER, and builds ONE
  summarising email per customer from the saved template (reminder_templates).
  "Sending" logs one reminder_log row per covered invoice (same email body), so
  per-invoice history stays accurate. No real mailbox — the log IS the send.

  Overdue      = not fully paid AND due_date < today AND outstanding > 0.
  Outstanding  = invoice.total - sum of its receipt_allocations.amount.
  days_overdue = today - due_date, in whole days.

  Template placeholders for a multi-invoice customer:
    {customer}     -> customer name
    {amount}       -> their TOTAL outstanding
    {days_overdue} -> their OLDEST invoice's days overdue
    {invoice_no}   -> all invoice numbers, comma-separated
  …the detailed breakdown lives in the attached Account Statement (the
  print-ready page at /reports/statement), referenced from the email body.

  Monthly statement shoot: on the first visit in a new month, EVERY customer
  with dues (overdue or not) is auto-mailed their account statement, logged to
  reminder_log like everything else. "Run now" demos it without waiting.

  Smarts:
  - Reminder history from reminder_log: last chased + times chased per customer,
    and anything chased in the last few days starts unticked (anti-spam).
  - Ageing severity: rows tinted by the customer's worst invoice (0–30 → 90+).
  - Click a row to preview its email; selection shortcuts (90+ only, never chased).
  - Sent history: a second view listing every reminder ever logged.
*/

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const dmed = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

/** Secondary button — solid enough to read as clickable next to the primary brand button. */
const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-brand hover:bg-brand/5 hover:text-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand dark:hover:text-brand-light";

/** Don't re-chase anyone reminded within this many days (auto-unticked). */
const RECENT_DAYS = 3;

/** localStorage key remembering which month the auto statement shoot last ran. */
const MONTH_KEY = "monthlyShoot.lastRun";

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d = new Date()) {
  return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
}

interface OverdueInvoice {
  invoice_id: string;
  invoice_no: string;
  outstanding: number;
  days_overdue: number;
}

/** One customer = one email covering all their overdue invoices. */
interface CustomerReminder {
  id: string; // the customer id
  customer_name: string;
  to_email: string | null;
  invoices: OverdueInvoice[];
  outstanding: number; // total across their overdue invoices
  worst_days: number; // oldest invoice's days overdue — drives the ageing tint
  times_reminded: number;
  days_since_reminded: number | null; // null = never chased
  tier: TierDef; // escalation tier chosen from worst_days
  subject: string;
  body: string;
}

/** A customer with ANY unpaid balance — the monthly statement shoot's audience. */
interface DuesCustomer {
  id: string;
  name: string;
  email: string | null;
  invoices: OverdueInvoice[];
  total: number;
}

interface HistoryRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  to_email: string | null;
  subject: string | null;
  status: string;
  sent_at: string;
  tier: { label: string; badge: string }; // what tone this mail was
  payment: { amount: number; date: string } | null; // first receipt AFTER this mail
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

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminders, setReminders] = useState<CustomerReminder[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [view, setView] = useState<"compose" | "history">("compose");

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<CustomerReminder[] | null>(null);

  // Which customer's PDF is being generated right now (disables the buttons).
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Monthly statement shoot state.
  const [dues, setDues] = useState<DuesCustomer[]>([]);
  const [monthlyLastRun, setMonthlyLastRun] = useState<string | null>(null);
  const [monthlyMsg, setMonthlyMsg] = useState<string | null>(null);
  const [monthlyRunning, setMonthlyRunning] = useState(false);
  const monthlyAutoRef = useRef(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setSent(null);
    setPreviewId(null);

    const [tplRows, custRes, invRes, allocRes, logRes, rcptRes] = await Promise.all([
      ensureTierTemplates(supabase),
      supabase.from("customers").select("id, name, email"),
      supabase.from("invoices").select("id, invoice_no, customer_id, due_date, total, status"),
      supabase.from("receipt_allocations").select("invoice_id, receipt_id, amount"),
      supabase.from("reminder_log").select("invoice_id, to_email, subject, status, sent_at").order("sent_at", { ascending: false }),
      supabase.from("receipts").select("id, receipt_date"),
    ]);

    const firstError = custRes.error || invRes.error || allocRes.error || logRes.error || rcptRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setTemplates(tplRows);

    const allocations = (allocRes.data ?? []) as { invoice_id: string; receipt_id: string; amount: number }[];

    // Sum how much has been knocked off each invoice.
    const paidByInvoice = new Map<string, number>();
    for (const a of allocations) {
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

    // Money knocked off each INVOICE, oldest first — a reminder chases one invoice,
    // so only a receipt allocated to THAT invoice counts as a payment against it.
    const receiptDateById = new Map<string, string>();
    for (const r of (rcptRes.data ?? []) as { id: string; receipt_date: string }[]) {
      receiptDateById.set(r.id, r.receipt_date);
    }
    const paymentsByInvoice = new Map<string, { date: string; amount: number }[]>();
    for (const a of allocations) {
      const date = receiptDateById.get(a.receipt_id);
      if (!date) continue;
      const arr = paymentsByInvoice.get(a.invoice_id) ?? [];
      arr.push({ date, amount: Number(a.amount) });
      paymentsByInvoice.set(a.invoice_id, arr);
    }
    for (const arr of paymentsByInvoice.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));

    // Build the "sent history" view (every logged reminder, newest first).
    setHistory(
      logRows.map((l, i) => {
        const inv = l.invoice_id ? invById.get(l.invoice_id) : undefined;
        const cust = inv ? custById.get(inv.customer_id) : undefined;
        // Did a payment land against THIS invoice after this mail went out?
        // (Allocated on a later calendar day than the send.)
        const sentDay = l.sent_at.slice(0, 10);
        const laterPayments = l.invoice_id ? paymentsByInvoice.get(l.invoice_id) ?? [] : [];
        const hit = laterPayments.find((p) => p.date > sentDay) ?? null;
        return {
          id: `${l.invoice_id ?? "x"}-${i}`,
          invoice_no: inv?.invoice_no ?? "—",
          customer_name: cust?.name ?? "—",
          to_email: l.to_email,
          subject: l.subject,
          status: l.status,
          sent_at: l.sent_at,
          tier: classifyReminder(l.subject),
          payment: hit ? { amount: hit.amount, date: hit.date } : null,
        };
      })
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Pass 1: every unpaid invoice. Overdue ones feed the chase list; ALL of
    // them feed the dues list (the monthly statement shoot's audience).
    const byCustomer = new Map<string, { invoices: OverdueInvoice[]; lastChase: string | null; chaseCount: number }>();
    const duesByCustomer = new Map<string, { invoices: OverdueInvoice[]; total: number }>();
    for (const inv of (invRes.data ?? []) as Pick<
      Invoice,
      "id" | "invoice_no" | "customer_id" | "due_date" | "total" | "status"
    >[]) {
      if (inv.status === "paid") continue;
      const outstanding = Number(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0) continue;
      const due = new Date(`${inv.due_date}T00:00:00`);
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000);

      const dg = duesByCustomer.get(inv.customer_id) ?? { invoices: [], total: 0 };
      dg.invoices.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, outstanding, days_overdue: Math.max(0, daysOverdue) });
      dg.total += outstanding;
      duesByCustomer.set(inv.customer_id, dg);

      if (!(due < today)) continue; // not yet overdue — only late ones get chased
      const hist = histByInvoice.get(inv.id);

      const group = byCustomer.get(inv.customer_id) ?? { invoices: [], lastChase: null, chaseCount: 0 };
      group.invoices.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, outstanding, days_overdue: daysOverdue });
      if (hist) {
        group.chaseCount += hist.count;
        if (!group.lastChase || hist.last > group.lastChase) group.lastChase = hist.last;
      }
      byCustomer.set(inv.customer_id, group);
    }

    // Pass 2: one reminder (email) per customer.
    const list: CustomerReminder[] = [];
    for (const [customerId, group] of byCustomer) {
      const cust = custById.get(customerId);
      const customerName = cust?.name ?? "Customer";
      group.invoices.sort((a, b) => b.days_overdue - a.days_overdue);
      const total = group.invoices.reduce((s, i) => s + i.outstanding, 0);
      const worst = group.invoices[0].days_overdue;
      const invoiceNos = group.invoices.map((i) => i.invoice_no).join(", ");
      const daysSince = group.lastChase
        ? Math.floor((now - new Date(group.lastChase).getTime()) / 86_400_000)
        : null;

      // Escalation: pick the tier from the OLDEST overdue invoice, harsher as it ages.
      const tier = tierForDays(worst);
      const content = tierContent(tplRows, tier);
      const vars = { customer: customerName, amount: num.format(total), days_overdue: worst, invoice_no: invoiceNos };
      const body =
        fillTemplate(content.body, vars) + `\n\nAttached: Account Statement — ${customerName}.pdf`;

      list.push({
        id: customerId,
        customer_name: customerName,
        to_email: cust?.email ?? null,
        invoices: group.invoices,
        outstanding: total,
        worst_days: worst,
        times_reminded: group.chaseCount,
        days_since_reminded: daysSince,
        tier,
        subject: fillTemplate(content.subject, vars),
        body,
      });
    }

    // Worst offenders first.
    list.sort((a, b) => b.worst_days - a.worst_days);
    setReminders(list);
    setDues(
      [...duesByCustomer.entries()]
        .map(([cid, d]) => {
          const c = custById.get(cid);
          return { id: cid, name: c?.name ?? "Customer", email: c?.email ?? null, invoices: d.invoices, total: d.total };
        })
        .sort((a, b) => b.total - a.total)
    );
    // Default selection: everyone EXCEPT customers chased in the last few days.
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

  // Monthly auto-shoot: first visit in a new month mails every dues customer
  // their statement. The very first visit ever just "arms" it (no surprise blast).
  useEffect(() => {
    if (loading) return;
    const cur = monthKey();
    let last: string | null = null;
    try {
      last = localStorage.getItem(MONTH_KEY);
    } catch {
      /* ignore */
    }
    if (!last) {
      markMonth();
      return;
    }
    setMonthlyLastRun(last);
    if (last !== cur && !monthlyAutoRef.current) {
      monthlyAutoRef.current = true;
      runMonthly(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function markMonth() {
    const cur = monthKey();
    try {
      localStorage.setItem(MONTH_KEY, cur);
    } catch {
      /* ignore */
    }
    setMonthlyLastRun(cur);
  }

  /** Mail every customer with dues their account statement, log it, stamp the month. */
  async function runMonthly(auto = false) {
    if (!supabase || monthlyRunning) return;
    if (dues.length === 0) {
      setMonthlyMsg("No customers with dues — nothing to send.");
      markMonth();
      return;
    }
    setMonthlyRunning(true);
    setError(null);
    const label = monthLabel();
    const payload = dues.flatMap((d) =>
      d.invoices.map((i) => ({
        invoice_id: i.invoice_id,
        to_email: d.email,
        subject: `Your account statement — ${label}`,
        body:
          `Dear ${d.name},\n\nPlease find attached your account statement for ${label}. ` +
          `Your current outstanding balance is ₹${num.format(d.total)} across ${d.invoices.length} invoice${d.invoices.length === 1 ? "" : "s"}.\n\n` +
          `Attached: Account Statement — ${d.name}.pdf\n\nWarm regards,\nVerve Advisory, Accounts Team`,
        status: "sent",
      }))
    );
    const { error } = await supabase.from("reminder_log").insert(payload);
    setMonthlyRunning(false);
    if (error) {
      setError(error.message);
      return;
    }
    markMonth();
    setMonthlyMsg(
      `${auto ? "New month detected — auto-sent" : "Sent"} ${dues.length} statement email${dues.length === 1 ? "" : "s"} covering ${payload.length} invoice${payload.length === 1 ? "" : "s"} (${label}).`
    );
    load(); // refresh chase badges + history with the new log rows
  }

  const totalInvoices = useMemo(() => reminders.reduce((s, r) => s + r.invoices.length, 0), [reminders]);
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

  /* Selection shortcuts — each REPLACES the current selection. */
  function selectAll() {
    setSelected(new Set(reminders.map((r) => r.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function selectNinetyPlus() {
    setSelected(new Set(reminders.filter((r) => r.worst_days > 90).map((r) => r.id)));
  }
  function selectNeverChased() {
    setSelected(new Set(reminders.filter((r) => r.times_reminded === 0).map((r) => r.id)));
  }

  async function sendAll() {
    if (!supabase) return;
    const toSend = reminders.filter((r) => selected.has(r.id));
    if (toSend.length === 0) return;
    setSending(true);
    setError(null);
    // One email per customer, but log one row PER INVOICE it covers so
    // per-invoice chase history stays accurate.
    const payload = toSend.flatMap((r) =>
      r.invoices.map((i) => ({
        invoice_id: i.invoice_id,
        to_email: r.to_email,
        subject: r.subject,
        body: r.body,
        status: "sent",
      }))
    );
    const { error } = await supabase.from("reminder_log").insert(payload);
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(toSend);
  }

  const preview = previewId ? reminders.find((r) => r.id === previewId) ?? null : null;

  /** Fetch one customer's full data and save their statement as a real .pdf file. */
  async function downloadStatement(customerId: string) {
    if (!supabase || downloadingId) return;
    setDownloadingId(customerId);
    try {
      const [coRes, custRes, invRes, rcptRes, allocRes] = await Promise.all([
        supabase.from("company").select("*").limit(1),
        supabase.from("customers").select("*").eq("id", customerId).limit(1),
        supabase.from("invoices").select("*").eq("customer_id", customerId).order("invoice_date"),
        supabase.from("receipts").select("*").eq("customer_id", customerId).order("receipt_date"),
        supabase.from("receipt_allocations").select("invoice_id, amount"),
      ]);
      const firstError = coRes.error || custRes.error || invRes.error || rcptRes.error || allocRes.error;
      if (firstError) throw new Error(firstError.message);
      const cust = custRes.data?.[0];
      if (!cust) throw new Error("Customer not found.");
      const stmt = buildStatement(cust, invRes.data ?? [], rcptRes.data ?? [], allocRes.data ?? []);
      await downloadStatementPdf(coRes.data?.[0] ?? null, cust, stmt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the PDF.");
    } finally {
      setDownloadingId(null);
    }
  }

  function chasedBadge(r: CustomerReminder) {
    if (r.days_since_reminded === null) return <span className="text-slate-400 dark:text-slate-500">Never</span>;
    const label = r.days_since_reminded === 0 ? "Today" : `${r.days_since_reminded}d ago`;
    const recent = r.days_since_reminded <= RECENT_DAYS;
    const cls = recent
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300";
    return (
      <span
        title={`Chased ${r.times_reminded} time${r.times_reminded === 1 ? "" : "s"} in total`}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
      >
        {label}
        {r.times_reminded > 1 ? ` · ×${r.times_reminded}` : ""}
      </span>
    );
  }

  const columns: Column<CustomerReminder>[] = [
    {
      key: "select",
      header: "",
      className: "w-10",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          onClick={(e) => e.stopPropagation()}
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
    {
      key: "invoices",
      header: "Invoices",
      className: "w-28",
      value: (r) => r.invoices.length,
      render: (r) => (
        <span title={r.invoices.map((i) => i.invoice_no).join(", ")}>
          {r.invoices.length} invoice{r.invoices.length === 1 ? "" : "s"}
        </span>
      ),
    },
    {
      key: "worst_days",
      header: "Oldest Overdue",
      className: "text-right w-36",
      value: (r) => r.worst_days,
      render: (r) => <span className={`font-medium ${ageing(r.worst_days).text}`}>{r.worst_days}d</span>,
    },
    {
      key: "tier",
      header: "Tone",
      className: "w-32",
      value: (r) => r.tier.key,
      render: (r) => (
        <span
          title={`${r.tier.label} — ${r.tier.range}`}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.tier.badge}`}
        >
          {r.tier.label}
        </span>
      ),
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
      key: "open",
      header: "Actions",
      sortable: false,
      className: "w-20 text-right",
      render: (r) => (
        <span className="inline-flex items-center gap-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadStatement(r.id);
            }}
            disabled={downloadingId !== null}
            title="Download account statement (.pdf)"
            className="text-slate-400 transition hover:text-brand disabled:opacity-40"
          >
            <Icon name={downloadingId === r.id ? "clock" : "download"} size={16} />
          </button>
          <Icon
            name="eye"
            size={17}
            className={previewId === r.id ? "text-brand" : "text-slate-300 dark:text-slate-600"}
          />
        </span>
      ),
    },
  ];

  /* ---- Sent confirmation view ---- */
  if (sent) {
    const sentInvoiceCount = sent.reduce((s, r) => s + r.invoices.length, 0);
    const sentColumns: Column<CustomerReminder>[] = [
      { key: "customer_name", header: "Customer", className: "font-medium" },
      { key: "to_email", header: "Email", render: (r) => r.to_email ?? <span className="text-slate-400">—</span> },
      {
        key: "invoices",
        header: "Invoices Covered",
        render: (r) => r.invoices.map((i) => i.invoice_no).join(", "),
      },
      { key: "subject", header: "Subject" },
      {
        key: "pdf",
        header: "Statement",
        className: "w-28",
        render: (r) => (
          <button
            onClick={() => downloadStatement(r.id)}
            disabled={downloadingId !== null}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline disabled:opacity-50"
          >
            <Icon name="download" size={15} />
            {downloadingId === r.id ? "…" : "PDF"}
          </button>
        ),
      },
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
            <button onClick={load} className={secondaryBtn}>
              <Icon name="chevronLeft" size={16} />
              Back to overdue list
            </button>
          }
        />
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
          <span className="text-base">✓</span>
          Sent {sent.length} email{sent.length === 1 ? "" : "s"} covering {sentInvoiceCount} invoice{sentInvoiceCount === 1 ? "" : "s"}.
        </div>
        <DataTable columns={sentColumns} rows={sent} empty="Nothing sent." />
      </div>
    );
  }

  /* ---- Sent history view ---- */
  if (view === "history") {
    const historyColumns: Column<HistoryRow>[] = [
      { key: "sent_at", header: "Sent", className: "w-44", value: (r) => r.sent_at, render: (r) => dt.format(new Date(r.sent_at)) },
      {
        key: "payment",
        header: "Payment since",
        className: "w-40",
        value: (r) => (r.payment ? r.payment.date : ""),
        render: (r) =>
          r.payment ? (
            <span
              title={`Receipt of ${inr.format(r.payment.amount)} on ${dmed.format(new Date(r.payment.date))}, after this reminder`}
              className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400"
            >
              <Icon name="check" size={13} />
              {inr.format(r.payment.amount)} · {dmed.format(new Date(r.payment.date))}
            </span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">No payment yet</span>
          ),
      },
      {
        key: "tier",
        header: "Type",
        className: "w-28",
        value: (r) => r.tier.label,
        render: (r) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.tier.badge}`}>
            {r.tier.label}
          </span>
        ),
      },
      { key: "customer_name", header: "Customer", className: "font-medium" },
      { key: "invoice_no", header: "Invoice", className: "w-28" },
      { key: "to_email", header: "Email", render: (r) => r.to_email ?? <span className="text-slate-400">—</span> },
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
            <button onClick={() => setView("compose")} className={secondaryBtn}>
              <Icon name="chevronLeft" size={16} />
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
        subtitle="One email per overdue customer, covering all their overdue invoices. Click a row to preview."
        action={
          <div className="flex items-center gap-2">
            <Link href="/reminders/template" className={secondaryBtn}>
              <Icon name="pencil" size={16} />
              Edit templates
            </Link>
            <button onClick={() => setView("history")} className={secondaryBtn}>
              <Icon name="clock" size={16} />
              Sent history
            </button>
            <button
              onClick={sendAll}
              disabled={sending || selected.size === 0}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Sending…" : `Send ${selected.size} email${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Escalation legend — which tone each overdue age gets */}
      {!loading && reminders.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="font-medium text-slate-500 dark:text-slate-400">
            Tone escalates with age — each customer gets the tier for their oldest overdue invoice:
          </span>
          {TIERS.map((t) => (
            <span key={t.key} className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
              <span className="font-medium text-slate-700 dark:text-slate-200">{t.label}</span> {t.range}
            </span>
          ))}
        </div>
      )}

      {/* Monthly statement shoot */}
      {!loading && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon name="clock" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Monthly statement shoot</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every customer with dues gets their account statement automatically on the first visit each month.
              Last ran: <span className="font-medium">{monthlyLastRun ?? "never"}</span> ·{" "}
              {dues.length} customer{dues.length === 1 ? "" : "s"} with dues right now
            </p>
          </div>
          <button
            onClick={() => runMonthly(false)}
            disabled={monthlyRunning || dues.length === 0}
            className="rounded-lg border border-brand px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-50"
          >
            {monthlyRunning ? "Sending…" : "Run now"}
          </button>
        </div>
      )}
      {monthlyMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
          <span>✓</span> {monthlyMsg}
        </div>
      )}

      {/* Summary strip + selection shortcuts + ageing legend */}
      {!loading && reminders.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{reminders.length}</span> customer{reminders.length === 1 ? "" : "s"} · <span className="font-semibold text-slate-900 dark:text-white">{totalInvoices}</span> overdue invoice{totalInvoices === 1 ? "" : "s"}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{inr.format(totalOutstanding)}</span> total outstanding
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">{selected.size}</span> selected · <span className="font-semibold text-slate-900 dark:text-white">{inr.format(selectedOutstanding)}</span>
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Quick select:</span>
            <SelectChip label={allSelected ? "Deselect all" : "Select all"} onClick={allSelected ? selectNone : selectAll} />
            <SelectChip label="Only 90+ days" onClick={selectNinetyPlus} />
            <SelectChip label="Only never chased" onClick={selectNeverChased} />
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">Ageing:</span>
              {BUCKETS.map((b) => (
                <span key={b.label} className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${b.dot}`} />
                  {b.label}
                </span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* Anti-spam note */}
      {!loading && recentlyChased > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {recentlyChased} customer{recentlyChased === 1 ? " was" : "s were"} chased in the last {RECENT_DAYS} days, so {recentlyChased === 1 ? "it's" : "they're"} left unticked to avoid spamming. Use <span className="font-medium">Select all</span> to include {recentlyChased === 1 ? "it" : "them"} anyway.
        </div>
      )}

      {/* Email preview card (click a row to open) */}
      {preview && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Email preview
                </h3>
                <span
                  title={`Auto-selected from ${preview.worst_days} days overdue (${preview.tier.range})`}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${preview.tier.badge}`}
                >
                  {preview.tier.label} tone
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                To:{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {preview.customer_name}
                  {preview.to_email ? ` <${preview.to_email}>` : " (no email on file)"}
                </span>
                {" · "}covers {preview.invoices.length} invoice{preview.invoices.length === 1 ? "" : "s"}
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
          {/* The "attachment" — click to download the real .pdf file */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => downloadStatement(preview.id)}
              disabled={downloadingId !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:border-brand"
            >
              <Icon name="download" size={16} className="text-brand" />
              Account Statement — {preview.customer_name}.pdf
              <span className="text-xs font-normal text-slate-400">
                {downloadingId === preview.id ? "generating…" : "download"}
              </span>
            </button>
            <a
              href={`/reports/statement?customer=${preview.id}`}
              target="_blank"
              className="text-xs font-medium text-brand hover:underline"
            >
              view online
            </a>
          </div>
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
          rowClassName={(r) => ageing(r.worst_days).row}
          onRowClick={(r) => setPreviewId((cur) => (cur === r.id ? null : r.id))}
          empty="No overdue invoices — everyone's paid up. 🎉"
        />
      )}
    </div>
  );
}

/** Small pill button for the quick-select row. */
function SelectChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand dark:hover:text-brand-light"
    >
      {label}
    </button>
  );
}
