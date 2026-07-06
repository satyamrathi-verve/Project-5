# CLAUDE.md: build rules for the AR Manager

You are helping a **team of non-coders** at a company event build the front end of an
**Accounts Receivable (AR) manager**, screen by screen, against a Supabase backend that
**already exists and is already seeded with data**. **Nothing in this app is pre-built** —
there are no finished example screens; you build every screen on the list with the team.
Read this whole file before writing code.

## Golden rules

1. **Never touch the backend.** The database, tables, and data already exist. Only
   read/write through the Supabase client in `lib/supabase.ts`. Do **not** create, alter,
   or drop tables; do **not** write SQL migrations; do **not** wire up a real auth backend.
   The Sign In screen is a **front-end-only gate** (credentials checked against a small
   built-in demo list, the session kept in `localStorage`), so it needs no backend and no
   `users` table. If a screen seems to need a new column, work with what's there or ask the team.
2. **One screen at a time.** Build the screen the team asks for, get it working with the
   real seeded data, show it in the browser, then stop. Don't scaffold everything at once.
3. **Keep every screen consistent.** Nothing is pre-built, so *you* set the house style
   with the first screen and keep every later screen matching it — same layout, table look,
   form styling, colours, loading and empty states. Reuse the shared building blocks in
   `components/` (`DataTable`, `FormField`, `PageHeader`, `NotConfigured`) and the `brand`
   colour rather than reinventing per screen. Add to those components instead of forking them.
4. **Keep it simple and visible.** These users can't read stack traces. Prefer plain,
   working UI over clever abstractions. Loading and empty states should be obvious.
5. **After each working screen, STOP and tell the team to commit & push** with the exact
   commands (see below). The live leaderboard depends on frequent pushes. Do not batch
   many screens into one commit. Do **not** push for them; they push manually.
   **Everyone shares one repo**, so the leaderboard credits commits **per person** by the
   git identity inside each commit — before anyone's first commit, make sure they've set
   their own `git config user.name` / `user.email` (their personal GitHub email), and
   always `git pull --rebase origin main` before pushing so teammates' work isn't clobbered.
6. **Explain like they're smart but non-technical.** Short, plain status updates. No jargon.

## Stack

- **Next.js (App Router) + React + TypeScript**, **Tailwind CSS** for styling.
- **Supabase** via `@supabase/supabase-js`, client pre-configured in `lib/supabase.ts`
  from `.env.local` (this team's project URL + anon key, already filled in, don't change).
- Run with `npm run dev` → http://localhost:3000. There is **no deploy step**; the demo
  is on localhost.

## What already exists (the wiring — not screens)

- `app/page.tsx`: a plain **welcome / start-here** home page listing the roadmap. Not an
  AR screen — leave it or, once the Dashboard is built, point it there.
- `app/layout.tsx` + `components/Nav.tsx`: the shell and the left sidebar. Every screen on
  the roadmap is listed in `Nav.tsx` as **unbuilt** ("build me"); flip a link's `built` to
  `true` and set its `href` when you finish that screen so it turns into a real link.
- `lib/supabase.ts`: the configured client. Import `supabase` from here everywhere.
- `lib/types.ts`: TypeScript types mirroring the tables (keep in sync as you use them).
- `components/`: shared UI (`DataTable`, `FormField`, `PageHeader`, `NotConfigured`).
- `supabase/seed.sql`: the backend, already run in the team's Supabase project. Read-only to you.

## Where things go

- `app/<area>/<screen>/page.tsx`: one route per screen (e.g. `app/signin/page.tsx`,
  `app/masters/customers/page.tsx`, `app/masters/gl/page.tsx`, `app/invoices/page.tsx`,
  `app/invoices/[id]/page.tsx`, `app/receipts/page.tsx`, `app/reports/statement/page.tsx`,
  `app/reports/ageing/page.tsx`).
