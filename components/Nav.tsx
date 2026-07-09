"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "./icons";
import { getSession, signOut, onAuthChange } from "@/lib/auth";
import { hasPermission, useCurrentAccess, type ModuleKey, type Permissions } from "@/lib/users";

/*
  Premium collapsible sidebar (app-wide shell).
  Functionality preserved from the original: the SAME routes and the SAME `built`
  gate — unbuilt screens render as a non-navigable "build me" item, built ones as
  real links with active highlighting. Only the presentation changed.

  The footer shows who's signed in and a "Log out" button wired to the app's
  sign-in gate (see lib/auth + AuthGate): logging out clears the session and drops
  back to the login screen.
*/

export interface NavLink {
  /** Leaf links have an href. Group parents (with `children`) omit it. */
  href?: string;
  label: string;
  icon: IconName;
  built: boolean;
  /** Presence turns this item into an expandable/collapsible group. Scalable —
   *  add more report pages here without touching the sidebar markup. */
  children?: NavLink[];
  /** Which module governs this link's visibility (Users & Access permissions).
   *  Omit for always-visible items (e.g. Home). */
  moduleKey?: ModuleKey;
}
export interface NavSection {
  heading: string | null;
  links: NavLink[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Main",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "grid", built: true, moduleKey: "dashboard" },
      { href: "/", label: "Home", icon: "home", built: true },
    ],
  },
  {
    heading: "Masters",
    links: [
      { href: "/masters/customers", label: "Customer Master", icon: "users", built: true, moduleKey: "customers" },
      { href: "/masters/gl", label: "GL Master", icon: "book", built: true, moduleKey: "gl" },
    ],
  },
  {
    heading: "Sales",
    links: [
      { href: "/invoices", label: "Sales Invoices", icon: "file", built: true, moduleKey: "invoices" },
      { href: "/receipts", label: "Receipt Entry", icon: "receipt", built: true, moduleKey: "receipts" },
      { href: "/upload", label: "Upload Report", icon: "upload", built: true, moduleKey: "upload" },
    ],
  },
  {
    heading: "Collections",
    links: [
      { href: "/reminders", label: "AR Followup", icon: "mail", built: true, moduleKey: "followups" },
      { href: "/reminders/template", label: "Reminder Templates", icon: "pencil", built: true, moduleKey: "reminderTemplates" },
      { href: "/reports/statement", label: "Customer Statement", icon: "scroll", built: true, moduleKey: "statement" },
    ],
  },
  {
    heading: "System",
    links: [
      {
        // Expandable Reports group — add Trial Balance, Balance Sheet, P&L,
        // Cash Flow Statement, General Ledger, etc. as children later.
        label: "Reports",
        icon: "file",
        built: true,
        children: [
          { href: "/reports/ageing", label: "AR Ageing", icon: "bars", built: true, moduleKey: "reports" },
          { href: "/cashflow", label: "Cashflow Projection", icon: "trend", built: true, moduleKey: "reports" },
        ],
      },
      { href: "/settings", label: "Settings", icon: "settings", built: true, moduleKey: "settings" },
    ],
  },
];

/** Which nav items this permission matrix allows the sidebar to show. */
function isNavItemVisible(l: NavLink, permissions: Permissions | null): boolean {
  if (!l.moduleKey) return true; // ungated (e.g. Home)
  return hasPermission(permissions, l.moduleKey, "view");
}

