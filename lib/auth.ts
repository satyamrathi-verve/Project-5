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
const EVENT = "ar-auth-change";

/** The signed-in user, or null. Safe to call on the server (returns null). */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Check credentials against the Users & Access store; store the session on success. */
export async function signIn(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await authenticate(username, password);
  if (!res.ok) return { ok: false, error: res.error };

  const session: Session = { username: res.user.username, name: res.user.fullName };
  window.localStorage.setItem(KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(EVENT));
  return { ok: true };
}

/** Clear the session and drop back to the login screen. */
export function signOut(): void {
  window.localStorage.removeItem(KEY);
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
