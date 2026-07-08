"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignIn } from "@/components/SignIn";

/*
  Normally you never land here directly — the AuthGate shows the login for anyone
  who isn't signed in, on every route. This page just makes /signin a real URL:
  if you're already signed in it sends you home, otherwise it shows the login.
*/
export default function SignInPage() {
  const router = useRouter();

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  return <SignIn />;
}
