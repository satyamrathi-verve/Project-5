import { isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";

/*
  The home / "start here" screen. Nothing in this app is pre-built — your team
  builds every screen on the roadmap below. This page just welcomes you and shows
  the list. Once you've built the Dashboard, you can make this page redirect to it
  (or replace this file with your dashboard).
*/

const ROADMAP = [
  "Sign In — a front-door login gate",
  "Customer Master — list customers, add / edit one",
  "GL Master — the ledger accounts list",
  "Sales Invoice — List (search + filter by status)",
  "Sales Invoice — View (read-only detail)",
  "Sales Invoice — Punch / Edit (create an invoice)",
  "Sales Invoice — Print Preview (printable page)",
  "Receipt Entry — record money and knock off invoices",
  "Upload Report — bulk import from a CSV",
  "Reminder Template — the chaser email you send",
  "Auto Email Shoot — chase every overdue customer",
  "Customer Statement — a running ledger for one customer",
  "AR Ageing — outstanding split into age buckets",
  "Cashflow Projection — expected collections, week by week",
  "Dashboard — the at-a-glance overview tiles",
];

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Welcome — let's build the AR Manager"
        subtitle="Nothing here is pre-built. You build every screen, one at a time."
      />

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          How this works
        </h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>The database and all its data already exist in Supabase — you never touch the backend.</li>
          <li>You point <span className="font-medium text-brand">Claude Code</span> at a screen from the list; it writes the page, you tweak it in plain English.</li>
          <li>When a screen works, you commit &amp; push — that scores your team on the live leaderboard.</li>
          <li>Read <code className="rounded bg-slate-100 px-1">README.md</code> for setup and the kickoff prompt to paste into Claude Code.</li>
        </ol>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          The screens to build
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          Get as far as you can — a few done well beats all of them half-broken. The
          spine <span className="font-medium text-slate-700">Sign In → Customer Master → Invoice List → Invoice View → Receipt Entry</span> demos best.
        </p>
        <ol className="mt-4 grid list-decimal gap-x-8 gap-y-2 pl-5 text-sm text-slate-700 sm:grid-cols-2">
          {ROADMAP.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Ready? Tell Claude Code: <span className="font-medium text-slate-700">&ldquo;build the Sign In screen.&rdquo;</span>
      </p>
    </>
  );
}
