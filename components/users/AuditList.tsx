"use client";

/*
  AuditList — recent Users & Access audit entries (Date & Time, Action,
  Performed By, Target User, Previous → New). Read-only by design: unlike the
  general Activity Center, a user-administration audit trail shouldn't have a
  casual "clear" button — that's what makes it trustworthy as an audit log.
*/

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { getUserAudit, onUserAuditChange, USER_AUDIT_ACTION_LABELS, type UserAuditEntry } from "@/lib/users";

const TONE: Record<string, string> = {
  user_created: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  user_edited: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  password_reset: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
  role_changed: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  permissions_changed: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  user_activated: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  user_inactivated: "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300",
  user_deleted: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
};

function fmt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function AuditList({ limit = 10 }: { limit?: number }) {
  const [entries, setEntries] = useState<UserAuditEntry[]>([]);
  useEffect(() => {
    const refresh = () => setEntries(getUserAudit(limit));
    refresh();
    return onUserAuditChange(refresh);
  }, [limit]);

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No user administration activity recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs dark:bg-slate-800/60">
          <tr className="text-left text-slate-500 dark:text-slate-400">
            <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Date &amp; Time</th>
            <th className="px-3 py-2.5 font-semibold">Action</th>
            <th className="px-3 py-2.5 font-semibold">Performed By</th>
            <th className="px-3 py-2.5 font-semibold">Target User</th>
            <th className="px-3 py-2.5 font-semibold">Previous → New</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const w = fmt(e.at);
            return (
              <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">
                  {w.date} <span className="text-slate-400">{w.time}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[e.action] ?? "bg-slate-100 text-slate-500"}`}>
                    <Icon name="clock" size={12} />
                    {USER_AUDIT_ACTION_LABELS[e.action]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-200">{e.performedBy}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">{e.targetUserName}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                  {e.previousValue && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600 dark:bg-red-500/10 dark:text-red-400">{e.previousValue}</span>}
                  {e.previousValue && e.newValue && " → "}
                  {e.newValue && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{e.newValue}</span>}
                  {!e.previousValue && !e.newValue && "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
