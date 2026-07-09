"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FormField, inputClass } from "@/components/FormField";

/*
  Collection Follow-ups — the running log of chases against one invoice
  (date · activity · who followed up · notes). Front-end only: manual entries are
  kept in localStorage per invoice (no backend table exists for this, and the
  project rule is never to touch the backend). Any real email reminders already
  sent for this invoice (from reminder_log) are shown too, as read-only rows.
*/

interface Followup {
  id: string;
  date: string; // yyyy-mm-dd
  activity: string;
  by: string;
  notes: string;
  source: "manual" | "auto";
}

const ACTIVITIES = [
  "Through Email",
  "Through Call",
  "Through WhatsApp",
  "Through SMS",
  "In-person Meeting",
  "Other",
];

/** Auto-detected reminders are labelled by their sequence: First reminder, Second… */
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
function reminderLabel(n: number): string {
  return `${ORDINALS[n - 1] ?? `${n}th`} reminder`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CollectionFollowups({ invoiceId }: { invoiceId: string }) {
  const storageKey = `followups:${invoiceId}`;
  const byKey = "followups:lastBy"; // remember who's chasing, to prefill next time

  const [manual, setManual] = useState<Followup[]>([]);
  const [auto, setAuto] = useState<Followup[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ date: todayISO(), activity: ACTIVITIES[1], by: "", notes: "" });

  // Load saved manual follow-ups for this invoice.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setManual(raw ? (JSON.parse(raw) as Followup[]) : []);
      const lastBy = localStorage.getItem(byKey) ?? "";
      setForm((f) => ({ ...f, by: lastBy }));
    } catch {
      setManual([]);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Pull any real email reminders already sent for this invoice (read-only rows).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("reminder_log")
        .select("id, sent_at")
        .eq("invoice_id", invoiceId);
      if (cancelled || error || !data) return;
      // Number the reminders in the order they were actually sent (oldest = first).
      const sorted = [...data].sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""));
      setAuto(
        sorted.map((r, i) => ({
          id: `auto-${r.id}`,
          date: (r.sent_at ?? "").slice(0, 10),
          activity: "Through Email",
          by: "Auto Email Shoot",
          notes: reminderLabel(i + 1),
          source: "auto" as const,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  function persist(next: Followup[]) {
    setManual(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }

  function add() {
    if (!form.by.trim()) return; // "follow-up by" is required — every chase names a person
    const entry: Followup = {
      id: `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      date: form.date || todayISO(),
      activity: form.activity,
      by: form.by.trim(),
      notes: form.notes.trim(),
      source: "manual",
    };
    persist([...manual, entry]);
    try {
      localStorage.setItem(byKey, entry.by);
    } catch {
      /* ignore */
    }
    setForm({ date: todayISO(), activity: ACTIVITIES[1], by: entry.by, notes: "" });
    setAdding(false);
  }

  function remove(id: string) {
    persist(manual.filter((f) => f.id !== id));
  }

  // Newest first; ties keep manual entries above auto ones.
  const rows = useMemo(() => {
    return [...auto, ...manual].sort((a, b) => {
      const d = (b.date ?? "").localeCompare(a.date ?? "");
      return d !== 0 ? d : Number(b.source === "manual") - Number(a.source === "manual");
    });
  }, [auto, manual]);

  return (
    <div className="mt-6 print:hidden">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Collection Follow-ups
        </h3>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {adding ? "Close" : "＋ Log Follow-up"}
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Date">
              <input
                type="date"
                className={inputClass}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </FormField>
            <FormField label="Activity">
              <select
                className={inputClass}
                value={form.activity}
                onChange={(e) => setForm({ ...form, activity: e.target.value })}
              >
                {ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Follow-up By">
              <input
                className={inputClass}
                placeholder="e.g. Mahadev Thawani"
                value={form.by}
                onChange={(e) => setForm({ ...form, by: e.target.value })}
              />
            </FormField>
            <FormField label="Notes">
              <input
                className={inputClass}
                placeholder="e.g. First reminder / Promised payment by Friday"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </FormField>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={add}
              disabled={!form.by.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Add Follow-up
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            {!form.by.trim() && (
              <span className="text-xs text-slate-400">Name who followed up to save.</span>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-center dark:border-slate-800 dark:bg-slate-800/50">
              <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Date</th>
              <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Activity</th>
              <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Follow-up By</th>
              <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Notes</th>
              <th className="px-4 py-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? null : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No follow-ups logged yet. Click “＋ Log Follow-up” to record a call, email or WhatsApp chase.
                </td>
              </tr>
            ) : (
              rows.map((f) => (
                <tr key={f.id} className="border-b border-slate-100 text-center align-middle last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">{fmtDate(f.date)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">{f.activity}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {f.by}
                    {f.source === "auto" && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        auto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{f.notes || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {f.source === "manual" && (
                      <button
                        onClick={() => remove(f.id)}
                        title="Remove"
                        className="text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
