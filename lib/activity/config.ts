/*
  Activity Center — action metadata (labels, icons, colours, categories).
  Client-safe; the UI renders itself from this so adding an action is one line.
*/

import type { IconName } from "@/components/icons";
import type { ActivityAction, ActivityCategory } from "./types";

export interface ActionMeta {
  label: string;
  icon: IconName;
  category: ActivityCategory;
  /** Tailwind chip classes (light + dark). */
  tone: string;
}

const CREATE = "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400";
const UPDATE = "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400";
const STATUS = "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400";
const DANGER = "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400";
const SYSTEM = "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300";

export const ACTION_META: Record<ActivityAction, ActionMeta> = {
  // Record Changes
  created: { label: "Account created", icon: "plus", category: "record", tone: CREATE },
  updated: { label: "Field changed", icon: "pencil", category: "record", tone: UPDATE },
  status_changed: { label: "Status changed", icon: "check", category: "record", tone: STATUS },
  deleted: { label: "Account deleted", icon: "trash", category: "record", tone: DANGER },
  restored: { label: "Restored", icon: "clock", category: "record", tone: UPDATE },
  relationship_changed: { label: "Parent / sub-account changed", icon: "link", category: "record", tone: STATUS },
  // System Events
  imported: { label: "Import completed", icon: "upload", category: "system", tone: SYSTEM },
  exported: { label: "Export generated", icon: "download", category: "system", tone: SYSTEM },
  printed: { label: "Print generated", icon: "file", category: "system", tone: SYSTEM },
  numbered: { label: "Auto numbering", icon: "bars", category: "system", tone: SYSTEM },
  validated: { label: "Background validation", icon: "check", category: "system", tone: SYSTEM },
  recalculated: { label: "Balance recalculation", icon: "trend", category: "system", tone: SYSTEM },
  synchronized: { label: "Synchronization", icon: "link", category: "system", tone: SYSTEM },
  migrated: { label: "Data migration", icon: "upload", category: "system", tone: SYSTEM },
  version: { label: "Version", icon: "clock", category: "system", tone: SYSTEM },
};

export function actionMeta(action: ActivityAction): ActionMeta {
  return ACTION_META[action] ?? { label: action, icon: "clock", category: "system", tone: SYSTEM };
}

export interface CategoryFilter {
  key: ActivityCategory | "all";
  label: string;
}
export const ACTIVITY_CATEGORIES: CategoryFilter[] = [
  { key: "all", label: "All Activity" },
  { key: "record", label: "Record Changes" },
  { key: "system", label: "System Events" },
];
