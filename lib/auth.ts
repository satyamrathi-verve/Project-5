/*
  Front-end-only sign in (see CLAUDE.md rule 1). There is NO auth backend and NO
  `users` table in Supabase — logins are checked against the local Users & Access
  store (lib/users/store.ts, localStorage-backed, seeded with one Administrator
  so the event's known demo login keeps working), and the session itself is kept
  in localStorage. Every screen sits behind <AuthGate>, which reads this session
  (and, via lib/users, the signed-in user's role/permissions); Nav's "Sign out"
  button clears it.
*/

import { authenticate } from "@/lib/users/store";

export type Session = { username: string; name: string };

const KEY = "ar-manager.session";
const LAST_ACTIVE_KEY = "ar-manager.lastActive";
const IDLE_FLAG_KEY = "ar-manager.idleSignOut";
const EVENT = "ar-auth-change";

/** Sign the user out after this long with no interaction. */
export const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

function readLastActive(): number {
  const raw = window.localStorage.getItem(LAST_ACTIVE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * The signed-in user, or null. Safe to call on the server (returns null).
 * A session idle for longer than IDLE_LIMIT_MS is treated as signed out — this
 * also covers the tab being closed and reopened hours later.
 */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const last = readLastActive();
    if (last && Date.now() - last > IDLE_LIMIT_MS) {
      signOut({ idle: true });
      return null;
    }
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/** Record that the user just did something. No-op when signed out. */
export function touchActivity(): void {
  if (typeof window === "undefined") return;
  if (!window.localStorage.getItem(KEY)) return;
  window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

/** Milliseconds of idle time left before auto sign-out (0 when already past it). */
export function msUntilIdleTimeout(): number {
  if (typeof window === "undefined") return IDLE_LIMIT_MS;
  const last = readLastActive();
  if (!last) return IDLE_LIMIT_MS;
  return Math.max(0, IDLE_LIMIT_MS - (Date.now() - last));
}

/** True once, if the last sign-out was caused by inactivity. Clears the flag. */
export function consumeIdleSignOut(): boolean {
  if (typeof window === "undefined") return false;
  const hit = window.localStorage.getItem(IDLE_FLAG_KEY) === "1";
  if (hit) window.localStorage.removeItem(IDLE_FLAG_KEY);
  return hit;
}

/** Check credentials against the Users & Access store; store the session on success. */
export async function signIn(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await authenticate(username, password);
  if (!res.ok) return { ok: false, error: res.error };

  const session: Session = { username: res.user.username, name: res.user.fullName };
  window.localStorage.setItem(KEY, JSON.stringify(session));
  window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  window.localStorage.removeItem(IDLE_FLAG_KEY);
  window.dispatchEvent(new Event(EVENT));
  return { ok: true };
}

/** Clear the session and drop back to the login screen. */
export function signOut(opts?: { idle?: boolean }): void {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(LAST_ACTIVE_KEY);
  if (opts?.idle) window.localStorage.setItem(IDLE_FLAG_KEY, "1");
  window.dispatchEvent(new Event(EVENT));
}

/** Run `cb` whenever the session changes (this tab or another). Returns an unsubscribe. */
export function onAuthChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
