"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { SignIn } from "@/components/SignIn";
import {
  consumeIdleSignOut,
  getSession,
  msUntilIdleTimeout,
  onAuthChange,
  signOut,
  touchActivity,
  type Session,
} from "@/lib/auth";
import { canAccessPath, useCurrentAccess } from "@/lib/users";
import { visibleNavSections } from "@/components/Nav";
import { Icon } from "@/components/icons";

/*
  The front door. Wraps the whole app: if nobody is signed in it shows <SignIn />;
  once signed in, it also enforces route-level permissions (Users & Access) —
  if the current page's module isn't in the signed-in user's permission matrix,
  it shows a friendly "Access Restricted" screen instead of the page, so a
  hidden sidebar item can't be reached by typing its URL directly either.
  Otherwise it renders the app as-is (<AppShell> draws the sidebar + header).
  Because auth lives in localStorage we can only read it in the browser, so we
  wait for `ready` before deciding — that avoids a flash of the wrong screen.
*/
/** Activity that counts as "the user is still here". */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [idleNotice, setIdleNotice] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { ready: accessReady, user } = useCurrentAccess();

  /*
    Whether a session existed on the previous sync. `null` means "first read" —
    without that distinction, simply loading any page while already signed in
    would look like a fresh sign-in and bounce the user to the Dashboard.
  */
  const hadSession = useRef<boolean | null>(null);

  const sync = useCallback(() => {
    const next = getSession();
    // A real sign-in: we had no session a moment ago, and now we do.
    if (hadSession.current === false && next) router.replace("/dashboard");
    hadSession.current = next != null;

    setSession(next);
    if (consumeIdleSignOut()) setIdleNotice(true);
  }, [router]);

  useEffect(() => {
    sync();
    setReady(true);
    return onAuthChange(sync);
  }, [sync]);

  // Idle sign-out. Every interaction stamps the clock (throttled to once a
  // second); a timer fires when the remaining idle time runs out. Navigating
  // between screens also counts, via the pathname dependency.
  const lastTouch = useRef(0);
  useEffect(() => {
    if (!session) return;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch.current < 1000) return;
      lastTouch.current = now;
      touchActivity();
    };
    onActivity();

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    // Re-check on a timer rather than one long timeout, so a laptop waking from
    // sleep signs out immediately instead of waiting out a stale timer.
    const tick = window.setInterval(() => {
      if (msUntilIdleTimeout() <= 0) {
        signOut({ idle: true });
        setIdleNotice(true);
      }
    }, 15_000);

    // Coming back to the tab is the moment a lapsed session should be noticed.
    const onVisible = () => {
      if (document.visibilityState === "visible" && msUntilIdleTimeout() <= 0) {
        signOut({ idle: true });
        setIdleNotice(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [session, pathname]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <>
        {idleNotice && (
          <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
            <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <Icon name="clock" size={17} />
              <span>Signed out after 15 minutes of inactivity. Please sign in again.</span>
              <button
                onClick={() => setIdleNotice(false)}
                className="ml-1 rounded p-0.5 text-amber-700 hover:text-amber-900 dark:text-amber-400"
                aria-label="Dismiss"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
        )}
        <SignIn />
      </>
    );
  }

  if (accessReady && !canAccessPath(user?.permissions ?? null, pathname)) {
    const fallback = visibleNavSections(user?.permissions ?? null)[0]?.links.find((l) => l.href)?.href ?? "/";
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center dark:bg-slate-950">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="shield" size={26} />
        </span>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Access Restricted</h1>
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
          Your role doesn&apos;t have permission to view this page. Ask an administrator to grant it in Settings &gt; Users &amp; Access.
        </p>
        <Link href={fallback} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
          Take me back
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
