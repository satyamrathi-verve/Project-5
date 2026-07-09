"use client";

/*
  Users & Access — the local "database".
  =======================================
  This is the ONLY file that reads/writes user records. Everything else (the
  Users & Access UI, sidebar filtering, route guarding, login) calls the
  functions below. There is no `users` table in the fixed backend, so today
  this persists to localStorage — mirroring the seam pattern used elsewhere
  (lib/balances.ts's LEDGER_TABLE, lib/attachments/server.ts). Swap the
  internals for real API calls / a users table later; every caller, and the
  whole UI, stays exactly the same.

  Passwords: only a salted SHA-256 hash is ever stored (see ./crypto). The
  plaintext password lives in memory only for the instant it takes to hash it.
*/

import { defaultPermissionsForRole } from "./roles";
import { hashPassword, verifyPassword } from "./crypto";
import { logUserAudit } from "./audit";
import type {
  CreateUserInput,
  Permissions,
  PublicUser,
  RoleId,
  UpdateUserInput,
  UserRecord,
  UserStatus,
} from "./types";
import { toPublicUser } from "./types";

const KEY = "users.db.v1";
const EVENT = "ar-users-change";

/** The one credential that must keep working out of the box for this event. */
const SEED_ADMIN = {
  username: "arhandle@verveadvisory.com",
  password: "Verve@321",
  fullName: "AR Handle",
};

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function readAll(): UserRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as UserRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(users: UserRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(users));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onUsersChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

