"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { SignIn } from "@/components/SignIn";
import { getSession, onAuthChange, type Session } from "@/lib/auth";
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
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const pathname = usePathname();
  const { ready: accessReady, user } = useCurrentAccess();

  useEffect(() => {
    const sync = () => setSession(getSession());
    sync();
    setReady(true);
    return onAuthChange(sync);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (!session) return <SignIn />;

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
