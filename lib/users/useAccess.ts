"use client";

/*
  useCurrentAccess — the signed-in user's full record + permissions, live.
  Used by the sidebar (hide unauthorized menus) and the route guard (prevent
  unauthorized navigation). Refreshes on sign-in/out AND whenever the users
  store changes (e.g. an admin edits someone's role in another tab, or their
  own — the UI should react immediately either way).
*/

import { useCallback, useEffect, useState } from "react";
import { getSession, onAuthChange } from "@/lib/auth";
import { getUserByUsername, onUsersChange } from "./store";
import type { PublicUser } from "./types";

export interface CurrentAccess {
  /** False until the first read completes — avoids a flash of "no access". */
  ready: boolean;
  user: PublicUser | null;
}

export function useCurrentAccess(): CurrentAccess {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);

  const refresh = useCallback(() => {
    const session = getSession();
    if (!session) {
      setUser(null);
      setReady(true);
      return;
    }
    void getUserByUsername(session.username).then((u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    refresh();
    const offAuth = onAuthChange(refresh);
    const offUsers = onUsersChange(refresh);
    return () => {
      offAuth();
      offUsers();
    };
  }, [refresh]);

  return { ready, user };
}