let seeded = false;
/** Create the demo Administrator once, on first-ever load. Safe to call repeatedly. */
async function ensureSeeded(): Promise<void> {
  if (seeded || typeof window === "undefined") return;
  seeded = true;
  const existing = readAll();
  if (existing.length > 0) return;
  const { hash, salt } = await hashPassword(SEED_ADMIN.password);
  const now = new Date().toISOString();
  const admin: UserRecord = {
    id: uid(),
    fullName: SEED_ADMIN.fullName,
    email: SEED_ADMIN.username,
    username: SEED_ADMIN.username,
    employeeId: null,
    department: "Finance",
    designation: "AR Administrator",
    phone: null,
    photoDataUrl: null,
    role: "administrator",
    status: "active",
    permissions: defaultPermissionsForRole("administrator"),
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    createdBy: "System",
    updatedAt: now,
    lastLoginAt: null,
  };
  writeAll([admin]);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<PublicUser[]> {
  await ensureSeeded();
  return readAll().map(toPublicUser);
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  await ensureSeeded();
  const u = readAll().find((x) => x.id === id);
  return u ? toPublicUser(u) : null;
}

export async function getUserByUsername(username: string): Promise<PublicUser | null> {
  await ensureSeeded();
  const u = readAll().find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
  return u ? toPublicUser(u) : null;
}

export async function isUsernameTaken(username: string, excludeId?: string): Promise<boolean> {
  await ensureSeeded();
  const n = username.trim().toLowerCase();
  return readAll().some((u) => u.username.toLowerCase() === n && u.id !== excludeId);
}

export async function isEmailTaken(email: string, excludeId?: string): Promise<boolean> {
  await ensureSeeded();
  const n = email.trim().toLowerCase();
  return readAll().some((u) => u.email.toLowerCase() === n && u.id !== excludeId);
}

/** How many ACTIVE Administrators exist — used to stop the last one being locked out. */
export async function countActiveAdmins(excludeId?: string): Promise<number> {
  await ensureSeeded();
  return readAll().filter((u) => u.role === "administrator" && u.status === "active" && u.id !== excludeId).length;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function authenticate(
  username: string,
  password: string,
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  await ensureSeeded();
  const users = readAll();
  const match = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!match) return { ok: false, error: "Wrong username or password." };
  if (match.status === "inactive") return { ok: false, error: "This account is inactive. Contact your administrator." };
  const valid = await verifyPassword(password, match.passwordSalt, match.passwordHash);
  if (!valid) return { ok: false, error: "Wrong username or password." };

  match.lastLoginAt = new Date().toISOString();
  writeAll(users.map((u) => (u.id === match.id ? match : u)));
  return { ok: true, user: toPublicUser(match) };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createUser(input: CreateUserInput, performedBy: string): Promise<PublicUser> {
  await ensureSeeded();
  const users = readAll();
  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(input.password);
  const record: UserRecord = {
    id: uid(),
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    username: input.username.trim(),
    employeeId: input.employeeId?.trim() || null,
    department: input.department?.trim() || null,
    designation: input.designation?.trim() || null,
    phone: input.phone?.trim() || null,
    photoDataUrl: input.photoDataUrl || null,
    role: input.role,
    status: input.status,
    permissions: input.permissions,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    createdBy: performedBy,
    updatedAt: now,
    lastLoginAt: null,
  };
  writeAll([...users, record]);
  logUserAudit({
    action: "user_created",
    performedBy,
    targetUserId: record.id,
    targetUserName: record.fullName,
    previousValue: null,
    newValue: `${record.role} · ${record.status}`,
  });
  return toPublicUser(record);
}

/** Field-level edit (personal details + role/status/permissions), logs the right audit entries. */
export async function updateUser(id: string, patch: UpdateUserInput, performedBy: string): Promise<PublicUser | null> {
  await ensureSeeded();
  const users = readAll();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return null;
  const before = users[idx];

  const roleChanged = patch.role != null && patch.role !== before.role;
  const permsChanged = patch.permissions != null && JSON.stringify(patch.permissions) !== JSON.stringify(before.permissions);

  const next: UserRecord = {
    ...before,
    fullName: patch.fullName?.trim() ?? before.fullName,
    email: patch.email?.trim() ?? before.email,
    username: patch.username?.trim() ?? before.username,
    employeeId: patch.employeeId !== undefined ? patch.employeeId?.trim() || null : before.employeeId,
    department: patch.department !== undefined ? patch.department?.trim() || null : before.department,
    designation: patch.designation !== undefined ? patch.designation?.trim() || null : before.designation,
    phone: patch.phone !== undefined ? patch.phone?.trim() || null : before.phone,
    photoDataUrl: patch.photoDataUrl !== undefined ? patch.photoDataUrl : before.photoDataUrl,
    role: patch.role ?? before.role,
    status: patch.status ?? before.status,
    permissions: patch.permissions ?? before.permissions,
    updatedAt: new Date().toISOString(),
  };
  writeAll(users.map((u) => (u.id === id ? next : u)));

  const fieldsChanged =
    next.fullName !== before.fullName ||
    next.email !== before.email ||
    next.username !== before.username ||
    next.employeeId !== before.employeeId ||
    next.department !== before.department ||
    next.designation !== before.designation ||
    next.phone !== before.phone;

  if (fieldsChanged) {
    logUserAudit({
      action: "user_edited",
      performedBy,
      targetUserId: id,
      targetUserName: next.fullName,
      previousValue: `${before.fullName} · ${before.email}`,
      newValue: `${next.fullName} · ${next.email}`,
    });
  }
  if (roleChanged) {
    logUserAudit({
      action: "role_changed",
      performedBy,
      targetUserId: id,
      targetUserName: next.fullName,
      previousValue: before.role,
      newValue: next.role,
    });
  }
  if (permsChanged && !roleChanged) {
    logUserAudit({
      action: "permissions_changed",
      performedBy,
      targetUserId: id,
      targetUserName: next.fullName,
      previousValue: "Custom permissions updated",
      newValue: "Custom permissions updated",
    });
  }
  return toPublicUser(next);
}

export async function changeRole(id: string, role: RoleId, permissions: Permissions, performedBy: string): Promise<PublicUser | null> {
  return updateUser(id, { role, permissions }, performedBy);
}

export async function resetPassword(id: string, newPassword: string, performedBy: string): Promise<boolean> {
  await ensureSeeded();
  const users = readAll();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return false;
  const { hash, salt } = await hashPassword(newPassword);
  const next = { ...users[idx], passwordHash: hash, passwordSalt: salt, updatedAt: new Date().toISOString() };
  writeAll(users.map((u) => (u.id === id ? next : u)));
  logUserAudit({
    action: "password_reset",
    performedBy,
    targetUserId: id,
    targetUserName: next.fullName,
    previousValue: "••••••••",
    newValue: "••••••••",
  });
  return true;
}

export async function setStatus(
  id: string,
  status: UserStatus,
  performedBy: string,
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  await ensureSeeded();
  const users = readAll();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return { ok: false, error: "User not found." };
  const before = users[idx];
  if (before.status === status) return { ok: true, user: toPublicUser(before) };

  if (status === "inactive" && before.role === "administrator") {
    const activeAdmins = users.filter((u) => u.role === "administrator" && u.status === "active").length;
    if (activeAdmins <= 1) {
      return { ok: false, error: "You can't deactivate the last active Administrator." };
    }
  }

  const next = { ...before, status, updatedAt: new Date().toISOString() };
  writeAll(users.map((u) => (u.id === id ? next : u)));
  logUserAudit({
    action: status === "active" ? "user_activated" : "user_inactivated",
    performedBy,
    targetUserId: id,
    targetUserName: next.fullName,
    previousValue: before.status,
    newValue: status,
  });
  return { ok: true, user: toPublicUser(next) };
}

export async function deleteUser(id: string, performedBy: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSeeded();
  const users = readAll();
  const target = users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "User not found." };
  writeAll(users.filter((u) => u.id !== id));
  logUserAudit({
    action: "user_deleted",
    performedBy,
    targetUserId: id,
    targetUserName: target.fullName,
    previousValue: `${target.role} · ${target.status}`,
    newValue: null,
  });
  return { ok: true };
}
