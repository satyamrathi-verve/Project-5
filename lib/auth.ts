/*
  Front-end-only sign in (see CLAUDE.md rule 1). There is NO auth backend and NO
  `users` table — logins are checked against the small demo list below, and the
  session is kept in localStorage. Every screen sits behind <AuthGate>, which reads
  this session; Nav's "Sign out" button clears it.
*/

export type DemoUser = { username: string; password: string; name: string };

/** The only accepted logins. Edit this list to add teammates (keep emails lowercase). */
export const DEMO_USERS: DemoUser[] = [
  { username: "arhandle@verveadvisory.com", password: "Verve@321", name: "AR Handle" },
];

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

/** Check credentials against the demo list; store the session on success. */
export function signIn(
  username: string,
  password: string
): { ok: true } | { ok: false; error: string } {
  const u = username.trim().toLowerCase();
  const match = DEMO_USERS.find((d) => d.username === u && d.password === password);
  if (!match) return { ok: false, error: "Wrong username or password." };

  const session: Session = { username: match.username, name: match.name };
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