- `components/`: shared UI. Add to these, don't reinvent per screen.
- `lib/supabase.ts`: the configured client. Import `supabase` from here everywhere.
- `lib/types.ts`: TypeScript types mirroring the tables (keep in sync as you use them).
- Add a nav link in `components/Nav.tsx` for every new screen (flip its `built` to `true`).

## The database (already created and seeded, read/write only)

```
company                -- single row: name, address, gstin, email, phone   (invoice header)
customers              -- id, code, name, gstin, pan, contact_person, email, phone,
                          address, credit_limit, credit_days, opening_balance, created_at
gl_accounts            -- id, code, name, type ('asset'|'liability'|'income'|'expense'), parent_group
invoices               -- id, invoice_no, invoice_date, customer_id -> customers.id,
                          due_date, subtotal, tax_amount, total, status
                          ('open'|'paid'|'overdue'|'partial'), notes, created_at
invoice_items          -- id, invoice_id -> invoices.id, description, qty, rate, amount
receipts               -- id, receipt_no, receipt_date, customer_id -> customers.id,
                          amount, mode ('cash'|'cheque'|'upi'|'neft'), reference, created_at
receipt_allocations    -- id, receipt_id -> receipts.id, invoice_id -> invoices.id, amount
reminder_templates     -- id, name, subject, body   (body has {customer},{amount},{days_overdue},{invoice_no})
reminder_log           -- id, invoice_id, to_email, subject, body, status, sent_at
```

Notes for building:
- **Sign In** is front-end only: keep a small list of `{ username, password }` demo
  logins in the code (no `users` table, no Supabase auth). On a match, store a flag in
  `localStorage` and show the app; otherwise show the login. Add a Sign out that clears it.
- **Outstanding on an invoice** = `total` minus the sum of its `receipt_allocations.amount`.
- **Overdue** = status is open/partial AND `due_date` < today.
- **Due date** when punching a new invoice = `invoice_date` + the customer's `credit_days`.
- **Auto Email Shoot** is simulated: generate each email from the template, insert a row
  into `reminder_log` with `status='sent'`, and show the team the list. No real mailbox.
- **Cashflow projection** is derived from open invoices grouped by `due_date` into
  weeks/months; let the team adjust expected amounts in the UI.
- **Customer Statement (ledger)**: for one customer, list their invoices (debits) and
  receipts (credits) in date order with a running balance; the closing balance is that
  customer's total outstanding.
- **AR Ageing report**: for each customer, take their unpaid/partial invoices, compute
  each one's outstanding, and bucket it by `today - due_date`: not-due (`due_date >=
  today`), 0–30, 31–60, 61–90, and 90+ days. Show one row per customer plus a grand-total row.

## Build order (15 screens to build — aim for at least 10)

Nothing is pre-built. Build in the order that demos best (spine first, bonus screens after):

1. **Sign In** (front-end login gate) so the app opens behind a login.
2. **Customer Master** (list + add/edit) — the friendly first screen that proves the
   read-and-write loop; every later screen leans on the customer list.
3. **GL Master** (simplest reference list).
4. **Invoice List** → 5. **Invoice View** → 6. **Invoice Edit/Punch** → 7. **Print Preview**.
8. **Receipt Entry** (with allocation/knock-off).
9. **Upload Report** (CSV bulk import).
10. **Followup Reminder — Template** → 11. **Auto Email Shoot** (generate + log reminders).
12. **Customer Statement (ledger)** and 13. **AR Ageing report** (both read-only, both printable).
14. **Cashflow Projection** (open invoices grouped by due date, table + simple chart).
15. **Dashboard** (overview tiles + recent invoices; natural to build last).

## Commit & push (tell the team to run this after each working screen)

```bash
git pull --rebase origin main      # shared repo: pick up teammates' work first
git add -A
git commit -m "Built <screen name>"
git push origin main
```

You make the commit message; **they run the push**. Remind them every time a screen
lands. Because it's one shared repo, remind them to `pull --rebase` first; if a push is
rejected, pull --rebase again and re-push. Each person commits under **their own** git
identity so the leaderboard credits the right person (see rule 5).
