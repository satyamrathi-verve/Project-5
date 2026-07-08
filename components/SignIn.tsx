"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "@/lib/auth";

/*
  The login screen — the app's front door, so it's allowed to be a bit more
  dressed-up than the plain internal screens. Left: a branded panel. Right: the
  form. When credentials match, <AuthGate> notices the session change and swaps
  this out for the app, so there's nothing to do here on success.
*/
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = signIn(email, password);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
    }
    // On success the AuthGate replaces this component with the app.
  }

  return (
    <div className="flex min-h-screen">
      {/* Branded panel — hidden on small screens */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-12 text-white lg:flex">
        {/* soft decorative glows */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10 blur-2xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-black ring-1 ring-white/30">
            V
          </div>
          <span className="text-sm font-semibold uppercase tracking-[0.2em]">Verve</span>
        </div>

        <div className="relative">
          <h2 className="text-4xl font-bold leading-tight">
            Accounts Receivable,
            <br />
            under control.
          </h2>
          <p className="mt-4 max-w-sm text-sm text-white/70">
            Track every invoice, chase overdue customers automatically, and see your
            cashflow week by week — all in one place.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/90">
            {["Live outstanding on every customer", "Auto reminder emails", "Ageing & cashflow at a glance"].map(
              (line) => (
                <li key={line} className="flex items-center gap-3">
                  <CheckIcon />
                  {line}
                </li>
              )
            )}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">© Verve Advisory · AR Manager</p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm">
          {/* compact logo — visible when the brand panel is hidden */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-base font-black text-white">
              V
            </div>
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">Verve</span>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your AR Manager account.</p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Email
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <MailIcon />
                </span>
                <input
                  type="email"
                  className={fieldClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoFocus
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Password
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <LockIcon />
                </span>
                <input
                  type={showPw ? "text" : "password"}
                  className={`${fieldClass} pr-10`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                <WarnIcon />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            Trouble signing in? Contact your administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Shared input styling for this screen — icon-padded, brand focus ring. */
const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand";

/* --- small inline icons (no extra dependencies) --- */
function iconProps(extra?: string) {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: extra,
  };
}
const MailIcon = () => (
  <svg {...iconProps()}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 6-10 7L2 6" />
  </svg>
);
const LockIcon = () => (
  <svg {...iconProps()}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const EyeIcon = () => (
  <svg {...iconProps()}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg {...iconProps()}>
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.16 2.94M6.1 6.1A13.2 13.2 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 3.06-.52" />
    <path d="M2 2l20 20" />
  </svg>
);
const CheckIcon = () => (
  <svg {...iconProps("text-white")}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const WarnIcon = () => (
  <svg {...iconProps()} width={15} height={15}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
);
