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
const NOTE = "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400";
const ATTACH = "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400";
const SYSTEM = "bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300";

export const ACTION_META: Record<ActivityAction, ActionMeta> = {
  created: { label: "Created", icon: "plus", category: "modification", tone: CREATE },
  updated: { label: "Field changed", icon: "pencil", category: "modification", tone: UPDATE },
  status_changed: { label: "Status changed", icon: "check", category: "modification", tone: STATUS },
  deleted: { label: "Deleted", icon: "trash", category: "modification", tone: DANGER },
  restored: { label: "Restored", icon: "clock", category: "modification", tone: UPDATE },
  relationship_changed: { label: "Relationship changed", icon: "link", category: "modification", tone: STATUS },
  viewed: { label: "Viewed", icon: "eye", category: "system", tone: SYSTEM },
  note_added: { label: "Note added", icon: "file", category: "notes", tone: NOTE },
  note_updated: { label: "Note updated", icon: "file", category: "notes", tone: NOTE },
  note_deleted: { label: "Note removed", icon: "file", category: "notes", tone: NOTE },
  attachment_uploaded: { label: "File uploaded", icon: "upload", category: "attachments", tone: ATTACH },
  attachment_downloaded: { label: "File downloaded", icon: "download", category: "attachments", tone: ATTACH },
  attachment_deleted: { label: "File deleted", icon: "trash", category: "attachments", tone: DANGER },
  attachment_replaced: { label: "File replaced", icon: "upload", category: "attachments", tone: ATTACH },
  attachment_renamed: { label: "File renamed", icon: "pencil", category: "attachments", tone: ATTACH },
  attachment_tagged: { label: "File tagged", icon: "star", category: "attachments", tone: ATTACH },
  attachment_restored: { label: "Version restored", icon: "clock", category: "attachments", tone: ATTACH },
  imported: { label: "Imported", icon: "upload", category: "system", tone: SYSTEM },
  exported: { label: "Exported", icon: "download", category: "system", tone: SYSTEM },
  printed: { label: "Printed", icon: "file", category: "system", tone: SYSTEM },
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
  { key: "all", label: "All activity" },
  { key: "modification", label: "Modifications" },
  { key: "attachments", label: "Attachments" },
  { key: "notes", label: "Notes" },
  { key: "system", label: "System" },
];
