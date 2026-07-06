/* Shown when .env.local has no Supabase URL/key yet. */
export function NotConfigured() {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-800">
      <p className="font-semibold">Supabase isn&apos;t connected yet.</p>
      <p className="mt-1 text-sm">
        Add your team&apos;s <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
        <code className="rounded bg-amber-100 px-1">.env.local</code>, then restart{" "}
        <code className="rounded bg-amber-100 px-1">npm run dev</code>. (For your team these are already filled in.)
      </p>
    </div>
  );
}
