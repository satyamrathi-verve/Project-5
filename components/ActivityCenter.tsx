"use client";

/*
  ActivityCenter — one reusable timeline for everything that happened to a record.
  ================================================================================
  Drop into any module with <ActivityCenter module="gl" recordId="1000" />.
  Merges three sources into a single searchable / filterable timeline table:
    • the per-record change log (create / edit / status / notes / import / export
      / print / relationship / version — captured with the signed-in user + reason),
    • the shared DMS attachment audit history (upload / download / delete / …),
    • optional seed events a module already knows (e.g. "created" from created_at).
  Columns: Date & Time · User · Context · Action · Field Changed · Old → New ·
  Reason. Dark-theme consistent; exportable to CSV.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { inputClass } from "./FormField";
import { downloadBlob } from "@/lib/import-template";
import { listAttachments } from "@/lib/attachments/client";
import type { HistoryAction } from "@/lib/attachments/types";
import {
  ACTIVITY_CATEGORIES,
  actionMeta,
  getLocalActivity,
  onActivityChange,
  type ActivityAction,
  type ActivityCategory,
  type ActivityEvent,
} from "@/lib/activity";

const ATTACH_ACTION: Record<HistoryAction, ActivityAction> = {
  uploaded: "attachment_uploaded",
  replaced: "attachment_replaced",
  renamed: "attachment_renamed",
  deleted: "attachment_deleted",
  downloaded: "attachment_downloaded",
  tagged: "attachment_tagged",
  restored: "attachment_restored",
};

function fmt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function ActivityCenter({
  module,
  recordId,
  contextLabel,
  seedEvents,
}: {
  module: string;
  recordId: string;
  contextLabel?: string;
  /** Events the module already knows (e.g. created_at) — merged in read-only. */
  seedEvents?: ActivityEvent[];
}) {
  const [local, setLocal] = useState<ActivityEvent[]>([]);
  const [attach, setAttach] = useState<ActivityEvent[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [userFilter, setUserFilter] = useState("");

  // local change log (live via pub/sub)
  const refreshLocal = useCallback(() => setLocal(getLocalActivity(module, recordId)), [module, recordId]);
  useEffect(() => {
    refreshLocal();
    return onActivityChange(refreshLocal);
  }, [refreshLocal]);

  // shared attachment audit history from the DMS
  useEffect(() => {
    let cancelled = false;
    void listAttachments(module, recordId)
      .then((res) => {
        if (cancelled) return;
        const mapped: ActivityEvent[] = res.history.map((h) => ({
          id: `att-${h.id}`,
          module,
          recordId,
          at: h.at,
          user: h.user,
          context: h.file,
          action: ATTACH_ACTION[h.action] ?? "version",
          field: null,
          oldValue: null,
          newValue: h.detail ?? null,
          reason: null,
          source: "attachments",
        }));
        setAttach(mapped);
      })
      .catch(() => setAttach([]));
    return () => {
      cancelled = true;
    };
  }, [module, recordId]);

  const events = useMemo(() => {
    const all = [...(seedEvents ?? []), ...local, ...attach];
    return all.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [seedEvents, local, attach]);

  const users = useMemo(() => [...new Set(events.map((e) => e.user))].sort(), [events]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (category !== "all" && actionMeta(e.action).category !== category) return false;
      if (userFilter && e.user !== userFilter) return false;
      if (q) {
        const hay = `${e.user} ${e.context} ${actionMeta(e.action).label} ${e.field ?? ""} ${e.oldValue ?? ""} ${e.newValue ?? ""} ${e.reason ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, search, category, userFilter]);

  const exportCsv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = ["Date", "Time", "User", "Context", "Action", "Field Changed", "Old Value", "New Value", "Reason"];
    const rows = visible.map((e) => {
      const w = fmt(e.at);
      return [w.date, w.time, e.user, e.context, actionMeta(e.action).label, e.field ?? "", e.oldValue ?? "", e.newValue ?? "", e.reason ?? ""].map((x) => esc(String(x)));
    });
    const csv = [header, ...rows].map((r) => r.join(",")).join("\r\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `activity-${module}-${recordId}.csv`);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={15} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity — user, field, value, reason…" className={`${inputClass} w-full py-1.5 pl-8 text-sm`} />
        </div>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={`${inputClass} py-1.5 text-xs`} title="Filter by user">
          <option value="">All users</option>
          {users.map((u) => (<option key={u} value={u}>{u}</option>))}
        </select>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" title="Export activity to CSV">
          <Icon name="download" size={15} /> Export
        </button>
      </div>

      {/* category chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ACTIVITY_CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
              category === c.key
                ? "bg-brand/10 text-brand ring-brand/30 dark:text-brand-light"
                : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700"
            }`}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">{visible.length} of {events.length} events</span>
      </div>

      {/* timeline table */}
      {events.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Icon name="clock" size={22} /></span>
          <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">No activity yet</p>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            Creates, edits, status changes, notes, attachments and exports for this record will appear here — with who did it, when, and why.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs dark:bg-slate-800/60">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Date &amp; Time</th>
                <th className="px-3 py-2.5 font-semibold">User</th>
                <th className="px-3 py-2.5 font-semibold">Context</th>
                <th className="px-3 py-2.5 font-semibold">Action</th>
                <th className="px-3 py-2.5 font-semibold">Field Changed</th>
                <th className="px-3 py-2.5 font-semibold">Old Value</th>
                <th className="px-3 py-2.5 font-semibold">New Value</th>
                <th className="px-3 py-2.5 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">No activity matches these filters.</td></tr>
              ) : (
                visible.map((e) => {
                  const meta = actionMeta(e.action);
                  const w = fmt(e.at);
                  return (
                    <tr key={e.id} className="border-t border-slate-100 align-top hover:bg-brand/[0.03] dark:border-slate-800 dark:hover:bg-brand/10">
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">
                        {w.date}<span className="ml-1 text-slate-400">{w.time}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-200">{e.user}</td>
                      <td className="max-w-[160px] truncate px-3 py-2.5 text-slate-600 dark:text-slate-300" title={e.context}>{e.context || "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`}>
                          <Icon name={meta.icon} size={13} /> {meta.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">{e.field ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5">
                        {e.oldValue != null && e.oldValue !== "" ? (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600 line-through dark:bg-red-500/10 dark:text-red-400">{e.oldValue}</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {e.newValue != null && e.newValue !== "" ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{e.newValue}</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5 text-slate-500 dark:text-slate-400">{e.reason ? <span title={e.reason}>{e.reason}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Change log is recorded in this browser; attachment history is shared. {contextLabel ? `Record: ${contextLabel}.` : ""}
      </p>
    </div>
  );
}
