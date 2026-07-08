"use client";

import { useEffect, useState } from "react";
import { SignIn } from "@/components/SignIn";
import { getSession, onAuthChange, type Session } from "@/lib/auth";

/*
  The front door. Wraps the whole app: if nobody is signed in it shows <SignIn />,
  otherwise it renders the app as-is (the team's <AppShell> draws the sidebar +
  header). Because auth lives in localStorage we can only read it in the browser,
  so we wait for `ready` before deciding — that avoids a flash of the wrong screen.
*/
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

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

  return <>{children}</>;
}
