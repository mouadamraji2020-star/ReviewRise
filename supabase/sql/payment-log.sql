-- ReviewRise: payment log for manual (WhatsApp / bank transfer) payments.
-- Safe to run: it only ADDS a table. Nothing existing is changed or deleted.
--
-- When you activate a plan in the Admin page you can record what was paid. Each activation writes one
-- row here. Only you can read it (Admin page > Payments). The rows belong to the customer's account:
-- if that customer deletes their account, their rows are removed with it.

create table if not exists public.payment_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  customer_email text not null,
  plan text not null check (plan in ('pro', 'business')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'MAD', 'EUR')),
  method text,
  note text,
  period_end timestamptz
);

create index if not exists payment_log_created_idx on public.payment_log (created_at desc);
create index if not exists payment_log_user_idx on public.payment_log (user_id);

-- Private table: the website's API cannot read or write it directly.
alter table public.payment_log enable row level security;
revoke all on table public.payment_log from anon, authenticated;
grant select, insert, delete on table public.payment_log to service_role;
