"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
  Left sidebar. Only "Home" exists to start with — everything else is the roadmap
  your team builds. Each unbuilt screen shows a "build me" tag. When you finish a
  screen, flip its `built` to true (and point `href` at the route you created) so it
  turns into a real link.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
  { href: "/signin", label: "Sign In", built: false },
  { href: "/masters/customers", label: "Customer Master", built: false },
  { href: "/masters/gl", label: "GL Master", built: false },
  { href: "/invoices", label: "Sales Invoices", built: false },
  { href: "/receipts", label: "Receipt Entry", built: false },
  { href: "/upload", label: "Upload Report", built: false },
  { href: "/reminders", label: "AR Followup", built: false },
  { href: "/reports/statement", label: "Customer Statement", built: false },
  { href: "/reports/ageing", label: "AR Ageing", built: false },
  { href: "/cashflow", label: "Cashflow Projection", built: false },
  { href: "/dashboard", label: "Dashboard", built: false },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-60 flex-col gap-1 border-r border-slate-200 bg-white p-4">
      <div className="mb-4 px-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
        <h1 className="text-lg font-bold text-slate-900">AR Manager</h1>
      </div>
      {LINKS.map((l) => {
        const active = pathname === l.href;
        if (!l.built) {
          return (
            <span
              key={l.href}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400"
            >
              {l.label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                build me
              </span>
            </span>
          );
        }
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
