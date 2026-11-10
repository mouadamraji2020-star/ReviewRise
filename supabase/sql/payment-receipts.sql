-- ReviewRise: payment receipts for customers (Settings > Subscription > Payment history).
-- Safe to run: it only ADDS one function. Nothing existing is changed or deleted.
--
-- A signed-in customer can read ONLY their own payments, and only these fields:
-- date, plan, billing cycle, amount, currency, payment method, period end, customer email.
-- Your private note on a payment is never shown to the customer.
-- Only payments where you entered an amount in the Admin page get a receipt.

create or replace function public.get_my_payments()
returns table (
  id bigint,
  created_at timestamptz,
  customer_email text,
  plan text,
  billing_cycle text,
  amount numeric,
  currency text,
  method text,
  period_end timestamptz
)
language sql
security definer
set search_path = public
as $function$
  select p.id, p.created_at, p.customer_email, p.plan, p.billing_cycle,
         p.amount, p.currency, p.method, p.period_end
    from public.payment_log p
   where p.user_id = auth.uid()
     and p.amount is not null
   order by p.created_at desc
   limit 100;
$function$;

revoke all on function public.get_my_payments() from public;
grant execute on function public.get_my_payments() to authenticated;
