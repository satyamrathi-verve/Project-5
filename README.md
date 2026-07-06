# Project Off The Books: Build "The Tool That Finally Fits"

> The rumour was true. Verve is building its own tool, and **your team is building it right now.**
>
> This is the **AR Manager** (Accounts Receivable): the screen where a finance team
> tracks who owes us money, raises invoices, records payments, chases overdue
> customers, and projects cash coming in. You're building the **front end**. The
> database is already done and already full of data, and you never touch the backend.

You don't need to be a coder. You point **Claude Code** at a screen, it writes the
UI, you tweak it in plain English, you commit and push. Every push lights your team
up on the big screen.

> **Nothing is pre-built.** This starter gives you the wiring (a live database
> connection, a few shared UI building blocks, and an empty roadmap) but **no finished
> screens** — your team builds every screen on the list yourselves.

---

## What you actually do (the 5-minute version)

1. **Open this folder in VS Code** and start the **Claude Code** extension.
2. **Do the one-time setup below** (Supabase + your git identity). ~5 minutes.
3. **Paste the kickoff prompt** (further down) into Claude Code. It reads this README,
   learns the rules, runs the app, and starts building screens with you.
4. **Build down the screen list** (15 screens — see below). Get as far as you can. A
   few screens done well beats all of them half-broken.
5. **Commit & push after every screen that works.** Each push scores you on the live
   leaderboard. (Commands are at the bottom — keep them handy.)
6. When you're done, your **team lead hits Submit** back on the event app, and you
   demo your tool to the judges on this laptop.

You are **not** writing backend code, SQL, or auth. All of that is wired. You point
Claude at a screen, it builds the UI, you tweak it, you push.

---

## Step 1 · Connect your Supabase (the backend + all the data)

Your backend is a single SQL file. Run it **once** and your database is created and
filled with realistic customers, invoices, receipts, ledgers and reminder templates.
You never write SQL again.

1. Open your team's project on [supabase.com](https://supabase.com) (or create a free one).
2. In the dashboard: **SQL Editor → New query →** paste **all** of
   [`supabase/seed.sql`](supabase/seed.sql) **→ Run**. That builds every table and
   seeds the data.
3. **Project Settings → API →** copy the **Project URL** and the **anon `public` key**.
4. Make a file called **`.env.local`** in this folder (copy `.env.local.example`) and
   paste them in:

```bash
NEXT_PUBLIC_SUPABASE_URL=<<PASTE YOUR TEAM'S PROJECT URL HERE>>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<<PASTE YOUR TEAM'S ANON PUBLIC KEY HERE>>
```

> The **anon key is safe to share** — the database policies control what it can do,
> and `.env.local` is git-ignored so your keys never get committed. If each team uses
> its own Supabase project, each team pastes **its own** values here.

---

## Step 2 · Tell git who you are (do this once — it's how you get credit) 🔑

**Everyone on the team commits to the *same* repo.** The live leaderboard counts
commits **per person**, using the identity saved inside each commit. So before your
first commit, tell git who *you* are — using the email on **your own GitHub account**:

```bash
git config user.name  "Your Full Name"
git config user.email "you@gmail.com"     # the email your GitHub account uses
```

- If you skip this, your commits get credited to whoever the laptop is set to — **not
  you**. Match your GitHub email and your commits link straight to your account.
- **Sharing one laptop?** Whoever is about to commit re-runs those two lines first, so
  the next commits are theirs.
- Check anytime: `git config user.name && git config user.email`

---

## Step 3 · Run the app

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. You'll see a **Welcome / start-here** page with the
roadmap and a left sidebar listing every screen — all tagged **"build me"** because
you haven't built them yet. There are **no finished screens to copy**; you build each
one from scratch and it lights up as you go. If `npm install` errors, just tell Claude
Code *"npm install failed, fix it"* and let it sort the setup.

### What's already in the box (so you don't rebuild the plumbing)

- **`lib/supabase.ts`** — the live connection to your database. Every screen reads and
  writes through this. You never edit it.
- **`lib/types.ts`** — a plain-English map of every table (customers, invoices, …) so
  Claude knows the shape of your data.
- **`components/`** — a handful of shared building blocks (a table, a form field, a
  page header) so every screen you build looks the same. Reuse them; add to them.
- **`supabase/seed.sql`** — the backend itself (Step 1). Runs once, then you forget it.

---

## The kickoff prompt (paste this into Claude Code)

```
Read README.md and CLAUDE.md in this repo, then tell me in 5 lines what we're
building and the order you'll build the screens in. The Supabase backend and ALL
the data already exist, so never create or alter tables, only read/write through the
existing client in lib/supabase.ts. Nothing is pre-built, so build the FIRST screen
on the list (Sign In) now, keep it consistent with the shared components, and show it
running in the browser. After each screen works, STOP and tell us exactly what to
commit and push.
```

After that, you just talk to it: *"now build the customer master"*, *"add a search
box"*, *"make the overdue rows red"*, *"add a print button"* — one screen at a time.

---

## The screens to build (15 screens — get as far as you can)

The data for all of this is **already in your database**. You're building the screens
that show it and let people punch new entries. **None are pre-built** — you build them
all. Here are the **15**:

