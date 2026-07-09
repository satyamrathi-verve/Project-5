"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { getSession, signOut, onAuthChange } from "@/lib/auth";

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
  href: string;
  label: string;
  icon: IconName;
  built: boolean;
}
export interface NavSection {
  heading: string | null;
  links: NavLink[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Main",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "grid", built: false },
      { href: "/", label: "Home", icon: "home", built: true },
    ],
  },
  {
    heading: "Masters",
    links: [
      { href: "/masters/customers", label: "Customer Master", icon: "users", built: true },
      { href: "/masters/gl", label: "GL Master", icon: "book", built: true },
    ],
  },
  {
    heading: "Sales",
    links: [
      { href: "/invoices", label: "Sales Invoices", icon: "file", built: true },
      { href: "/receipts", label: "Receipt Entry", icon: "receipt", built: true },
      { href: "/upload", label: "Upload Report", icon: "upload", built: false },
    ],
  },
  {
    heading: "Collections",
    links: [
      { href: "/reminders", label: "AR Followup", icon: "mail", built: true },
      { href: "/reminders/template", label: "Reminder Template", icon: "pencil", built: true },
      { href: "/reports/statement", label: "Customer Statement", icon: "scroll", built: true },
      { href: "/reports/ageing", label: "AR Ageing", icon: "bars", built: true },
      { href: "/cashflow", label: "Cashflow Projection", icon: "trend", built: true },
    ],
  },
  {
    heading: "System",
    links: [
      { href: "/reports", label: "Reports", icon: "file", built: false },
      { href: "/settings", label: "Settings", icon: "settings", built: false },
    ],
  },
];

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

  useEffect(() => {
    const sync = () => setName(getSession()?.name ?? null);
    sync();
    return onAuthChange(sync);
  }, []);

  // Clears the session; AuthGate notices and swaps the app back to the login.
  const logout = () => signOut();

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
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading ?? "top"} className="mb-4">
              {section.heading && !collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {section.heading}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.links.map((l) => {
                  const active = pathname === l.href;
                  const content = (
                    <>
                      <span className="flex-none">
                        <Icon name={l.icon} size={19} />
                      </span>
                      {!collapsed && <span className="truncate">{l.label}</span>}
                      {!collapsed && !l.built && (
                        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                          soon
                        </span>
                      )}
                    </>
                  );
                  const base = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    collapsed ? "justify-center" : ""
                  }`;
                  if (!l.built) {
                    return (
                      <li key={l.href}>
                        <span
                          title={collapsed ? `${l.label} (coming soon)` : undefined}
                          className={`${base} cursor-default text-slate-500`}
                        >
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
                        className={`${base} ${
                          active
                            ? "bg-white/10 text-white shadow-inner ring-1 ring-white/10"
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {content}
                      </Link>
                    </li>
                  );
                })}
              </ul>
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
