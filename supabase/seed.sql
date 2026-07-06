-- ============================================================================
-- AR Manager — backend schema + seed data
-- Run this ONCE on a fresh Supabase project (SQL Editor → paste → Run).
-- Teams never run this; it's the backend that's "already done" for them.
-- Access is via the anon key, so policies below allow anon full access to these
-- (throwaway, event-only) tables. Do not put real data in here.
-- ============================================================================

-- ---------- schema ----------------------------------------------------------

create table if not exists company (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  gstin       text,
  email       text,
  phone       text
);

create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  gstin           text,
  pan             text,
  contact_person  text,
  email           text,
  phone           text,
  address         text,
  credit_limit    numeric(14,2) default 0,
  credit_days     int default 30,
  opening_balance numeric(14,2) default 0,
  created_at      timestamptz default now()
);

create table if not exists gl_accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  type         text not null check (type in ('asset','liability','income','expense')),
  parent_group text
);

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  invoice_no   text unique not null,
  invoice_date date not null,
  customer_id  uuid not null references customers(id) on delete cascade,
  due_date     date not null,
  subtotal     numeric(14,2) not null default 0,
  tax_amount   numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  status       text not null default 'open' check (status in ('open','partial','paid','overdue')),
  notes        text,
  created_at   timestamptz default now()
);

create table if not exists invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null,
  qty         numeric(12,2) not null default 1,
  rate        numeric(14,2) not null default 0,
  amount      numeric(14,2) not null default 0
);

create table if not exists receipts (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   text unique not null,
  receipt_date date not null,
  customer_id  uuid not null references customers(id) on delete cascade,
  amount       numeric(14,2) not null default 0,
  mode         text not null default 'neft' check (mode in ('cash','cheque','upi','neft')),
  reference    text,
  created_at   timestamptz default now()
);

create table if not exists receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references receipts(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  amount      numeric(14,2) not null default 0
);

create table if not exists reminder_templates (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  subject text not null,
  body    text not null
);

create table if not exists reminder_log (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  to_email   text,
  subject    text,
  body       text,
  status     text default 'sent',
  sent_at    timestamptz default now()
);

-- ---------- row-level security: open access for the event (anon key) --------

