"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Menu, type MenuItem } from "@/components/overlay";
import type { PublicUser } from "@/lib/users";
import { Avatar, RoleBadge, StatusPill } from "./ui";

function fmt(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function UserTable({
  users,
  currentUsername,
  onView,
  onEdit,
  onResetPassword,
  onChangeRole,
  onToggleStatus,
  onDelete,
}: {
  users: PublicUser[];
  currentUsername: string;
  onView: (u: PublicUser) => void;
  onEdit: (u: PublicUser) => void;
  onResetPassword: (u: PublicUser) => void;
  onChangeRole: (u: PublicUser) => void;
  onToggleStatus: (u: PublicUser) => void;
  onDelete: (u: PublicUser) => void;
}) {
  const [menu, setMenu] = useState<{ user: PublicUser; anchorEl: HTMLElement } | null>(null);

  if (users.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-slate-400">No users yet.</p>;
  }

  const buildItems = (u: PublicUser): MenuItem[] => {
    const isSelf = u.username.toLowerCase() === currentUsername.toLowerCase();
    return [
      { icon: "eye", label: "View Profile", onClick: () => onView(u) },
      { icon: "pencil", label: "Edit User", onClick: () => onEdit(u) },
      { icon: "key", label: "Reset Password", onClick: () => onResetPassword(u) },
      { icon: "shield", label: "Change Role", onClick: () => onChangeRole(u) },
      { separator: true },
      {
        icon: u.status === "active" ? "close" : "check",
        label: u.status === "active" ? "Inactivate" : "Activate",
        onClick: () => onToggleStatus(u),
      },
      { separator: true },
      {
        icon: "trash",
        label: "Delete User",
        danger: true,
        disabled: isSelf,
        onClick: () => onDelete(u),
      },
    ];
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs dark:bg-slate-800/60">
          <tr className="text-left text-slate-500 dark:text-slate-400">
            <th className="px-3 py-2.5 font-semibold">User</th>
            <th className="px-3 py-2.5 font-semibold">Role</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Last Login</th>
            <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.username.toLowerCase() === currentUsername.toLowerCase();
            return (
              <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.fullName} photoDataUrl={u.photoDataUrl} size={32} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                        {u.fullName} {isSelf && <span className="text-xs font-normal text-slate-400">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.username}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5"><RoleBadge role={u.role} /></td>
                <td className="px-3 py-2.5"><StatusPill status={u.status} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-slate-400">{fmt(u.lastLoginAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    onClick={(e) => setMenu({ user: u, anchorEl: e.currentTarget })}
                    className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"
                  >
                    <Icon name="dots" size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu && <Menu anchorEl={menu.anchorEl} items={buildItems(menu.user)} onClose={() => setMenu(null)} width={200} />}
    </div>
  );
}
