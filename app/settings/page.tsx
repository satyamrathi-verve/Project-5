"use client";

/*
  Settings — lightweight, AR-Manager-appropriate configuration screen.
  =====================================================================
  Five sections: General, Users & Access, Notifications, System, Preferences.
  Deliberately NOT a full ERP config suite (no chart-of-accounts rules, tax
  engines, workflow builders, etc.) — just the practical settings a small AR
  team actually touches.

  What's real vs. demo, transparently:
    • Company Information — genuine Supabase read/write on the existing
      `company` table (same one invoices/reports already read).
    • Theme — the app's real light/dark mode (lib/theme.ts), applies instantly.
    • Login Sessions — the real signed-in session + this browser's real user
      agent, with a working "Sign out" action.
    • Activity Logs / Storage Usage / Demo Data Reset — real, computed from
      this browser's own data (lib/activity, lib/settings).
    • Everything else (date format, currency display, notifications,
      preferences) is a per-browser preference: Save genuinely persists it,
      Reset genuinely restores the default — there's just no backend table for
      it yet, exactly like GL notes/favourites.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { Icon, type IconName } from "@/components/icons";
import { Switch } from "@/components/Switch";
import { getSession, signOut } from "@/lib/auth";
import { getTheme, setTheme, onThemeChange, type Theme } from "@/lib/theme";
import { NAV_SECTIONS } from "@/components/Nav";
import {
  getAllUsers,
  setStatus as setUserStatus,
  deleteUser,
  defaultPermissionsForRole,
  moduleLabel,
  ROLE_DEFS,
  onUsersChange,
  type PublicUser,
} from "@/lib/users";
import { UserFormModal } from "@/components/users/UserFormModal";
import { ResetPasswordModal } from "@/components/users/ResetPasswordModal";
import { ChangeRoleModal } from "@/components/users/ChangeRoleModal";
import { ViewProfileModal } from "@/components/users/ViewProfileModal";
import { UserTable } from "@/components/users/UserTable";
import { AuditList } from "@/components/users/AuditList";
import {
  getSettings,
  saveSettings,
  resetSettingsFields,
  computeStorageUsage,
  resetDemoData,
  APP_VERSION,
  type AppSettings,
  type CurrencyDisplay,
  type DateFormat,
  type TableDensity,
} from "@/lib/settings";
import { getAllActivity, countAllActivity, clearActivity, actionMeta, type ActivityEvent } from "@/lib/activity";

type TabId = "general" | "access" | "notifications" | "system" | "preferences";
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "access", label: "Users & Access", icon: "users" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "system", label: "System", icon: "grid" },
  { id: "preferences", label: "Preferences", icon: "star" },
];

const DEFAULT_DASHBOARD_OPTIONS = NAV_SECTIONS.flatMap((s) => s.links.flatMap((l) => l.children ?? [l])).filter(
  (l) => l.built && l.href,
);

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setSettingsState] = useState<AppSettings>(() => getSettings());
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  const flash = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    setSettingsState(getSettings());
  }, []);

  const onSaved = useCallback(
    (patch: Partial<AppSettings>, msg = "Saved.") => {
      setSettingsState(saveSettings(patch));
      flash(msg);
    },
    [flash],
  );
  const onReset = useCallback(
    (keys: (keyof AppSettings)[], msg = "Reset to defaults.") => {
      setSettingsState(resetSettingsFields(keys));
      flash(msg);
    },
    [flash],
  );

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure how the AR Manager looks and behaves for you." />

      <div className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-brand text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && <GeneralTab settings={settings} onSaved={onSaved} onReset={onReset} flash={flash} />}
      {tab === "access" && <AccessTab flash={flash} />}
      {tab === "notifications" && <NotificationsTab settings={settings} onSaved={onSaved} onReset={onReset} />}
      {tab === "system" && <SystemTab flash={flash} />}
      {tab === "preferences" && <PreferencesTab settings={settings} onSaved={onSaved} onReset={onReset} />}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[5000] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-soft ${
            toast.tone === "ok" ? "bg-slate-900 dark:bg-slate-700" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Shared local primitives
// ===========================================================================

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  icon?: IconName;
}) {
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark shadow-sm"
      : variant === "danger"
        ? "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/** A labelled row with a control on the right — the workhorse of every preference card. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

function SaveResetBar({ onSave, onReset, dirty }: { onSave: () => void; onReset: () => void; dirty: boolean }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
      <Btn onClick={onReset}>Reset to defaults</Btn>
      <Btn variant="primary" icon="check" onClick={onSave} disabled={!dirty}>
        Save changes
      </Btn>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="trash" size={20} />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// General
// ===========================================================================

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY  (10/07/2026)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY  (07/10/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD  (2026-07-10)" },
];
const CURRENCIES: { value: CurrencyDisplay; label: string }[] = [
  { value: "INR", label: "₹ Indian Rupee (INR)" },
  { value: "USD", label: "$ US Dollar (USD)" },
  { value: "EUR", label: "€ Euro (EUR)" },
  { value: "GBP", label: "£ British Pound (GBP)" },
];
const TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

function GeneralTab({
  settings,
  onSaved,
  onReset,
  flash,
}: {
  settings: AppSettings;
  onSaved: (patch: Partial<AppSettings>, msg?: string) => void;
  onReset: (keys: (keyof AppSettings)[], msg?: string) => void;
  flash: (msg: string, tone?: "ok" | "err") => void;
}) {
  const [draft, setDraft] = useState({
    dateFormat: settings.dateFormat,
    currencyDisplay: settings.currencyDisplay,
    timeZone: settings.timeZone,
  });
  useEffect(() => {
    setDraft({ dateFormat: settings.dateFormat, currencyDisplay: settings.currencyDisplay, timeZone: settings.timeZone });
  }, [settings]);
  const dirty =
    draft.dateFormat !== settings.dateFormat || draft.currencyDisplay !== settings.currencyDisplay || draft.timeZone !== settings.timeZone;

  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    setThemeState(getTheme());
    return onThemeChange(() => setThemeState(getTheme()));
  }, []);

  return (
    <div className="space-y-4">
      <CompanyInfoCard flash={flash} />

      <Card title="Display &amp; Regional" subtitle="How dates, currency and time appear across the app.">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Row label="Theme" hint="Applies immediately — no need to save.">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className={`${inputClass} w-40 py-1.5 text-sm`}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
          <Row label="Date Format">
            <select
              value={draft.dateFormat}
              onChange={(e) => setDraft((d) => ({ ...d, dateFormat: e.target.value as DateFormat }))}
              className={`${inputClass} w-56 py-1.5 text-sm`}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Row>
          <Row label="Currency Display">
            <select
              value={draft.currencyDisplay}
              onChange={(e) => setDraft((d) => ({ ...d, currencyDisplay: e.target.value as CurrencyDisplay }))}
              className={`${inputClass} w-56 py-1.5 text-sm`}
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Row>
          <Row label="Time Zone">
            <select
              value={draft.timeZone}
              onChange={(e) => setDraft((d) => ({ ...d, timeZone: e.target.value }))}
              className={`${inputClass} w-56 py-1.5 text-sm`}
            >
              {TIME_ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </Row>
        </div>
        <SaveResetBar
          dirty={dirty}
          onSave={() => onSaved(draft, "Display preferences saved.")}
          onReset={() => onReset(["dateFormat", "currencyDisplay", "timeZone"])}
        />
      </Card>
    </div>
  );
}

function CompanyInfoCard({ flash }: { flash: (msg: string, tone?: "ok" | "err") => void }) {
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [draft, setDraft] = useState<Partial<Company>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("company")
      .select("*")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCompany((data as Company) ?? null);
        setDraft((data as Company) ?? {});
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isConfigured) {
    return (
      <Card title="Company Information" subtitle="Used on invoices and reports.">
        <NotConfigured />
      </Card>
    );
  }

  const dirty =
    !!company &&
    (draft.name !== company.name ||
      draft.address !== company.address ||
      draft.gstin !== company.gstin ||
      draft.email !== company.email ||
      draft.phone !== company.phone);

  const save = async () => {
    if (!supabase || !company) return;
    setSaving(true);
    const { error } = await supabase
      .from("company")
      .update({ name: draft.name, address: draft.address, gstin: draft.gstin, email: draft.email, phone: draft.phone })
      .eq("id", company.id);
    setSaving(false);
    if (error) {
      flash(`Could not save: ${error.message}`, "err");
      return;
    }
    setCompany({ ...company, ...draft } as Company);
    flash("Company details updated.");
  };

  return (
    <Card title="Company Information" subtitle="Used on invoices, statements and reports — shared with the whole team.">
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !company ? (
        <p className="text-sm text-slate-400">No company record found.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Company name">
              <input value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={inputClass} />
            </FormField>
            <FormField label="GSTIN">
              <input value={draft.gstin ?? ""} onChange={(e) => setDraft((d) => ({ ...d, gstin: e.target.value }))} className={inputClass} />
            </FormField>
            <FormField label="Email">
              <input value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} className={inputClass} />
            </FormField>
            <FormField label="Phone">
              <input value={draft.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} className={inputClass} />
            </FormField>
            <FormField label="Address">
              <textarea
                value={draft.address ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
                rows={2}
                className={`${inputClass} sm:col-span-2`}
              />
            </FormField>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Btn onClick={() => setDraft(company)} disabled={!dirty}>Discard</Btn>
            <Btn variant="primary" icon="check" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Btn>
          </div>
        </>
      )}
    </Card>
  );
}

// ===========================================================================
// Users & Access
// ===========================================================================

function parseUserAgent(ua: string): { browser: string; os: string } {
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//.test(ua)
    ? "Microsoft Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Unknown browser";
  return { browser, os };
}

type AccessModal =
  | { type: "create" }
  | { type: "edit"; user: PublicUser }
  | { type: "view"; user: PublicUser }
  | { type: "resetPassword"; user: PublicUser }
  | { type: "changeRole"; user: PublicUser }
  | { type: "delete"; user: PublicUser }
  | null;

function AccessTab({ flash }: { flash: (msg: string, tone?: "ok" | "err") => void }) {
  const session = getSession();
  const performedBy = session?.name ?? "Unknown";
  const [device, setDevice] = useState<{ browser: string; os: string } | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [modal, setModal] = useState<AccessModal>(null);
  const [roleRefOpen, setRoleRefOpen] = useState(false);

  const refreshUsers = useCallback(() => {
    void getAllUsers().then((list) => setUsers(list.sort((a, b) => a.fullName.localeCompare(b.fullName))));
  }, []);

  useEffect(() => {
    if (typeof navigator !== "undefined") setDevice(parseUserAgent(navigator.userAgent));
    refreshUsers();
    return onUsersChange(refreshUsers);
  }, [refreshUsers]);

  const toggleStatus = async (u: PublicUser) => {
    const next = u.status === "active" ? "inactive" : "active";
    const res = await setUserStatus(u.id, next, performedBy);
    if (!res.ok) return flash(res.error, "err");
    flash(`${u.fullName} is now ${next}.`);
  };

  const confirmDelete = async (u: PublicUser) => {
    const res = await deleteUser(u.id, performedBy);
    setModal(null);
    if (!res.ok) return flash(res.error, "err");
    flash(`${u.fullName} was deleted.`);
  };

  return (
    <div className="space-y-4">
      <Card
        title="User Management"
        subtitle={`${users.length} user${users.length === 1 ? "" : "s"} · credentials, roles and permissions are created here and work immediately on the sign-in page.`}
        action={
          <Btn variant="primary" icon="plus" onClick={() => setModal({ type: "create" })}>
            Add User
          </Btn>
        }
      >
        <UserTable
          users={users}
          currentUsername={session?.username ?? ""}
          onView={(u) => setModal({ type: "view", user: u })}
          onEdit={(u) => setModal({ type: "edit", user: u })}
          onResetPassword={(u) => setModal({ type: "resetPassword", user: u })}
          onChangeRole={(u) => setModal({ type: "changeRole", user: u })}
          onToggleStatus={(u) => void toggleStatus(u)}
          onDelete={(u) => setModal({ type: "delete", user: u })}
        />
      </Card>

      <Card
        title="Recent User Activity"
        subtitle="Every create, edit, password reset, role change and status change is recorded here — permanently, not clearable."
      >
        <AuditList />
      </Card>

      <Card
        title="Roles &amp; Permissions"
        subtitle="What each built-in role grants by default. Pick Custom Role on a user to fine-tune individually."
        action={
          <button onClick={() => setRoleRefOpen((v) => !v)} className="text-xs font-medium text-brand hover:underline dark:text-brand-light">
            {roleRefOpen ? "Hide details" : "Show details"}
          </button>
        }
      >
        <div className="space-y-3">
          {ROLE_DEFS.map((r) => {
            const perms = defaultPermissionsForRole(r.id);
            const granted = Object.entries(perms).filter(([, p]) => p.view);
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.label}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                {roleRefOpen && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {granted.length === 0 ? (
                      <span className="text-xs text-slate-400">No modules by default — configured per user.</span>
                    ) : (
                      granted.map(([key, p]) => (
                        <span
                          key={key}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {moduleLabel(key as Parameters<typeof moduleLabel>[0])}
                          {p.create || p.edit || p.delete ? " · full" : " · view"}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Login Sessions" subtitle="Your current sign-in on this device.">
        {session ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light">
                <Icon name="users" size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{session.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {device ? `${device.browser} on ${device.os}` : "This device"} · Current session
                </p>
              </div>
            </div>
            <Btn
              variant="danger"
              icon="logout"
              onClick={() => {
                signOut();
                flash("Signed out.");
              }}
            >
              Sign out
            </Btn>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No active session.</p>
        )}
      </Card>

      <Card title="Password Policy" subtitle="Enforced when an administrator sets or resets a password.">
        <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-emerald-500" /> Minimum 8 characters</li>
          <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-emerald-500" /> Stored as a salted hash — never in plain text</li>
          <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-emerald-500" /> Only an Administrator can reset another user&apos;s password</li>
          <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-emerald-500" /> Inactive accounts cannot sign in</li>
        </ul>
      </Card>

      {(modal?.type === "create" || modal?.type === "edit") && (
        <UserFormModal
          mode={modal.type}
          initial={modal.type === "edit" ? modal.user : undefined}
          performedBy={performedBy}
          onClose={() => setModal(null)}
          onSaved={(msg) => flash(msg)}
        />
      )}
      {modal?.type === "view" && <ViewProfileModal user={modal.user} onClose={() => setModal(null)} />}
      {modal?.type === "resetPassword" && (
        <ResetPasswordModal user={modal.user} performedBy={performedBy} onClose={() => setModal(null)} onDone={(msg) => flash(msg)} />
      )}
      {modal?.type === "changeRole" && (
        <ChangeRoleModal user={modal.user} performedBy={performedBy} onClose={() => setModal(null)} onDone={(msg) => flash(msg)} />
      )}
      {modal?.type === "delete" && (
        <ConfirmModal
          title="Delete this user?"
          message={`${modal.user.fullName} will permanently lose access. This can't be undone.`}
          confirmLabel="Delete user"
          onCancel={() => setModal(null)}
          onConfirm={() => void confirmDelete(modal.user)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Notifications
// ===========================================================================

function NotificationsTab({
  settings,
  onSaved,
  onReset,
}: {
  settings: AppSettings;
  onSaved: (patch: Partial<AppSettings>, msg?: string) => void;
  onReset: (keys: (keyof AppSettings)[], msg?: string) => void;
}) {
  const [draft, setDraft] = useState({
    emailNotifications: settings.emailNotifications,
    reminderNotifications: settings.reminderNotifications,
    dueDateAlerts: settings.dueDateAlerts,
    dueDateAlertDays: settings.dueDateAlertDays,
  });
  useEffect(() => {
    setDraft({
      emailNotifications: settings.emailNotifications,
      reminderNotifications: settings.reminderNotifications,
      dueDateAlerts: settings.dueDateAlerts,
      dueDateAlertDays: settings.dueDateAlertDays,
    });
  }, [settings]);
  const dirty =
    draft.emailNotifications !== settings.emailNotifications ||
    draft.reminderNotifications !== settings.reminderNotifications ||
    draft.dueDateAlerts !== settings.dueDateAlerts ||
    draft.dueDateAlertDays !== settings.dueDateAlertDays;

  return (
    <Card title="Notifications" subtitle="Control what this AR Manager surfaces to you.">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <Row label="Email Notifications" hint="Get notified when invoices, receipts or customers change.">
          <Switch checked={draft.emailNotifications} onChange={(v) => setDraft((d) => ({ ...d, emailNotifications: v }))} />
        </Row>
        <Row label="Reminder Notifications" hint="Notify when an AR Followup email is generated and logged.">
          <Switch checked={draft.reminderNotifications} onChange={(v) => setDraft((d) => ({ ...d, reminderNotifications: v }))} />
        </Row>
        <Row label="Due Date Alerts" hint="Flag invoices approaching their due date.">
          <Switch checked={draft.dueDateAlerts} onChange={(v) => setDraft((d) => ({ ...d, dueDateAlerts: v }))} />
        </Row>
        <Row label="Alert lead time" hint="How many days before the due date to raise the alert.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={30}
              value={draft.dueDateAlertDays}
              disabled={!draft.dueDateAlerts}
              onChange={(e) => setDraft((d) => ({ ...d, dueDateAlertDays: Math.max(1, Number(e.target.value) || 1) }))}
              className={`${inputClass} w-20 py-1.5 text-sm disabled:opacity-50`}
            />
            <span className="text-xs text-slate-400">days</span>
          </div>
        </Row>
      </div>
      <SaveResetBar
        dirty={dirty}
        onSave={() => onSaved(draft, "Notification preferences saved.")}
        onReset={() => onReset(["emailNotifications", "reminderNotifications", "dueDateAlerts", "dueDateAlertDays"])}
      />
    </Card>
  );
}

// ===========================================================================
// System
// ===========================================================================

function SystemTab({ flash }: { flash: (msg: string, tone?: "ok" | "err") => void }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [usage, setUsage] = useState(() => computeStorageUsage());
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const refreshActivity = useCallback(() => {
    setEvents(getAllActivity(8));
    setTotal(countAllActivity());
  }, []);
  useEffect(() => refreshActivity(), [refreshActivity]);

  return (
    <div className="space-y-4">
      <Card
        title="Activity Logs"
        subtitle={`${total} event${total === 1 ? "" : "s"} recorded in this browser.`}
        action={
          <Btn variant="danger" icon="trash" onClick={() => setConfirmClear(true)} disabled={total === 0}>
            Clear
          </Btn>
        }
      >
        {events.length === 0 ? (
          <p className="text-sm text-slate-400">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {events.map((e) => {
              const meta = actionMeta(e.action);
              return (
                <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`grid h-7 w-7 flex-none place-items-center rounded-lg ${meta.tone}`}>
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{e.user}</span> · {meta.label} · {e.module}/{e.recordId}
                  </span>
                  <span className="flex-none text-xs text-slate-400">{new Date(e.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Application Version">
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p>Verve ERP — AR Manager</p>
            <p className="font-mono text-slate-800 dark:text-slate-100">v{APP_VERSION}</p>
            <p className="text-xs text-slate-400">{process.env.NODE_ENV === "production" ? "Production build" : "Development build"}</p>
          </div>
        </Card>

        <Card
          title="Storage Usage"
          action={
            <Btn icon="download" onClick={() => setUsage(computeStorageUsage())}>
              Recalculate
            </Btn>
          }
        >
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{usage.label}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {usage.keyCount} item{usage.keyCount === 1 ? "" : "s"} stored in this browser (favourites, notes, activity log, attachments cache).
          </p>
        </Card>
      </div>

      <Card title="Demo Data Reset" subtitle="Clears data generated while exploring this demo — favourites, notes, recent lists and the activity log.">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Your sign-in, theme and these Settings are kept. This only affects this browser.
        </p>
        <Btn variant="danger" icon="trash" onClick={() => setConfirmReset(true)}>
          Reset Demo Data
        </Btn>
      </Card>

      {confirmClear && (
        <ConfirmModal
          title="Clear the activity log?"
          message="All recorded record-change and system events in this browser will be permanently removed."
          confirmLabel="Clear log"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            clearActivity();
            refreshActivity();
            setConfirmClear(false);
            flash("Activity log cleared.");
          }}
        />
      )}
      {confirmReset && (
        <ConfirmModal
          title="Reset demo data?"
          message="Favourites, notes, recent lists, saved column filters and the activity log will be cleared from this browser."
          confirmLabel="Reset data"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            const n = resetDemoData();
            setConfirmReset(false);
            refreshActivity();
            setUsage(computeStorageUsage());
            flash(`Cleared ${n} demo item${n === 1 ? "" : "s"}.`);
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Preferences
// ===========================================================================

const PAGE_SIZES = [10, 25, 50, 100];
const RECENT_LIMITS = [5, 10, 15, 20];

function PreferencesTab({
  settings,
  onSaved,
  onReset,
}: {
  settings: AppSettings;
  onSaved: (patch: Partial<AppSettings>, msg?: string) => void;
  onReset: (keys: (keyof AppSettings)[], msg?: string) => void;
}) {
  const [draft, setDraft] = useState({
    defaultDashboard: settings.defaultDashboard,
    defaultPageSize: settings.defaultPageSize,
    tableDensity: settings.tableDensity,
    rememberFilters: settings.rememberFilters,
    autoSave: settings.autoSave,
    recentItemsLimit: settings.recentItemsLimit,
  });
  useEffect(() => {
    setDraft({
      defaultDashboard: settings.defaultDashboard,
      defaultPageSize: settings.defaultPageSize,
      tableDensity: settings.tableDensity,
      rememberFilters: settings.rememberFilters,
      autoSave: settings.autoSave,
      recentItemsLimit: settings.recentItemsLimit,
    });
  }, [settings]);
  const keys: (keyof AppSettings)[] = [
    "defaultDashboard",
    "defaultPageSize",
    "tableDensity",
    "rememberFilters",
    "autoSave",
    "recentItemsLimit",
  ];
  const dirty = keys.some((k) => (draft as unknown as Record<string, unknown>)[k] !== (settings as unknown as Record<string, unknown>)[k]);

  return (
    <Card title="Preferences" subtitle="Personal defaults for how you work in the AR Manager.">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <Row label="Default Landing Page" hint="Where you land after signing in.">
          <select
            value={draft.defaultDashboard}
            onChange={(e) => setDraft((d) => ({ ...d, defaultDashboard: e.target.value }))}
            className={`${inputClass} w-52 py-1.5 text-sm`}
          >
            {DEFAULT_DASHBOARD_OPTIONS.map((l) => (
              <option key={l.href} value={l.href}>{l.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Default Page Size" hint="Rows per page in lists and tables.">
          <select
            value={draft.defaultPageSize}
            onChange={(e) => setDraft((d) => ({ ...d, defaultPageSize: Number(e.target.value) }))}
            className={`${inputClass} w-28 py-1.5 text-sm`}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n} rows</option>
            ))}
          </select>
        </Row>
        <Row label="Table Density" hint="Compact is used throughout the app today.">
          <select
            value={draft.tableDensity}
            onChange={(e) => setDraft((d) => ({ ...d, tableDensity: e.target.value as TableDensity }))}
            className={`${inputClass} w-40 py-1.5 text-sm`}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </Row>
        <Row label="Remember Last Filters" hint="Reopen a list with the filters you left it with.">
          <Switch checked={draft.rememberFilters} onChange={(v) => setDraft((d) => ({ ...d, rememberFilters: v }))} />
        </Row>
        <Row label="Auto Save" hint="Save drafts automatically while you type.">
          <Switch checked={draft.autoSave} onChange={(v) => setDraft((d) => ({ ...d, autoSave: v }))} />
        </Row>
        <Row label="Recent Items Limit" hint="How many recently-viewed records to keep.">
          <select
            value={draft.recentItemsLimit}
            onChange={(e) => setDraft((d) => ({ ...d, recentItemsLimit: Number(e.target.value) }))}
            className={`${inputClass} w-28 py-1.5 text-sm`}
          >
            {RECENT_LIMITS.map((n) => (
              <option key={n} value={n}>{n} items</option>
            ))}
          </select>
        </Row>
      </div>
      <SaveResetBar dirty={dirty} onSave={() => onSaved(draft, "Preferences saved.")} onReset={() => onReset(keys)} />
    </Card>
  );
}