do $$
declare t text;
begin
  foreach t in array array[
    'company','customers','gl_accounts','invoices','invoice_items',
    'receipts','receipt_allocations','reminder_templates','reminder_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ---------- seed: company + ledgers + reminder template ---------------------

insert into company (name, address, gstin, email, phone) values
  ('Verve Advisory Pvt Ltd', '7th Floor, Skyline Tower, Pune 411001', '27AAACV1234F1Z5',
   'accounts@verveadvisory.com', '+91 20 1234 5678')
on conflict do nothing;

insert into gl_accounts (code, name, type, parent_group) values
  ('4000','Sales / Professional Fees','income','Revenue'),
  ('1100','Sundry Debtors (Accounts Receivable)','asset','Current Assets'),
  ('1200','Bank Account','asset','Current Assets'),
  ('1210','Cash in Hand','asset','Current Assets'),
  ('2100','Output GST Payable','liability','Current Liabilities'),
  ('5100','Discount Allowed','expense','Indirect Expenses')
on conflict (code) do nothing;

insert into reminder_templates (name, subject, body) values
  ('Default reminder',
   'Payment reminder: invoice {invoice_no}',
   'Dear {customer},' || chr(10) || chr(10) ||
   'Our records show invoice {invoice_no} for ₹{amount} is now {days_overdue} days overdue. ' ||
   'We would appreciate payment at your earliest convenience.' || chr(10) || chr(10) ||
   'Warm regards,' || chr(10) || 'Verve Advisory, Accounts Team')
on conflict do nothing;

-- ---------- seed: customers -------------------------------------------------

insert into customers (code, name, gstin, pan, contact_person, email, phone, address, credit_limit, credit_days, opening_balance) values
  ('CUST001','Sterling Textiles Pvt Ltd','27AABCS1111A1Z1','AABCS1111A','Rohit Mehta','rohit@sterlingtex.in','+91 98200 11111','Mumbai',  500000,30,0),
  ('CUST002','Greenleaf Organics LLP','24AABCG2222B1Z2','AABCG2222B','Anita Shah','anita@greenleaf.in','+91 98250 22222','Ahmedabad',300000,15,12000),
  ('CUST003','Nimbus Software Solutions','29AABCN3333C1Z3','AABCN3333C','Karan Rao','karan@nimbus.io','+91 98860 33333','Bengaluru', 800000,45,0),
  ('CUST004','Patel Agro Exports','24AABCP4444D1Z4','AABCP4444D','Meena Patel','meena@patelagro.in','+91 99090 44444','Surat',    400000,30,0),
  ('CUST005','Coastal Logistics Co','27AABCC5555E1Z5','AABCC5555E','Sameer Naik','sameer@coastallog.in','+91 98191 55555','Mumbai', 600000,30,25000),
  ('CUST006','Aurora Media House','07AABCA6666F1Z6','AABCA6666F','Priya Verma','priya@auroramedia.in','+91 98110 66666','Delhi',   250000,15,0),
  ('CUST007','Himalaya Foods Pvt Ltd','06AABCH7777G1Z7','AABCH7777G','Vikram Singh','vikram@himalayafoods.in','+91 98120 77777','Gurugram',450000,45,0),
  ('CUST008','BluePeak Constructions','27AABCB8888H1Z8','AABCB8888H','Faisal Khan','faisal@bluepeak.in','+91 98201 88888','Pune',   900000,30,40000),
  ('CUST009','Sunrise Pharmaceuticals','36AABCS9999I1Z9','AABCS9999I','Lata Reddy','lata@sunrisepharma.in','+91 99490 99999','Hyderabad',700000,30,0),
  ('CUST010','Tarang Apparels','33AABCT1010J1Z1','AABCT1010J','Deepak Iyer','deepak@tarang.in','+91 98400 10101','Chennai',  350000,15,0),
  ('CUST011','Vertex Engineering Works','27AABCV1111K1Z2','AABCV1111K','Neha Joshi','neha@vertexeng.in','+91 98202 11212','Pune',  550000,45,18000),
  ('CUST012','Lotus Hospitality Group','27AABCL1212L1Z3','AABCL1212L','Arjun Kapoor','arjun@lotushospitality.in','+91 98203 12323','Mumbai',500000,30,0)
on conflict (code) do nothing;

-- ---------- seed: 40 invoices + items, with a realistic status mix ----------
-- ~1/4 paid (full receipt), some partial (half receipt), past-due open ones
-- become overdue, the rest stay open. Dates are relative to today, so the data
-- always looks "live" whenever a team opens the app.

do $$
declare
  custs       uuid[];
  cust_days   int[];
  n_cust      int;
  i           int;
  cidx        int;
  inv_id      uuid;
  rcpt_id     uuid;
  v_days      int;
  v_date      date;
  v_due       date;
  v_subtotal  numeric(14,2);
  v_tax       numeric(14,2);
  v_total     numeric(14,2);
  v_status    text;
  v_modes     text[] := array['cash','cheque','upi','neft'];
begin
  select array_agg(id order by code), array_agg(credit_days order by code)
    into custs, cust_days from customers;
  n_cust := array_length(custs, 1);

  -- only seed invoices once
  if (select count(*) from invoices) > 0 then
    return;
  end if;

  for i in 1..40 loop
    cidx       := ((i - 1) % n_cust) + 1;
    v_days     := cust_days[cidx];
    v_date     := current_date - (i * 3);              -- spread over ~120 days
    v_due      := v_date + v_days;
    v_subtotal := 8000 + ((i * 1700) % 42000);
    v_tax      := round(v_subtotal * 0.18, 2);
    v_total    := v_subtotal + v_tax;

    if (i % 4) = 0 then
      v_status := 'paid';
    elsif (i % 7) = 0 then
      v_status := 'partial';
    elsif v_due < current_date then
      v_status := 'overdue';
    else
      v_status := 'open';
    end if;

    insert into invoices (invoice_no, invoice_date, customer_id, due_date, subtotal, tax_amount, total, status)
      values ('INV-' || lpad(i::text, 4, '0'), v_date, custs[cidx], v_due, v_subtotal, v_tax, v_total, v_status)
      returning id into inv_id;

    insert into invoice_items (invoice_id, description, qty, rate, amount)
      values (inv_id, 'Professional advisory, engagement milestone ' || i, 1, v_subtotal, v_subtotal);

    if v_status = 'paid' then
      insert into receipts (receipt_no, receipt_date, customer_id, amount, mode, reference)
        values ('RCP-' || lpad(i::text, 4, '0'), v_date + 5, custs[cidx], v_total,
                v_modes[((i / 4) % 4) + 1], 'TXN' || lpad(i::text, 5, '0'))
        returning id into rcpt_id;
      insert into receipt_allocations (receipt_id, invoice_id, amount)
        values (rcpt_id, inv_id, v_total);
    elsif v_status = 'partial' then
      insert into receipts (receipt_no, receipt_date, customer_id, amount, mode, reference)
        values ('RCP-' || lpad(i::text, 4, '0'), v_date + 5, custs[cidx], round(v_total / 2, 2),
                v_modes[((i / 7) % 4) + 1], 'TXN' || lpad(i::text, 5, '0'))
        returning id into rcpt_id;
      insert into receipt_allocations (receipt_id, invoice_id, amount)
        values (rcpt_id, inv_id, round(v_total / 2, 2));
    end if;
  end loop;
end $$;
