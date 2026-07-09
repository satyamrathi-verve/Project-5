"use client";

/*
  App Settings — lightweight, per-browser preference store.
  ===========================================================
  Backs the Settings screen. There is no `settings` table in the fixed backend,
  so preferences persist in localStorage — the same pattern used for GL
  favourites/notes and the Activity log. Reading/writing is a plain merge over
  DEFAULT_SETTINGS, so a field added later never breaks an older saved blob.

  Theme is intentionally NOT stored here — it already has its own instantly-
  applied mechanism (lib/theme.ts) shared with the header toggle.
*/

import { formatSize } from "@/lib/attachments/config";

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type CurrencyDisplay = "INR" | "USD" | "EUR" | "GBP";
export type TableDensity = "compact" | "comfortable";

export interface AppSettings {
  // General
  dateFormat: DateFormat;
  currencyDisplay: CurrencyDisplay;
  timeZone: string;
  // Notifications
  emailNotifications: boolean;
  reminderNotifications: boolean;
  dueDateAlerts: boolean;
  dueDateAlertDays: number;
  // Preferences
  defaultDashboard: string; // route
  defaultPageSize: number;
  tableDensity: TableDensity;
  rememberFilters: boolean;
  autoSave: boolean;
  recentItemsLimit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dateFormat: "DD/MM/YYYY",
  currencyDisplay: "INR",
  timeZone: "Asia/Kolkata",
  emailNotifications: true,
  reminderNotifications: true,
  dueDateAlerts: true,
  dueDateAlertDays: 3,
  defaultDashboard: "/dashboard",
  defaultPageSize: 25,
  tableDensity: "compact",
  rememberFilters: true,
  autoSave: true,
  recentItemsLimit: 10,
};

const KEY = "app.settings.v1";
const EVENT = "ar-settings-change";

export function getSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Merge `patch` over the current settings, persist, and notify listeners. */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

/** Reset only the given fields to their defaults (used by each card's "Reset"). */
export function resetSettingsFields(keys: (keyof AppSettings)[]): AppSettings {
  const patch: Partial<AppSettings> = {};
  for (const k of keys) (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
  return saveSettings(patch);
}

export function onSettingsChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

// ── Application version ────────────────────────────────────────────────────
/** Keep in sync with package.json "version". */
export const APP_VERSION = "0.1.0";

// ── Storage usage (real, computed from this origin's localStorage) ─────────
export interface StorageUsage {
  bytes: number;
  keyCount: number;
  label: string;
}

export function computeStorageUsage(): StorageUsage {
  let bytes = 0;
  let keyCount = 0;
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        keyCount++;
        bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2; // UTF-16
      }
    } catch {
      /* storage unavailable */
    }
  }
  return { bytes, keyCount, label: formatSize(bytes) };
}

// ── Demo data reset (System settings) ───────────────────────────────────────
/**
 * Clears per-browser DEMO/generated content this app has written — favourites,
 * recent lists, notes, column filters, the activity log, followup notes — so
 * the app looks freshly seeded again. Deliberately leaves the signed-in session,
 * theme, sidebar collapse state and these Settings alone (those are the user's
 * own device preferences, not demo content).
 */
const FIXED_DEMO_KEYS = [
  "gl.favorites",
  "gl.recent",
  "gl.inactive",
  "gl.notes",
  "gl.colFilters",
  "activity.log.v1",
  "monthlyShoot.lastRun",
  "followups:lastBy",
  "customer_meta_v1",
];
const DEMO_KEY_PREFIXES = ["followups:"];

export function resetDemoData(): number {
  if (typeof window === "undefined") return 0;
  let cleared = 0;
  try {
    for (const k of FIXED_DEMO_KEYS) {
      if (localStorage.getItem(k) != null) {
        localStorage.removeItem(k);
        cleared++;
      }
    }
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && DEMO_KEY_PREFIXES.some((p) => k.startsWith(p)) && !FIXED_DEMO_KEYS.includes(k)) toRemove.push(k);
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
      cleared++;
    }
  } catch {
    /* ignore */
  }
  return cleared;
}