> Order tip: **Sign In → Customer Master → Invoice List → Invoice View → Receipt
> Entry** is the most satisfying spine to demo. Reports and the rest are bonus. Don't
> get stuck on one screen — build it, push it, move on.

### 1. Sign In (the front door)
A simple login screen that gates the whole app.
- A username box, a password box, a **Sign In** button, and a friendly message on a
  wrong login.
- **Front-end only**: no real auth backend. Check the typed username/password against a
  small built-in list of demo logins in the code; on a match, remember the session in
  the browser (`localStorage`) so a refresh stays signed in. Hide the app until signed in.
- Add a small **Sign out** button in the nav. (Ask Claude for a couple of ready-made
  demo logins, e.g. `admin` / `admin123`.)

### 2. Customer Master (the reference list of customers)
The list every other screen leans on.
- A table of customers: **code, name, contact, credit days, credit limit**.
- **Add / edit** a customer with a simple form. A clean, friendly first screen to prove
  the whole read-and-write loop works.

### 3. GL Master (ledger accounts)
The reference list of ledger accounts (Sales, Debtors, Bank, Discount…).
- A table of accounts: **code, name, type** (asset / liability / income / expense).
- **Add** a new account.

### 4. Sales Invoice — List
The heart of the tool.
- A table of all invoices: **number, date, customer, total, status**
  (Open / Paid / Overdue / Partial).
- **Search** by customer and **filter** by status. Colour the status (overdue = red).

### 5. Sales Invoice — View
Read-only detail of one invoice.
- Header, customer block, **line items**, taxes, total, due date, and **amount
  outstanding** (total minus what's been received against it).

### 6. Sales Invoice — Punch / Edit
Create or edit an invoice.
- Pick a customer, add **line items** (description, qty, rate → amount), tax, total.
- **Due date auto-fills** from the customer's credit days.

### 7. Sales Invoice — Print Preview
A clean, **printable** invoice.
- Company header, customer block, line items, totals. The browser
  **Print → Save as PDF** should produce a real invoice.

### 8. Collections — Receipt Entry
Record money received and knock it off open invoices.
- Receipt number, date, customer, amount, mode (Cash / Cheque / UPI / NEFT), reference.
- **Allocate** the receipt against one or more of that customer's open invoices; the
  invoice's outstanding goes down (and flips to **Paid** when fully settled).

### 9. Data Entry — Upload Report (CSV)
Bulk punch instead of one-by-one.
- Upload a CSV of invoices (or customers), **preview the parsed rows**, fix obvious
  issues, then insert them all. (Ask Claude to whip up a small sample CSV to test with.)

### 10. AR Followup — Reminder Template
The email you send chasers with.
- An **editable** reminder email: subject + body with placeholders like `{customer}`,
  `{amount}`, `{days_overdue}`, `{invoice_no}`. Save it back to the templates table.

### 11. AR Followup — Auto Email Shoot
Chase everyone who's overdue, in one go.
- Pick all overdue invoices, generate a **personalised email per customer** from the
  template, and "send" them: log each to the reminders table and show a **sent list**
  (no real mailbox needed for the demo).

### 12. Report — Customer Statement (ledger)
Pick a customer, show a running account.
- Every **invoice (a debit)** and every **receipt (a credit)** in date order, with a
  **running balance** column and the **closing amount** they still owe. Prints cleanly.
- This is the "here's exactly what you owe and why" page you'd hand a customer.

### 13. Report — AR Ageing
The single most useful screen for a collections team.
- **One row per customer** with their outstanding split into buckets by how late it is:
  **Not due, 0–30, 31–60, 61–90, and 90+ days**. Add a **totals row** at the bottom and
  highlight the worst offenders. Prints cleanly. A great one to demo.

### 14. Cashflow Projection
Look forward, not back.
- From open invoices and their due dates, build a **week-by-week (or month-by-month)
  expected-collection schedule**. Let the user punch/adjust expected amounts and dates,
  and show the projected inflow as a **table and a simple chart**.

### 15. Dashboard (the overview)
The at-a-glance home for the finance team.
- Tiles for **customers, invoices, overdue count, total outstanding**, plus a **recent
  invoices** table. A natural one to build last (it pulls together everything above),
  and you can make the home page redirect to it once it's done.

---

## Commit & push after every screen ⬇️ (this is how you score)

Every time a screen works, **save, pull, commit, push** — and your name climbs the
live leaderboard. Because everyone shares one repo, **always pull first** so you pick
up others' work and avoid clashes:

```bash
git pull --rebase origin main
git add -A
git commit -m "Built <screen name>"
git push origin main
```

- Commit **small and often** — every working screen is a push.
- Committing under **your own git identity** (Step 2) is what earns *you* the credit.
- If the push is **rejected**, run the `git pull --rebase origin main` line again and
  push once more.

Claude Code will pause and remind you after each screen. Keep this terminal open.

---

## Demo

When you're done (or time's up), your **team lead opens the event app and hits Submit**.
Then a judge comes to **this laptop** and you walk them through your tool live on
`localhost:3000`. Show the screens you built, with the real data flowing through them.

Good luck. Build the thing the rumour promised. 🔧
