"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { ReminderTemplate } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { NotConfigured } from "@/components/NotConfigured";
import { Icon } from "@/components/icons";

/*
  AR Followup — Reminder Template.
  Edits the chaser email the Auto Email Shoot sends: subject + body with the
  placeholders {customer}, {amount}, {days_overdue}, {invoice_no}. Saves back to
  the reminder_templates table (update only — the row already exists from seed).
  A live preview shows the email with realistic sample values so non-technical
  users can see exactly what customers will receive.
*/

const PLACEHOLDERS = [
  { token: "{customer}", hint: "customer name" },
  { token: "{amount}", hint: "outstanding ₹" },
  { token: "{days_overdue}", hint: "days late" },
  { token: "{invoice_no}", hint: "invoice number(s)" },
] as const;

/** Realistic sample values for the live preview (mirrors real seeded data). */
const SAMPLE = {
  customer: "Sterling Textiles Pvt Ltd",
  amount: "34,102",
  days_overdue: 82,
  invoice_no: "INV-0037",
};

/** Same replacement the Auto Email Shoot uses. */
function fill(text: string): string {
  return text
    .split("{customer}").join(SAMPLE.customer)
    .split("{amount}").join(SAMPLE.amount)
    .split("{days_overdue}").join(String(SAMPLE.days_overdue))
    .split("{invoice_no}").join(SAMPLE.invoice_no);
}

export default function ReminderTemplatePage() {
  const [template, setTemplate] = useState<ReminderTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("reminder_templates").select("*").order("name").limit(1);
    if (error) {
      setError(error.message);
    } else {
      const tpl = (data?.[0] as ReminderTemplate) ?? null;
      setTemplate(tpl);
      if (tpl) {
        setName(tpl.name);
        setSubject(tpl.subject);
        setBody(tpl.body);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supabase) return <NotConfigured />;

  const dirty =
    template !== null && (name !== template.name || subject !== template.subject || body !== template.body);

  /** Insert a placeholder at the cursor position in the body textarea. */
  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!supabase || !template) return;
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("reminder_templates")
      .update({ name: name.trim() || template.name, subject: subject.trim(), body })
      .eq("id", template.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTemplate({ ...template, name: name.trim() || template.name, subject: subject.trim(), body });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  }

  function discard() {
    if (!template) return;
    setName(template.name);
    setSubject(template.subject);
    setBody(template.body);
    setError(null);
  }

  return (
    <div>
      <PageHeader
        title="Reminder Template"
        subtitle="The chaser email the Auto Email Shoot sends — edit the wording, keep the placeholders."
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/reminders"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Go to Email Shoot
            </Link>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : savedFlash ? "Saved ✓" : "Save template"}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {savedFlash && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
          <Icon name="check" size={16} />
          Template saved — the next Email Shoot will use this wording.
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading template…
        </div>
      ) : !template ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No reminder template found in the <code className="rounded bg-amber-100 px-1">reminder_templates</code> table.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Editor */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Edit the email
            </h3>
            <div className="flex flex-col gap-4">
              <FormField label="Template name">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Subject">
                <input
                  className={inputClass}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Payment reminder: invoice {invoice_no}"
                />
              </FormField>
              <FormField label="Body">
                <textarea
                  ref={bodyRef}
                  className={`${inputClass} min-h-[240px] resize-y font-sans leading-relaxed`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </FormField>

              {/* Placeholder chips — click to insert at the cursor */}
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Placeholders — click to insert into the body
                </p>
                <div className="flex flex-wrap gap-2">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insertToken(p.token)}
                      title={p.hint}
                      className="rounded-full border border-slate-300 px-2.5 py-1 font-mono text-xs font-medium text-slate-600 transition hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand dark:hover:text-brand-light"
                    >
                      {p.token}
                      <span className="ml-1.5 font-sans font-normal text-slate-400">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {dirty && (
                <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  <span>Unsaved changes</span>
                  <button onClick={discard} className="font-medium underline hover:no-underline">
                    Discard
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Live preview
            </h3>
            <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
              With sample values: {SAMPLE.customer}, ₹{SAMPLE.amount}, {SAMPLE.days_overdue} days,{" "}
              {SAMPLE.invoice_no}.
            </p>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                To: <span className="font-medium text-slate-700 dark:text-slate-200">rohit@sterlingtex.in</span>
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{fill(subject)}</p>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {fill(body)}
              </pre>
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Icon name="file" size={14} className="text-brand" />
                Account Statement — {SAMPLE.customer}.pdf
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              The Email Shoot adds the statement attachment line automatically — you don&apos;t need to type it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
