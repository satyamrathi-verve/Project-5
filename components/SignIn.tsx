"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "@/lib/auth";

/*
  The login screen — the app's front door, so it's allowed to be a bit more
  dressed-up than the plain internal screens. Left: an animated branded panel.
  Right: the form. When credentials match, <AuthGate> notices the session change
  and swaps this out for the app, so there's nothing to do here on success.

  All the animation / autofill CSS lives in the <style> block below so it's fully
  self-contained and can't collide with the shared globals.css.
*/
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
    }
    // On success the AuthGate replaces this component with the app.
  }

  return (
    <div className="flex min-h-screen">
      <style>{SIGNIN_CSS}</style>

      {/* Branded panel — hidden on small screens */}
      <aside className="signin-gradient-bg relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-light via-brand to-brand-dark p-12 text-white lg:flex">
        {/* dotted texture */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:22px_22px]" />
        {/* floating glows */}
        <div className="signin-float pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/15 blur-3xl" />
        <div className="signin-float-slow pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="signin-float pointer-events-none absolute right-10 bottom-24 h-40 w-40 rounded-full bg-violet-300/20 blur-2xl" style={{ animationDelay: "2s" }} />

        <div className="signin-anim relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-black ring-1 ring-white/30 backdrop-blur">
            V
          </div>
          <span className="text-sm font-semibold uppercase tracking-[0.2em]">Verve</span>
        </div>

        <div className="relative">
          <h2 className="signin-anim text-4xl font-bold leading-tight" style={{ animationDelay: "0.08s" }}>
            Accounts Receivable,
            <br />
            under control.
          </h2>
          <p className="signin-anim mt-4 max-w-sm text-sm text-white/70" style={{ animationDelay: "0.16s" }}>
            Track every invoice, chase overdue customers automatically, and see your
            cashflow week by week — all in one place.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/90">
            {["Live outstanding on every customer", "Auto reminder emails", "Ageing & cashflow at a glance"].map(
              (line, i) => (
                <li
                  key={line}
                  className="signin-anim flex items-center gap-3"
                  style={{ animationDelay: `${0.24 + i * 0.08}s` }}
                >
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-white/15">
                    <CheckIcon />
                  </span>
                  {line}
                </li>
              )
            )}
          </ul>
        </div>

        <p className="signin-anim relative text-xs text-white/50" style={{ animationDelay: "0.5s" }}>
          © Verve Advisory · AR Manager
        </p>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-50 p-6 dark:bg-slate-950">
        {/* faint glow behind the card for depth */}
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-brand/10 blur-3xl dark:bg-brand/20" />

        <div className="relative w-full max-w-sm">
          {/* compact logo — visible when the brand panel is hidden */}
          <div className="signin-anim mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-base font-black text-white">
              V
            </div>
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">Verve</span>
          </div>

          <h1 className="signin-anim text-2xl font-bold text-slate-900 dark:text-white">Welcome back</h1>
          <p className="signin-anim mt-1 text-sm text-slate-500 dark:text-slate-400" style={{ animationDelay: "0.06s" }}>
            Sign in to your AR Manager account.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <div className="signin-anim" style={{ animationDelay: "0.12s" }}>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Email
              </label>
              <div className="group relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-brand">
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

            <div className="signin-anim" style={{ animationDelay: "0.18s" }}>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Password
              </label>
              <div className="group relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-brand">
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
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-brand"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
                <WarnIcon />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="signin-anim group relative mt-2 overflow-hidden rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-950"
              style={{ animationDelay: "0.24s" }}
            >
              {/* hover shine sweep */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">{busy ? "Signing in…" : "Sign in"}</span>
            </button>
          </form>

          <p className="signin-anim mt-6 text-center text-xs text-slate-400 dark:text-slate-500" style={{ animationDelay: "0.3s" }}>
            Trouble signing in? Contact your administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Shared input styling for this screen — icon-padded, brand focus glow, dark-aware. */
const fieldClass =
  "signin-field w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500";

/* Self-contained CSS: entrance animation, animated gradient, floating glows,
   and the fix for the browser's yellow/olive autofill background. */
const SIGNIN_CSS = `
@keyframes signin-fade-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes signin-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(0,-26px) scale(1.06); } }
@keyframes signin-gradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.signin-anim { opacity: 0; animation: signin-fade-up .6s cubic-bezier(.16,1,.3,1) forwards; }
.signin-gradient-bg { background-size: 180% 180%; animation: signin-gradient 15s ease infinite; }
.signin-float { animation: signin-float 9s ease-in-out infinite; }
.signin-float-slow { animation: signin-float 13s ease-in-out infinite; }
.signin-field:-webkit-autofill,
.signin-field:-webkit-autofill:hover,
.signin-field:-webkit-autofill:focus {
  -webkit-text-fill-color: #1e293b;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset;
  box-shadow: 0 0 0 1000px #ffffff inset;
  caret-color: #1e293b;
  transition: background-color 9999s ease-in-out 0s;
}
.dark .signin-field:-webkit-autofill,
.dark .signin-field:-webkit-autofill:hover,
.dark .signin-field:-webkit-autofill:focus {
  -webkit-text-fill-color: #e2e8f0;
  -webkit-box-shadow: 0 0 0 1000px #0f172a inset;
  box-shadow: 0 0 0 1000px #0f172a inset;
  caret-color: #e2e8f0;
}
@media (prefers-reduced-motion: reduce) {
  .signin-anim, .signin-gradient-bg, .signin-float, .signin-float-slow { animation: none !important; opacity: 1; }
}
`;

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
  <svg {...iconProps("text-white")} width={13} height={13}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const WarnIcon = () => (
  <svg {...iconProps()} width={15} height={15}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
);
