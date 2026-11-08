-- ReviewRise: support messages (Help Center form and Settings > Report a Problem).
-- Safe to run: it only ADDS a table and a function. Nothing existing is changed or deleted.
--
-- How it works
--   * Visitors and signed-in users send a message through public.submit_support_message().
--   * Nobody can read or edit the messages through the website. Only you (owner) can read them:
--     in the Supabase Table Editor, and in the ReviewRise admin page once the admin-support
--     Edge Function is deployed.
--   * Abuse limits: at most 5 messages per network address per hour, 5 per email address per hour,
--     and 100 messages per hour in total.
--   * Lengths are limited: name 120, email 160, subject 160, message 4000.

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  category text,
  source text not null default 'support_page',
  page text,
  status text not null default 'new' check (status in ('new', 'done')),
  ip_hash text
);

create index if not exists support_messages_created_idx on public.support_messages (created_at desc);
create index if not exists support_messages_ip_idx on public.support_messages (ip_hash, created_at);
create index if not exists support_messages_email_idx on public.support_messages (lower(email), created_at);

-- Private table: the website's API cannot read or write it directly.
alter table public.support_messages enable row level security;
revoke all on table public.support_messages from anon, authenticated;
grant select, update, delete on table public.support_messages to service_role;

create or replace function public.submit_support_message(
  p_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_category text default null,
  p_source text default 'support_page',
  p_page text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c_salt constant text := 'c3b7e1a94d5f4e0a8a6d2f7b91e04c58';
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_source text := case when p_source = 'settings' then 'settings' else 'support_page' end;
  v_page text := nullif(left(btrim(coalesce(p_page, '')), 160), '');
  v_headers jsonb;
  v_ip text;
  v_ip_hash text;
  v_user uuid := auth.uid();
begin
  if v_name = '' or length(v_name) > 120 then raise exception 'INVALID_NAME'; end if;
  if length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if v_subject = '' or length(v_subject) > 160 then raise exception 'INVALID_SUBJECT'; end if;
  if v_message = '' or length(v_message) > 4000 then raise exception 'INVALID_MESSAGE'; end if;
  if v_category is not null then v_category := left(v_category, 60); end if;

  -- Network address, stored only as a salted one-way hash. Cloudflare's header cannot be forged by the
  -- visitor; otherwise the LAST entry of x-forwarded-for is used (the first can be written by the visitor).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(btrim(coalesce(
    v_headers ->> 'cf-connecting-ip',
    substring(coalesce(v_headers ->> 'x-forwarded-for', '') from '([^,[:space:]]+)[[:space:]]*$')
  )), '');
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to(v_ip || c_salt, 'UTF8')), 'hex');
  end if;

  if v_ip_hash is not null and (
    select count(*) from public.support_messages
     where ip_hash = v_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  if (select count(*) from public.support_messages
       where lower(email) = v_email and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  if (select count(*) from public.support_messages
       where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.support_messages
    (user_id, name, email, subject, message, category, source, page, ip_hash)
  values
    (v_user, v_name, v_email, v_subject, v_message, v_category, v_source, v_page, v_ip_hash);

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.submit_support_message(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_support_message(text, text, text, text, text, text, text) to anon, authenticated;
