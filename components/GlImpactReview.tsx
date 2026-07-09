import { formatMoney } from "@/lib/balances";
import type { GlImpactLine } from "@/lib/gl";

/*
  GL Impact Review — a proper two-column Debit/Credit journal view (not a
  cramped sidebar list), used on both the invoice Punch/Edit form and the
  invoice View screen so the preview looks identical everywhere. Preview
  only: there is no journal/ledger table in the backend, so nothing here is
  ever posted — see lib/gl.ts's invoiceGlImpact for how these lines are
  computed.
*/
export function GlImpactReview({ lines }: { lines: GlImpactLine[] }) {
  const debits = lines.filter((l) => l.side === "debit");
  const credits = lines.filter((l) => l.side === "credit");
  const debitTotal = debits.reduce((s, l) => s + l.amount, 0);
  const creditTotal = credits.reduce((s, l) => s + l.amount, 0);
  const balanced = Math.abs(debitTotal - creditTotal) < 0.005;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">GL Impact Review</h3>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Preview only — there is no journal/ledger table yet, so nothing here is posted to GL Master.
          </p>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
            balanced
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          }`}
        >
          {balanced ? "Balanced ✓" : "Unbalanced"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Debit column */}
        <div className="overflow-hidden rounded-lg border border-emerald-200 dark:border-emerald-900/60">
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 dark:border-emerald-900/60 dark:bg-emerald-500/10">
            <span className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Debit
            </span>
          </div>
          <div className="divide-y divide-emerald-100 dark:divide-emerald-900/40">
            {debits.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-slate-400">Nothing to debit yet.</div>
            ) : (
              debits.map((line, i) => (
                <div key={i} className="flex items-baseline justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">
                    {line.code} · {line.name}
                  </span>
                  <span className="tabular-nums font-medium text-slate-800 dark:text-slate-100">
                    {formatMoney(line.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex items-baseline justify-between border-t border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm font-bold text-slate-900 dark:border-emerald-900/60 dark:bg-emerald-500/5 dark:text-white">
            <span>Total Debit</span>
            <span className="tabular-nums">{formatMoney(debitTotal)}</span>
          </div>
        </div>

        {/* Credit column */}
        <div className="overflow-hidden rounded-lg border border-orange-200 dark:border-orange-900/60">
          <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 dark:border-orange-900/60 dark:bg-orange-500/10">
            <span className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">
              Credit
            </span>
          </div>
          <div className="divide-y divide-orange-100 dark:divide-orange-900/40">
            {credits.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-slate-400">Nothing to credit yet.</div>
            ) : (
              credits.map((line, i) => (
                <div key={i} className="flex items-baseline justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">
                    {line.code} · {line.name}
                  </span>
                  <span className="tabular-nums font-medium text-slate-800 dark:text-slate-100">
                    {formatMoney(line.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex items-baseline justify-between border-t border-orange-200 bg-orange-50/60 px-4 py-2.5 text-sm font-bold text-slate-900 dark:border-orange-900/60 dark:bg-orange-500/5 dark:text-white">
            <span>Total Credit</span>
            <span className="tabular-nums">{formatMoney(creditTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
