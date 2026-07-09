"use client";

/*
  Activity Center — client-side change log.
  =========================================
  Records who-changed-what for every module, auto-capturing the signed-in user
  and timestamp so callers never pass a name. Persisted per-browser in
  localStorage (the fixed backend has no audit table); the shared, on-disk part
  of the trail — attachment upload/download/delete — is merged in by the
  ActivityCenter from the DMS history. A tiny pub/sub lets an open ActivityCenter
  refresh the instant a new event is logged.

  When a real audit_log table exists, swap readAll/appendEvent to hit it and the
  UI is unchanged.
*/

import { getSession } from "@/lib/auth";
import type { ActivityEvent, ActivityInput } from "./types";

const KEY = "activity.log.v1";
const CAP = 2000;

export function currentUserName(): string {
  return getSession()?.name ?? "System";
}

function readAll(): ActivityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

function writeAll(events: ActivityEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-CAP)));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

// ── pub/sub so open timelines refresh live ────────────────────────────────────
const listeners = new Set<() => void>();
export function onActivityChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(): void {
  listeners.forEach((cb) => cb());
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `a_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

/** Record one activity event. User + timestamp are captured automatically. */
export function logActivity(input: ActivityInput): ActivityEvent {
  const event: ActivityEvent = {
    id: uid(),
    at: input.at ?? new Date().toISOString(),
    user: input.user ?? currentUserName(),
    source: "local",
    module: input.module,
    recordId: input.recordId,
    context: input.context,
    action: input.action,
    field: input.field ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
  };
  const all = readAll();
  all.push(event);
  writeAll(all);
  emit();
  return event;
}

/** Log several events atomically (e.g. one per changed field). */
export function logActivityBatch(inputs: ActivityInput[]): void {
  if (inputs.length === 0) return;
  const all = readAll();
  for (const input of inputs) {
    all.push({
      id: uid(),
      at: input.at ?? new Date().toISOString(),
      user: input.user ?? currentUserName(),
      source: "local",
      module: input.module,
      recordId: input.recordId,
      context: input.context,
      action: input.action,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
    });
  }
  writeAll(all);
  emit();
}

/** All locally-logged events for one record, newest first. */
export function getLocalActivity(module: string, recordId: string): ActivityEvent[] {
  return readAll()
    .filter((e) => e.module === module && e.recordId === recordId)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Most recent activity across every module (System Settings' Activity Logs). */
export function getAllActivity(limit = 20): ActivityEvent[] {
  return readAll()
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/** Total number of locally-logged events, across every module. */
export function countAllActivity(): number {
  return readAll().length;
}

/** Wipe the entire local activity log (used by Settings > Activity Logs > Clear). */
export function clearActivity(): void {
  writeAll([]);
  emit();
}
