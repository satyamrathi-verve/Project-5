"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { visibleNavSections } from "./Nav";
import { Popover, Z } from "@/components/overlay";
import { useCurrentAccess } from "@/lib/users";

type MenuId = "search" | "create" | "notif" | "settings";

/*
  App-wide sticky header. The global search is a functional quick-nav palette over
  the real routes (⌘K / Ctrl-K). Every dropdown (search, create, notifications,
  settings) renders through the shared overlay Popover — portaled to document.body
  so the header's backdrop-blur containing block can never clip them.
*/
export function AppHeader({
  theme,
  onToggleTheme,
  onOpenMobile,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenMobile: () => void;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const searchAnchor = useRef<HTMLDivElement>(null);
  const createAnchor = useRef<HTMLDivElement>(null);
  const notifAnchor = useRef<HTMLDivElement>(null);
  const settingsAnchor = useRef<HTMLDivElement>(null);

  const { user } = useCurrentAccess();
  // Flatten to navigable leaves the current user can actually see (expandable
  // group parents have no page of their own).
  const allLinks = useMemo(
    () => visibleNavSections(user?.permissions ?? null).flatMap((s) => s.links.flatMap((l) => l.children ?? [l])),
    [user],
  );
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLinks.filter((l) => !q || l.label.toLowerCase().includes(q));
  }, [allLinks, query]);

  const openSearch = useCallback(() => {
    setMenu("search");
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  const go = (href: string, built: boolean) => {
    if (!built) return;
    router.push(href);
    setMenu(null);
    setQuery("");
  };

  const toggle = (id: MenuId) => setMenu((m) => (m === id ? null : id));

  return (
    <header
      style={{ zIndex: Z.stickyHeader }}
      className="sticky top-0 flex h-16 flex-none items-center gap-2 border-b border-slate-200 bg-white/80 px-3 backdrop-blur-md print:hidden dark:border-slate-800 dark:bg-slate-900/80 sm:px-5"
    >
      {/* mobile menu */}
      <button
        type="button"
        onClick={onOpenMobile}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>

      {/* search */}
      <div ref={searchAnchor} className="relative w-full max-w-md">
        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600"
        >
          <Icon name="search" size={18} />
          <span className="hidden sm:inline">Search accounts, screens…</span>
          <kbd className="ml-auto hidden rounded border border-slate-300 bg-white px-1.5 text-[10px] font-medium text-slate-400 dark:border-slate-600 dark:bg-slate-700 sm:inline">
            ⌘K
          </kbd>
        </button>
        <Popover open={menu === "search"} anchorRef={searchAnchor} onClose={() => setMenu(null)} align="left" width={352} padded={false} layer="dropdown">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a screen…"
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No matches.</li>
            ) : (
              results.map((l) => (
                <li key={l.href ?? l.label}>
                  <button
                    type="button"
                    disabled={!l.built || !l.href}
                    onClick={() => l.href && go(l.href, l.built)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Icon name={l.icon} size={17} />
                    {l.label}
                    {!l.built && <span className="ml-auto text-[10px] uppercase text-slate-400">soon</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Popover>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Quick create */}
        <div ref={createAnchor} className="relative">
          <button
            type="button"
            onClick={() => toggle("create")}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <Icon name="plus" size={18} />
            <span className="hidden sm:inline">Create</span>
          </button>
          <Popover open={menu === "create"} anchorRef={createAnchor} onClose={() => setMenu(null)} align="left" width={224} layer="dropdown">
            <MenuItem icon="book" label="New GL Account" onClick={() => go("/masters/gl?new=1", true)} />
            <MenuItem icon="users" label="New Customer" onClick={() => go("/masters/customers", true)} />
          </Popover>
        </div>

        {/* Notifications */}
        <div ref={notifAnchor} className="relative">
          <IconAction label="Notifications" onClick={() => toggle("notif")}>
            <span className="relative">
              <Icon name="bell" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand ring-2 ring-white dark:ring-slate-900" />
            </span>
          </IconAction>
          <Popover open={menu === "notif"} anchorRef={notifAnchor} onClose={() => setMenu(null)} align="right" width={288} layer="dropdown">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</p>
            <div className="px-3 py-8 text-center text-sm text-slate-400">
              <Icon name="check" size={22} className="mx-auto mb-2 text-slate-300" />
              You&apos;re all caught up.
            </div>
          </Popover>
        </div>

        {/* Dark mode */}
        <IconAction label={theme === "dark" ? "Switch to light" : "Switch to dark"} onClick={onToggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </IconAction>

        {/* Settings */}
        <div ref={settingsAnchor} className="relative hidden sm:block">
          <IconAction label="Settings" onClick={() => toggle("settings")}>
            <Icon name="settings" />
          </IconAction>
          <Popover open={menu === "settings"} anchorRef={settingsAnchor} onClose={() => setMenu(null)} align="right" width={224} layer="dropdown">
            <MenuItem
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Light mode" : "Dark mode"}
              onClick={() => {
                onToggleTheme();
                setMenu(null);
              }}
            />
            <div className="px-3 py-2 text-xs text-slate-400">More preferences coming soon.</div>
          </Popover>
        </div>
      </div>
    </header>
  );
}

function IconAction({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      }`}
    >
      <Icon name={icon} size={17} />
      {label}
    </button>
  );
}
