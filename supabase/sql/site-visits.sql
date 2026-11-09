-- ReviewRise: private visitor counter for the owner's Admin page.
-- Safe to run: it only ADDS a table and a function. Nothing existing is changed or deleted.
--
-- How it works
--   * Public pages (home, support, free generator, privacy, terms) tell the database "someone opened this page"
--     through public.count_page_open().
--   * No cookies and no names. A visitor is stored only as a short anonymous code that changes every day
--     and cannot be traced back to a person. The network address itself is never stored.
--   * Search-engine bots and previews are ignored. The same visitor opening the same page again within
--     30 minutes counts once.
--   * Only you can read the numbers (Admin page). Visitors cannot read or change anything.
--   * Rows older than 400 days are removed automatically.

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  day date not null default ((now() at time zone 'utc')::date),
  visitor text not null,
  page text not null,
  referrer text,
  country text
);

create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_visitor_idx on public.site_visits (visitor, page, created_at);

alter table public.site_visits enable row level security;
revoke all on table public.site_visits from anon, authenticated;
grant select, delete on table public.site_visits to service_role;

-- Older name used in the first version of this file (removed, it is replaced by count_page_open).
drop function if exists public.track_visit(text, text);

create or replace function public.count_page_open(
  p_page text,
  p_referrer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c_salt constant text := '7f2d9c4e6b1a4d08b3e5a97c20d6f184';
  v_headers jsonb;
  v_ua text;
  v_ip text;
  v_visitor text;
  v_page text;
  v_referrer text;
  v_country text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_ua := lower(coalesce(v_headers ->> 'user-agent', ''));
  if v_ua ~ '(bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|monitor|uptime|scrapy|httpclient|node-fetch)' then
    return jsonb_build_object('ok', true);
  end if;

  v_ip := nullif(btrim(coalesce(
    v_headers ->> 'cf-connecting-ip',
    substring(coalesce(v_headers ->> 'x-forwarded-for', '') from '([^,[:space:]]+)[[:space:]]*$')
  )), '');
  v_visitor := left(encode(sha256(convert_to(
    coalesce(v_ip, '') || '|' || v_ua || '|' || ((now() at time zone 'utc')::date)::text || '|' || c_salt, 'UTF8')), 'hex'), 16);

  v_page := regexp_replace(split_part(split_part(coalesce(p_page, ''), '?', 1), '#', 1), '^.*/', '');
  if v_page = '' then v_page := 'index.html'; end if;
  if v_page !~ '^[A-Za-z0-9._-]{1,60}$' then v_page := 'other'; end if;

  v_referrer := lower(substring(coalesce(p_referrer, '') from '^https?://([^/:?#]+)'));
  v_referrer := nullif(regexp_replace(coalesce(v_referrer, ''), '^www\.', ''), '');
  if v_referrer is not null then
    if v_referrer = 'mouadamraji2020-star.github.io' then v_referrer := null; else v_referrer := left(v_referrer, 80); end if;
  end if;

  v_country := upper(coalesce(v_headers ->> 'cf-ipcountry', ''));
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;

  -- Same visitor, same page, within 30 minutes: count once.
  if exists (
    select 1 from public.site_visits
     where visitor = v_visitor and page = v_page and created_at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', true);
  end if;

  -- Flood protection.
  if (select count(*) from public.site_visits where created_at > now() - interval '1 hour') >= 3000 then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.site_visits (visitor, page, referrer, country)
  values (v_visitor, v_page, v_referrer, v_country);

  if random() < 0.01 then
    delete from public.site_visits where created_at < now() - interval '400 days';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.count_page_open(text, text) from public;
grant execute on function public.count_page_open(text, text) to anon, authenticated;
