"use client";

/*
  Users & Access — small local UI primitives shared by the modals + table.
  Styled to match the rest of the app (same pattern every screen follows:
  its own local Btn/Card rather than a shared global one).
*/

import { Icon, type IconName } from "@/components/icons";
import type { RoleId, UserStatus } from "@/lib/users";
import { roleLabel } from "@/lib/users";

export function Btn({
  children,
  onClick,
  variant = "ghost",
  type = "button",
  disabled,
  icon,
  title,
  form,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  icon?: IconName;
  title?: string;
  /** id of a <form> elsewhere in the DOM — lets a footer button outside the
   *  <form> tag still submit it (used by modals whose footer sits below a
   *  scrollable form body). */
  form?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark shadow-sm"
      : variant === "danger"
        ? "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function ModalShell({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className={`relative z-10 flex max-h-[90vh] w-full ${
          wide ? "max-w-2xl" : "max-w-md"
        } flex-col overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900`}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <div
          className={`mb-3 grid h-11 w-11 place-items-center rounded-full ${
            danger ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400" : "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light"
          }`}
        >
          <Icon name={danger ? "trash" : "check"} size={20} />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

const ROLE_TONE: Record<RoleId, string> = {
  administrator: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
  ar_manager: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400",
  accountant: "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400",
  ar_executive: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  viewer: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
  custom: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-400",
};

export function RoleBadge({ role }: { role: RoleId }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_TONE[role]}`}>
      {roleLabel(role)}
    </span>
  );
}

export function StatusPill({ status }: { status: UserStatus }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function Avatar({ name, photoDataUrl, size = 36 }: { name: string; photoDataUrl?: string | null; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (photoDataUrl) {
    return (
      <img
        src={photoDataUrl}
        alt={name}
        style={{ width: size, height: size }}
        className="flex-none rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="grid flex-none place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand dark:bg-brand/15 dark:text-brand-light"
    >
      {initials || "?"}
    </span>
  );
}
