"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Nav";
import { AppHeader } from "./AppHeader";
import { getTheme, setTheme as applyTheme, onThemeChange } from "@/lib/theme";

/*
  Client shell that owns the presentation state shared by the sidebar + header
  (theme, sidebar collapse, mobile drawer) and lays out the page. The server
  RootLayout renders <AppShell>{children}</AppShell>, so pages stay server-rendered.
  The initial theme class is applied by an inline script in <head> (no flash); this
  component just syncs its React state to whatever that script decided.
*/
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(getTheme());
    try {
      setCollapsed(localStorage.getItem("nav.collapsed") === "1");
    } catch {
      /* ignore */
    }
    // Stay in sync when the theme is changed elsewhere (e.g. the Settings page).
    return onThemeChange(() => setTheme(getTheme()));
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(getTheme() === "dark" ? "light" : "dark");
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("nav.collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 print:h-auto print:overflow-visible print:bg-white dark:bg-slate-950">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader theme={theme} onToggleTheme={toggleTheme} onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 print:overflow-visible print:p-0 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
