/*
  Users & Access — module registry + role default-permission presets.
  =====================================================================
  Client-safe, no storage. Single source of truth for: which modules exist,
  which routes each module governs (used for sidebar filtering + route
  guarding), and what a built-in role grants by default. Adding a module later
  is a one-line addition to MODULE_DEFS.
*/

import type { ModuleKey, ModulePermissions, Permissions, PermissionAction, RoleId } from "./types";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Route prefixes this module governs (longest-prefix-match wins). */
  routePrefixes: string[];
}

export const MODULE_DEFS: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", routePrefixes: ["/dashboard"] },
  { key: "customers", label: "Customer Master", routePrefixes: ["/masters/customers"] },
  { key: "gl", label: "GL Master", routePrefixes: ["/masters/gl"] },
  { key: "invoices", label: "Sales Invoice", routePrefixes: ["/invoices"] },
  { key: "receipts", label: "Receipt Entry", routePrefixes: ["/receipts"] },
  { key: "upload", label: "Upload Report", routePrefixes: ["/upload"] },
  { key: "followups", label: "AR Follow-up", routePrefixes: ["/reminders"] },
  { key: "reminderTemplates", label: "Reminder Template", routePrefixes: ["/reminders/template"] },
  { key: "statement", label: "Customer Statement", routePrefixes: ["/reports/statement"] },
  { key: "reports", label: "Reports", routePrefixes: ["/reports/ageing", "/cashflow"] },
  { key: "settings", label: "Settings", routePrefixes: ["/settings"] },
];

export const MODULE_KEYS: ModuleKey[] = MODULE_DEFS.map((m) => m.key);

export function moduleLabel(key: ModuleKey): string {
  return MODULE_DEFS.find((m) => m.key === key)?.label ?? key;
}

export const PERMISSION_ACTIONS: PermissionAction[] = ["view", "create", "edit", "delete", "export", "import"];
export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
  import: "Import",
};

// ── Building permission matrices ────────────────────────────────────────────

function moduleFlags(flags: Partial<ModulePermissions>): ModulePermissions {
  return {
    view: flags.view ?? false,
    create: flags.create ?? false,
    edit: flags.edit ?? false,
    delete: flags.delete ?? false,
    export: flags.export ?? false,
    import: flags.import ?? false,
  };
}

/** Every module, every action false. The starting point for a fresh Custom Role. */
export function emptyPermissions(): Permissions {
  const p = {} as Permissions;
  for (const k of MODULE_KEYS) p[k] = moduleFlags({});
  return p;
}

/** Every module, every action true. What Administrator grants. */
export function fullPermissions(): Permissions {
  const p = {} as Permissions;
  for (const k of MODULE_KEYS) p[k] = moduleFlags({ view: true, create: true, edit: true, delete: true, export: true, import: true });
  return p;
}

/** Every module, view only. What Viewer grants (minus Settings). */
export function viewOnlyPermissions(exclude: ModuleKey[] = []): Permissions {
  const p = {} as Permissions;
  for (const k of MODULE_KEYS) p[k] = moduleFlags({ view: !exclude.includes(k) });
  return p;
}

/** Start from `base`, then grant `flags` on the listed modules. */
function grant(base: Permissions, keys: ModuleKey[], flags: Partial<ModulePermissions>): Permissions {
  const next = { ...base };
  for (const k of keys) next[k] = moduleFlags({ ...next[k], ...flags });
  return next;
}

const FULL_CRUD: Partial<ModulePermissions> = { view: true, create: true, edit: true, delete: true, export: true, import: true };
const VIEW_EXPORT: Partial<ModulePermissions> = { view: true, export: true };

// ── Built-in role defaults ───────────────────────────────────────────────────

export interface RoleDef {
  id: RoleId;
  label: string;
  description: string;
}

export const ROLE_DEFS: RoleDef[] = [
  { id: "administrator", label: "Administrator", description: "Full application access, including Settings and user administration." },
  { id: "ar_manager", label: "AR Manager", description: "Runs receivables day to day: customers, invoicing, receipts and follow-up." },
  { id: "accountant", label: "Accountant", description: "Owns the general ledger, cash position and financial reports." },
  { id: "ar_executive", label: "AR Executive", description: "Chases collections and records receipts; limited edit rights." },
  { id: "viewer", label: "Viewer", description: "Read-only access across the app, for stakeholders who just need visibility." },
  { id: "custom", label: "Custom Role", description: "Choose exactly which modules and actions this user can access." },
];

export function roleLabel(id: RoleId): string {
  return ROLE_DEFS.find((r) => r.id === id)?.label ?? id;
}

/** Default permission matrix for a built-in role. Returns an empty matrix for "custom". */
export function defaultPermissionsForRole(role: RoleId): Permissions {
  switch (role) {
    case "administrator":
      return fullPermissions();
    case "ar_manager": {
      let p = emptyPermissions();
      p = grant(p, ["dashboard"], { view: true });
      p = grant(p, ["customers", "invoices", "receipts", "followups"], FULL_CRUD);
      p = grant(p, ["statement", "reports"], VIEW_EXPORT);
      return p;
    }
    case "accountant": {
      let p = emptyPermissions();
      p = grant(p, ["dashboard"], { view: true });
      p = grant(p, ["gl"], FULL_CRUD);
      p = grant(p, ["reports"], VIEW_EXPORT);
      return p;
    }
    case "ar_executive": {
      let p = emptyPermissions();
      p = grant(p, ["dashboard"], { view: true });
      p = grant(p, ["followups"], { view: true, create: true, edit: true, export: true });
      p = grant(p, ["invoices", "receipts", "customers"], { view: true });
      p = grant(p, ["statement", "reports"], VIEW_EXPORT);
      return p;
    }
    case "viewer":
      return viewOnlyPermissions(["settings"]);
    case "custom":
      return emptyPermissions();
  }
}
