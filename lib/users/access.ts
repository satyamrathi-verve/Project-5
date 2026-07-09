/*
  Users & Access — permission lookups used by the sidebar and the route guard.
  Pure functions, no storage — safe to call from any component.
*/

import { MODULE_DEFS } from "./roles";
import type { ModuleKey, Permissions, PermissionAction } from "./types";

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const ROUTE_CANDIDATES = MODULE_DEFS.flatMap((m) => m.routePrefixes.map((prefix) => ({ key: m.key, prefix })))
  // longest prefix first, so "/reminders/template" beats "/reminders"
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** Which module governs a route, or null when the route isn't permission-gated (e.g. "/"). */
export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = ROUTE_CANDIDATES.find((c) => matchesPrefix(pathname, c.prefix));
  return hit ? hit.key : null;
}

export function hasPermission(permissions: Permissions | null | undefined, moduleKey: ModuleKey, action: PermissionAction = "view"): boolean {
  return !!permissions?.[moduleKey]?.[action];
}

/** Can this user reach this route at all? Ungated routes are always reachable. */
export function canAccessPath(permissions: Permissions | null | undefined, pathname: string): boolean {
  const moduleKey = moduleForPath(pathname);
  if (!moduleKey) return true;
  return hasPermission(permissions, moduleKey, "view");
}
