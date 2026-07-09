import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderTemplate } from "./types";

/*
  Escalating reminder tiers. The chaser's tone hardens as an invoice ages, and
  the final tier warns about handing the account to a recovery agent. The Auto
  Email Shoot picks a customer's tier from their OLDEST overdue invoice; the
  Reminder Template screen lets you edit each tier's wording.

  These live in the reminder_templates table (one row per tier, matched by name).
  ensureTierTemplates() seeds any missing tier row the first time — inserting rows
  is allowed; we never alter the table.

  Placeholders: {customer} {amount} {days_overdue} {invoice_no}
*/

export interface TierDef {
  key: "t1" | "t2" | "t3" | "t4";
  name: string; // the reminder_templates.name this tier maps to
  label: string; // short UI label
  range: string; // human day-range
  sampleDays: number; // representative value for previews
  dot: string; // legend dot colour
  badge: string; // pill classes for the tier badge
  subject: string;
  body: string;
}

export const TIERS: TierDef[] = [
  {
    key: "t1",
    name: "Reminder — Tier 1 (Gentle, 0–30 days)",
    label: "Gentle",
    range: "0–30 days",
    sampleDays: 15,
    dot: "bg-amber-400",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    subject: "Payment reminder: invoice {invoice_no}",
    body:
      "Dear {customer},\n\n" +
      "This is a friendly reminder that invoice {invoice_no} for ₹{amount} is now {days_overdue} days past its due date. " +
      "If you have already made the payment, please ignore this note and accept our thanks.\n\n" +
      "We'd be grateful if you could arrange payment at your earliest convenience.\n\n" +
      "Warm regards,\nVerve Advisory, Accounts Team",
  },
  {
    key: "t2",
    name: "Reminder — Tier 2 (Firm, 31–60 days)",
    label: "Firm",
    range: "31–60 days",
    sampleDays: 45,
    dot: "bg-orange-400",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
    subject: "Second reminder: overdue invoice {invoice_no}",
    body:
      "Dear {customer},\n\n" +
      "Our records show that invoice {invoice_no} for ₹{amount} remains unpaid and is now {days_overdue} days overdue. " +
      "Despite our earlier reminder, we have not yet received your payment.\n\n" +
      "We request you to settle this amount within the next 7 days to keep your account in good standing.\n\n" +
      "Regards,\nVerve Advisory, Accounts Team",
  },
  {
    key: "t3",
    name: "Reminder — Tier 3 (Urgent, 61–90 days)",
    label: "Urgent",
    range: "61–90 days",
    sampleDays: 75,
    dot: "bg-red-400",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    subject: "URGENT: invoice {invoice_no} is seriously overdue",
    body:
      "Dear {customer},\n\n" +
      "Invoice {invoice_no} for ₹{amount} is now {days_overdue} days overdue and remains unpaid despite repeated reminders. " +
      "This is a serious concern for us.\n\n" +
      "Please treat this as urgent and clear the outstanding amount immediately. Continued non-payment may lead to a hold " +
      "on further supplies and escalation of this matter.\n\n" +
      "Regards,\nVerve Advisory, Accounts Team",
  },
  {
    key: "t4",
    name: "Reminder — Tier 4 (Final notice, 90+ days)",
    label: "Final notice",
    range: "90+ days",
    sampleDays: 100,
    dot: "bg-red-600",
    badge: "bg-red-600/10 text-red-700 dark:bg-red-500/20 dark:text-red-300 font-semibold",
    subject: "FINAL NOTICE: invoice {invoice_no} — immediate action required",
    body:
      "Dear {customer},\n\n" +
      "This is our FINAL NOTICE regarding invoice {invoice_no} for ₹{amount}, which is now {days_overdue} days overdue. " +
      "Multiple reminders have gone unanswered.\n\n" +
      "If payment is not received within 7 days, we will have no option but to assign this account to an external recovery " +
      "agent and pursue all available means to recover the dues. This may also affect your credit standing with us.\n\n" +
      "We strongly urge you to make immediate payment to avoid these consequences.\n\n" +
      "Regards,\nVerve Advisory, Accounts Team",
  },
];

/**
  Work out which tier (or "Statement") a already-sent email was, from its subject.
  Sent rows freeze their subject at send time, so we classify by keyword rather
  than exact-matching current (possibly edited) template text.
*/
export function classifyReminder(subject: string | null): { label: string; badge: string } {
  const s = (subject ?? "").toLowerCase();
  if (s.includes("final notice")) return { label: "Final notice", badge: TIERS[3].badge };
  if (s.includes("urgent")) return { label: "Urgent", badge: TIERS[2].badge };
  if (s.includes("second reminder")) return { label: "Firm", badge: TIERS[1].badge };
  if (s.includes("payment reminder")) return { label: "Gentle", badge: TIERS[0].badge };
  if (s.includes("account statement"))
    return { label: "Statement", badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300" };
  return { label: "Other", badge: "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400" };
}

/** Which tier applies to an invoice that is `days` overdue. */
export function tierForDays(days: number): TierDef {
  if (days <= 30) return TIERS[0];
  if (days <= 60) return TIERS[1];
  if (days <= 90) return TIERS[2];
  return TIERS[3];
}

/** The DB row for a tier if present, otherwise the built-in default wording. */
export function tierContent(
  rows: ReminderTemplate[],
  tier: TierDef
): { subject: string; body: string } {
  const row = rows.find((r) => r.name === tier.name);
  return row ? { subject: row.subject, body: row.body } : { subject: tier.subject, body: tier.body };
}

/** Fill the placeholders with a customer's real values. */
export function fillTemplate(
  text: string,
  vars: { customer: string; amount: string; days_overdue: number; invoice_no: string }
): string {
  return text
    .split("{customer}").join(vars.customer)
    .split("{amount}").join(vars.amount)
    .split("{days_overdue}").join(String(vars.days_overdue))
    .split("{invoice_no}").join(vars.invoice_no);
}

/**
  Load all reminder templates, seeding any missing tier rows first. Idempotent:
  it only inserts tiers whose name isn't already present, so repeat calls are safe.
  Never throws — on a hard read failure it returns [] and the callers fall back to
  the built-in tier wording.
*/
export async function ensureTierTemplates(sb: SupabaseClient): Promise<ReminderTemplate[]> {
  const { data, error } = await sb.from("reminder_templates").select("*");
  if (error) return [];
  const rows = (data ?? []) as ReminderTemplate[];
  const have = new Set(rows.map((r) => r.name));
  const missing = TIERS.filter((t) => !have.has(t.name));
  if (missing.length === 0) return rows;

  const { data: inserted, error: insErr } = await sb
    .from("reminder_templates")
    .insert(missing.map((t) => ({ name: t.name, subject: t.subject, body: t.body })))
    .select();
  if (insErr) return rows; // seeding failed — callers fall back to code defaults
  return [...rows, ...((inserted ?? []) as ReminderTemplate[])];
}
