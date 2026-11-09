-- ReviewRise: "mark feedback as handled" + private notes on the Feedback page.
-- Safe to run: it only ADDS two columns and one function. Nothing existing is changed or deleted.
--
-- How it works
--   * Each feedback row gets two new optional fields: handled_at (when you handled it) and owner_note
--     (a private note, up to 1000 characters). Only the business owner can see or change them.
--   * The website changes them through public.update_feedback_status(), which checks that the signed-in
--     user really owns the review link that the feedback belongs to.

alter table public."Feedback" add column if not exists handled_at timestamptz;
alter table public."Feedback" add column if not exists owner_note text;

create or replace function public.update_feedback_status(
  p_id text,
  p_handled boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_found boolean := false;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if v_user is null then raise exception 'NOT_SIGNED_IN'; end if;

  select true, coalesce(f.user_id, r.user_id)
    into v_found, v_owner
    from public."Feedback" f
    left join public."Reviewlinks" r on r.id = f.review_link_id
   where f.id::text = p_id
   limit 1;

  if not coalesce(v_found, false) then raise exception 'NOT_FOUND'; end if;
  if v_owner is distinct from v_user then raise exception 'NOT_ALLOWED'; end if;

  update public."Feedback"
     set handled_at = case when p_handled then coalesce(handled_at, now()) else null end,
         owner_note = v_note
   where id::text = p_id;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.update_feedback_status(text, boolean, text) from public;
grant execute on function public.update_feedback_status(text, boolean, text) to authenticated;
