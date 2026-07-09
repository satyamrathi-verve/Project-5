/*
  Users & Access Management — shared types.
  =========================================
  There is no `users` table in the fixed backend, so this whole module is a
  self-contained "local database" (see store.ts). Everything here is written so
  a real backend can replace store.ts's internals later without any UI change —
  every type, and every function signature the UI calls, stays the same.
*/

/** Every module the sidebar exposes and permissions can be scoped to. */
export type ModuleKey =
  | "dashboard"
  | "customers"
  | "gl"
  | "invoices"
  | "receipts"
  | "upload"
  | "followups"
  | "reminderTemplates"
  | "statement"
  | "reports"
  | "settings";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export" | "import";

export type ModulePermissions = Record<PermissionAction, boolean>;

/** The full access matrix for one user: one row of PermissionAction flags per module. */
export type Permissions = Record<ModuleKey, ModulePermissions>;

export type RoleId = "administrator" | "ar_manager" | "accountant" | "ar_executive" | "viewer" | "custom";

export type UserStatus = "active" | "inactive";

export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  username: string; // login handle, unique, case-insensitive
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  phone: string | null;
  photoDataUrl: string | null;
  role: RoleId;
  status: UserStatus;
  permissions: Permissions;
  /** Salted hash — see lib/users/crypto.ts. The plaintext password is never stored. */
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  createdBy: string; // full name of the admin who created this user
  updatedAt: string;
  lastLoginAt: string | null;
}

/** Public shape (no password material) — what most of the UI actually renders. */
export type PublicUser = Omit<UserRecord, "passwordHash" | "passwordSalt">;

export function toPublicUser(u: UserRecord): PublicUser {
  const { passwordHash: _h, passwordSalt: _s, ...rest } = u;
  return rest;
}

// ── Create / update payloads ────────────────────────────────────────────────

export interface CreateUserInput {
  fullName: string;
  email: string;
  username: string;
  password: string;
  employeeId?: string | null;
  department?: string | null;
  designation?: string | null;
  phone?: string | null;
  photoDataUrl?: string | null;
  role: RoleId;
  status: UserStatus;
  permissions: Permissions;
}

export type UpdateUserInput = Partial<
  Omit<CreateUserInput, "password" | "username"> & { username: string }
>;

// ── Audit ────────────────────────────────────────────────────────────────────

export type UserAuditAction =
  | "user_created"
  | "user_edited"
  | "password_reset"
  | "role_changed"
  | "permissions_changed"
  | "user_activated"
  | "user_inactivated"
  | "user_deleted";

export interface UserAuditEntry {
  id: string;
  at: string; // ISO date-time
  action: UserAuditAction;
  performedBy: string; // full name
  targetUserId: string;
  targetUserName: string;
  previousValue: string | null;
  newValue: string | null;
}
