"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { getUserAuditFor, moduleLabel, USER_AUDIT_ACTION_LABELS, type ModuleKey, type PublicUser, type UserAuditEntry } from "@/lib/users";
import { Avatar, ModalHeader, ModalShell, RoleBadge, StatusPill } from "./ui";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">{value || "—"}</dd>
    </div>
  );
}

export function ViewProfileModal({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const [audit, setAudit] = useState<UserAuditEntry[]>([]);
  useEffect(() => {
    setAudit(getUserAuditFor(user.id, 10));
  }, [user.id]);

  const grantedModules = Object.entries(user.permissions).filter(([, p]) => p.view);

  return (
    <ModalShell onClose={onClose} wide>
      <ModalHeader title="User Profile" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.fullName} photoDataUrl={user.photoDataUrl} size={64} />
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">{user.fullName}</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">{user.designation || user.department || user.username}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <RoleBadge role={user.role} />
              <StatusPill status={user.status} />
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <DetailRow label="Username" value={user.username} />
          <DetailRow label="Email" value={user.email} />
          <DetailRow label="Phone" value={user.phone} />
          <DetailRow label="Employee ID" value={user.employeeId} />
          <DetailRow label="Department" value={user.department} />
          <DetailRow label="Designation" value={user.designation} />
          <DetailRow label="Created" value={fmt(user.createdAt)} />
          <DetailRow label="Created By" value={user.createdBy} />
          <DetailRow label="Last Login" value={fmt(user.lastLoginAt)} />
        </dl>

        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Access — {grantedModules.length} module{grantedModules.length === 1 ? "" : "s"} granted
          </p>
          {grantedModules.length === 0 ? (
            <p className="text-sm text-slate-400">No modules granted.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {grantedModules.map(([key]) => (
                <li key={key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {moduleLabel(key as ModuleKey)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent Activity</p>
          {audit.length === 0 ? (
            <p className="text-sm text-slate-400">No recorded activity for this user yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light">
                    <Icon name="clock" size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                    {USER_AUDIT_ACTION_LABELS[a.action]} <span className="text-slate-400">by {a.performedBy}</span>
                  </span>
                  <span className="flex-none text-xs text-slate-400">{fmt(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
