"use client";

/*
  Theme — single source of truth for light/dark mode.
  ====================================================
  Extracted from AppShell so any screen (e.g. Settings) can change the theme and
  have every other mounted component (the header toggle, AppShell) stay in sync,
  the same way lib/auth's onAuthChange keeps the sidebar's "Signed in as" in sync.
  The inline script in <head> (see app/layout.tsx) applies the initial class
  before paint — this module only takes over from there.
*/

export type Theme = "light" | "dark";

const KEY = "theme";
const EVENT = "ar-theme-change";

/** Current theme, read from the DOM (safe to call on the server: returns "light"). */
export function getTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Apply + persist a theme and notify every listener (this tab included). */
export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Run `cb` whenever the theme changes (from any component). Returns an unsubscribe. */
export function onThemeChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
