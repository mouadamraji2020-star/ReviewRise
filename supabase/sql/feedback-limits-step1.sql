-- ReviewRise: controlled feedback submission with duplicate and flood limits.
-- STEP 1 of 2. Safe to run: it only ADDS a table and a function. The old way of saving
-- feedback keeps working until STEP 2 is run.
--
-- Rules enforced by public.submit_feedback():
--   * one rating per device per business for 30 days        -> ALREADY_RATED
--   * at most 15 ratings per network address per business per hour (a busy hotel WiFi still works)
--   * at most 20 ratings per business per minute (stops bots)  -> RATE_LIMITED
--   * the business name and owner are taken from the review link, never from the visitor
--   * rating must be 1 to 5, comment at most 2000 characters

create table if not exists public.feedback_guard (
  id bigint generated always as identity primary key,
  review_link_id bigint not null references public."Reviewlinks"(id) on delete cascade,
  device_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_guard_device_idx on public.feedback_guard (review_link_id, device_id, created_at);
create index if not exists feedback_guard_ip_idx on public.feedback_guard (review_link_id, ip_hash, created_at);
create index if not exists feedback_guard_link_idx on public.feedback_guard (review_link_id, created_at);

-- Private bookkeeping table: nobody can read or write it through the website's API.
alter table public.feedback_guard enable row level security;
revoke all on table public.feedback_guard from anon, authenticated;

create or replace function public.submit_feedback(
  p_review_link_id bigint,
  p_rating integer,
  p_feedback text default null,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c_salt constant text := 'a984130b3aac23c126a8313573f10bd2';
  v_link record;
  v_feedback text;
  v_device text;
  v_headers jsonb;
  v_ip text;
  v_ip_hash text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_RATING';
  end if;

  select r.id, r.user_id, r.business_name
    into v_link
    from public."Reviewlinks" r
   where r.id = p_review_link_id;
  if not found then
    raise exception 'LINK_NOT_FOUND';
  end if;

  v_feedback := nullif(btrim(p_feedback), '');
  if v_feedback is not null and char_length(v_feedback) > 2000 then
    raise exception 'FEEDBACK_TOO_LONG';
  end if;

  v_device := case when p_device_id ~ '^[A-Za-z0-9_-]{16,64}$' then p_device_id else null end;

  -- Network address, stored only as a salted one-way hash. Cloudflare's header cannot be forged by the visitor;
  -- otherwise the LAST entry of x-forwarded-for is used (the first can be written by the visitor).
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

  -- Serialise submissions from the same device for the same business, so two taps at once cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(p_review_link_id::text || ':' || coalesce(v_device, ''), 0));

  if v_device is not null and exists (
    select 1 from public.feedback_guard g
     where g.review_link_id = p_review_link_id
       and g.device_id = v_device
       and g.created_at > now() - interval '30 days'
  ) then
    raise exception 'ALREADY_RATED';
  end if;

  if v_ip_hash is not null and (
    select count(*) from public.feedback_guard g
     where g.review_link_id = p_review_link_id
       and g.ip_hash = v_ip_hash
       and g.created_at > now() - interval '1 hour'
  ) >= 15 then
    raise exception 'RATE_LIMITED';
  end if;

  if (
    select count(*) from public.feedback_guard g
     where g.review_link_id = p_review_link_id
       and g.created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public."Feedback" (rating, feedback, business, review_link_id, user_id)
  values (p_rating, v_feedback, v_link.business_name, v_link.id, v_link.user_id);

  insert into public.feedback_guard (review_link_id, device_id, ip_hash)
  values (p_review_link_id, v_device, v_ip_hash);

  -- Tidy up old bookkeeping now and then.
  if random() < 0.02 then
    delete from public.feedback_guard where created_at < now() - interval '60 days';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.submit_feedback(bigint, integer, text, text) from public;
grant execute on function public.submit_feedback(bigint, integer, text, text) to anon, authenticated;
