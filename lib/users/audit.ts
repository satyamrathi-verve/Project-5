"use client";

/*
  Users & Access — dedicated audit trail.
  ========================================
  Separate from the general Activity Center (Settings > System > Activity Logs,
  which is scoped to business-record changes) because User Management audit
  entries have a distinct shape the spec calls for explicitly: Date & Time,
  Action, Performed By, Target User, Previous Value, New Value. Persisted the
  same way (localStorage today; swap writeAll/readAll for a real audit_log
  table later — every caller stays the same).
*/

import type { UserAuditAction, UserAuditEntry } from "./types";

const KEY = "users.audit.v1";
const CAP = 2000;
const EVENT = "ar-user-audit-change";

function readAll(): UserAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UserAuditEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: UserAuditEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-CAP)));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ua_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function logUserAudit(entry: {
  action: UserAuditAction;
  performedBy: string;
  targetUserId: string;
  targetUserName: string;
  previousValue?: string | null;
  newValue?: string | null;
}): void {
  const all = readAll();
  all.push({
    id: uid(),
    at: new Date().toISOString(),
    action: entry.action,
    performedBy: entry.performedBy,
    targetUserId: entry.targetUserId,
    targetUserName: entry.targetUserName,
    previousValue: entry.previousValue ?? null,
    newValue: entry.newValue ?? null,
  });
  writeAll(all);
}

/** Most recent entries across all users, newest first. */
export function getUserAudit(limit = 50): UserAuditEntry[] {
  return readAll()
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/** Entries for one specific user (View Profile's history tab). */
export function getUserAuditFor(userId: string, limit = 50): UserAuditEntry[] {
  return readAll()
    .filter((e) => e.targetUserId === userId)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

export function countUserAudit(): number {
  return readAll().length;
}

export function onUserAuditChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export const USER_AUDIT_ACTION_LABELS: Record<UserAuditAction, string> = {
  user_created: "User Created",
  user_edited: "User Edited",
  password_reset: "Password Reset",
  role_changed: "Role Changed",
  permissions_changed: "Permissions Changed",
  user_activated: "User Activated",
  user_inactivated: "User Inactivated",
  user_deleted: "User Deleted",
};