/** Filter NAV_SECTIONS down to what this user may see — hides empty groups/sections too. */
export function visibleNavSections(permissions: Permissions | null): NavSection[] {
  return NAV_SECTIONS.map((section) => {
    const links = section.links
      .map((l): NavLink | null => {
        if (l.children?.length) {
          const kids = l.children.filter((c) => isNavItemVisible(c, permissions));
          return kids.length > 0 ? { ...l, children: kids } : null;
        }
        return isNavItemVisible(l, permissions) ? l : null;
      })
      .filter((l): l is NavLink => l != null);
    return { ...section, links };
  }).filter((s) => s.links.length > 0);
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  // Expand/collapse state per group. `undefined` = follow the default (auto-open
  // when a child route is active); an explicit boolean overrides it.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { user } = useCurrentAccess();
  const sections = useMemo(() => visibleNavSections(user?.permissions ?? null), [user]);

  useEffect(() => {
    const sync = () => setName(getSession()?.name ?? null);
    sync();
    return onAuthChange(sync);
  }, []);

  // Clears the session; AuthGate notices and swaps the app back to the login.
  const logout = () => signOut();

  const base = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    collapsed ? "justify-center" : ""
  }`;

  // A single leaf link (built → real Link, unbuilt → non-navigable "soon" item).
  const leaf = (l: NavLink, indented = false) => {
    const active = pathname === l.href;
    const cls = `${base} ${indented && !collapsed ? "pl-9" : ""}`;
    const content = (
      <>
        <span className="flex-none">
          <Icon name={l.icon} size={indented ? 17 : 19} />
        </span>
        {!collapsed && <span className="truncate">{l.label}</span>}
        {!collapsed && !l.built && (
          <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
            soon
          </span>
        )}
      </>
    );
    if (!l.built || !l.href) {
      return (
        <li key={l.label}>
          <span title={collapsed ? `${l.label} (coming soon)` : undefined} className={`${cls} cursor-default text-slate-500`}>
            {content}
          </span>
        </li>
      );
    }
    return (
      <li key={l.href}>
        <Link
          href={l.href}
          onClick={onCloseMobile}
          title={collapsed ? l.label : undefined}
          aria-current={active ? "page" : undefined}
          className={`${cls} ${
            active ? "bg-white/10 text-white shadow-inner ring-1 ring-white/10" : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`}
        >
          {content}
        </Link>
      </li>
    );
  };

  // A nav item: either a leaf, or an expandable group when it has children.
  const renderItem = (l: NavLink) => {
    if (!l.children?.length) return leaf(l);
    // In the collapsed (icon-only) rail, flatten children to reachable icons.
    if (collapsed) return l.children.map((c) => leaf(c));

    const hasActiveChild = l.children.some((c) => c.href === pathname);
    const open = openGroups[l.label] ?? hasActiveChild;
    return (
      <li key={l.label}>
        <button
          type="button"
          onClick={() => setOpenGroups((s) => ({ ...s, [l.label]: !open }))}
          aria-expanded={open}
          className={`${base} w-full ${hasActiveChild ? "text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
        >
          <span className="flex-none">
            <Icon name={l.icon} size={19} />
          </span>
          <span className="truncate">{l.label}</span>
          <span className={`ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
            <Icon name="chevronRight" size={16} />
          </span>
        </button>
        {open && (
          <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-1">
            {l.children.map((c) => leaf(c, true))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      {/* mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[4000] bg-slate-900/50 backdrop-blur-sm lg:hidden" onClick={onCloseMobile} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[4001] flex flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 text-slate-300 shadow-xl transition-[width,transform] duration-200 ease-out print:hidden lg:static lg:z-auto lg:translate-x-0 ${
          collapsed ? "w-[76px]" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand — VERVE / AR Manager only */}
        <div className="flex items-center border-b border-white/10 px-5 py-5">
          {collapsed ? (
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-light to-brand text-base font-bold text-white shadow-inner">
              V
            </div>
          ) : (
            <div className="leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brand-light">Verve</p>
              <h1 className="text-lg font-bold text-white">AR Manager</h1>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.heading ?? "top"} className="mb-4">
              {section.heading && !collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {section.heading}
                </p>
              )}
              <ul className="space-y-0.5">{section.links.map((l) => renderItem(l))}</ul>
            </div>
          ))}
        </nav>

        {/* Footer: signed-in user + collapse toggle + logout */}
        <div className="border-t border-white/10 p-3">
          {!collapsed && name && (
            <p className="px-3 pb-2 text-[11px] text-slate-500">
              Signed in as <span className="font-medium text-slate-300">{name}</span>
            </p>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white lg:flex ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={19} />
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            type="button"
            onClick={logout}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-300 ${
              collapsed ? "justify-center" : ""
            }`}
            title="Log out"
          >
            <Icon name="logout" size={19} />
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
