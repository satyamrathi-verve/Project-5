"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { ReminderTemplate } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { NotConfigured } from "@/components/NotConfigured";
import { Icon } from "@/components/icons";
import { ensureTierTemplates, fillTemplate, TIERS, type TierDef } from "@/lib/reminderTemplates";

/*
  AR Followup — Reminder Templates (tiered).
  Four escalating chaser emails, one per overdue-age tier. The Auto Email Shoot
  auto-picks a customer's tier from their oldest overdue invoice; here you edit
  each tier's subject + body (placeholders {customer} {amount} {days_overdue}
  {invoice_no}) and save it back to the reminder_templates table. A live preview
  fills sample values for that tier so you see the tone customers will receive.
*/

const PLACEHOLDERS = [
  { token: "{customer}", hint: "customer name" },
  { token: "{amount}", hint: "outstanding ₹" },
  { token: "{days_overdue}", hint: "days late" },
  { token: "{invoice_no}", hint: "invoice number(s)" },
] as const;

const SAMPLE_CUSTOMER = "Sterling Textiles Pvt Ltd";
const SAMPLE_AMOUNT = "34,102";
const SAMPLE_INVOICE = "INV-0037";

export default function ReminderTemplatesPage() {
  const [rows, setRows] = useState<ReminderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeKey, setActiveKey] = useState<TierDef["key"]>("t1");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const activeTier = TIERS.find((t) => t.key === activeKey)!;
  const activeRow = useMemo(() => rows.find((r) => r.name === activeTier.name), [rows, activeTier]);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const tplRows = await ensureTierTemplates(supabase);
    setRows(tplRows);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the tier changes (or data loads), fill the editor from that tier's
  // saved row, falling back to the built-in wording.
  useEffect(() => {
    const row = rows.find((r) => r.name === activeTier.name);
    setSubject(row?.subject ?? activeTier.subject);
    setBody(row?.body ?? activeTier.body);
    setSavedFlash(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, rows]);

  if (!supabase) return <NotConfigured />;

  const dirty = subject !== (activeRow?.subject ?? activeTier.subject) || body !== (activeRow?.body ?? activeTier.body);

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!supabase) return;
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);

    // The tier row should exist (ensureTierTemplates seeds it), but update by id
    // when we have it and fall back to insert if somehow missing.
    let err;
    if (activeRow) {
      ({ error: err } = await supabase
        .from("reminder_templates")
        .update({ subject: subject.trim(), body })
        .eq("id", activeRow.id));
    } else {
      ({ error: err } = await supabase
        .from("reminder_templates")
        .insert({ name: activeTier.name, subject: subject.trim(), body }));
    }
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Reflect the save locally so "dirty" resets without a full reload.
    setRows((prev) => {
      const next = prev.filter((r) => r.name !== activeTier.name);
      const existing = prev.find((r) => r.name === activeTier.name);
      next.push({
        id: existing?.id ?? `local-${activeTier.key}`,
        name: activeTier.name,
        subject: subject.trim(),
        body,
      });
      return next;
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  }

  function resetToDefault() {
    setSubject(activeTier.subject);
    setBody(activeTier.body);
  }

  const previewSubject = fillTemplate(subject, {
    customer: SAMPLE_CUSTOMER,
    amount: SAMPLE_AMOUNT,
    days_overdue: activeTier.sampleDays,
    invoice_no: SAMPLE_INVOICE,
  });
  const previewBody = fillTemplate(body, {
    customer: SAMPLE_CUSTOMER,
    amount: SAMPLE_AMOUNT,
    days_overdue: activeTier.sampleDays,
    invoice_no: SAMPLE_INVOICE,
  });

  return (
    <div>
      <PageHeader
        title="Reminder Templates"
        subtitle="Four escalating chaser emails — the Email Shoot picks the right tone by how overdue a customer is."
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
              {saving ? "Saving…" : savedFlash ? "Saved ✓" : "Save this tier"}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading templates…
        </div>
      ) : (
        <>
          {/* Tier tabs */}
          <div className="mb-6 flex flex-wrap gap-2">
            {TIERS.map((t, i) => {
              const active = t.key === activeKey;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveKey(t.key)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition ${
                    active
                      ? "border-brand bg-brand/5 ring-1 ring-brand"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                  }`}
                >
                  <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${t.badge}`}>
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{t.label}</span>
                    <span className="block text-xs text-slate-400">{t.range}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {savedFlash && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
              <Icon name="check" size={16} />
              Saved — the next Email Shoot will use this wording for {activeTier.range} overdue.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Editor */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Editing: <span className={`ml-1 rounded-full px-2 py-0.5 ${activeTier.badge}`}>{activeTier.label}</span>
                </h3>
                <button onClick={resetToDefault} className="text-xs font-medium text-slate-400 hover:text-brand">
                  Reset to default
                </button>
              </div>
              <div className="flex flex-col gap-4">
                <FormField label="Subject">
                  <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
                </FormField>
                <FormField label="Body">
                  <textarea
                    ref={bodyRef}
                    className={`${inputClass} min-h-[260px] resize-y font-sans leading-relaxed`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </FormField>

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
                    <span>Unsaved changes to the {activeTier.label} tier</span>
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
                Sample: {SAMPLE_CUSTOMER}, ₹{SAMPLE_AMOUNT}, {activeTier.sampleDays} days overdue, {SAMPLE_INVOICE}.
              </p>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  To: <span className="font-medium text-slate-700 dark:text-slate-200">rohit@sterlingtex.in</span>
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{previewSubject}</p>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {previewBody}
                </pre>
                <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Icon name="file" size={14} className="text-brand" />
                  Account Statement — {SAMPLE_CUSTOMER}.pdf
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                The Email Shoot adds the statement attachment line automatically — you don&apos;t need to type it.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
