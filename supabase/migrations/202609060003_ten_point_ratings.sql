-- Run BEFORE deploying the /10 client. Old clients retain local saves but cannot
-- write through the old table API. Refresh them after deploying the new version.
-- Re-running this file does not multiply converted ratings again.
begin;
lock table public.ratings in access exclusive mode;

alter table public.ratings add column if not exists score_scale smallint not null default 5;
alter table public.ratings add column if not exists converted_from_five boolean not null default false;
create table if not exists public.rating_scale_archive (
  rating_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  overall numeric,
  attributes jsonb not null,
  original_updated_at timestamptz not null,
  original_scale smallint not null default 5,
  archived_at timestamptz not null default now()
);
alter table public.rating_scale_archive enable row level security;
revoke all on public.rating_scale_archive from anon, authenticated;
grant select, insert on public.rating_scale_archive to service_role;
insert into public.rating_scale_archive (rating_id, user_id, overall, attributes, original_updated_at)
select id, user_id, overall, attributes, updated_at from public.ratings where score_scale = 5
on conflict (rating_id) do nothing;

alter table public.ratings drop constraint if exists ratings_overall_check;
alter table public.ratings alter column overall type numeric(3,1) using overall::numeric;
create or replace function public.valid_rating_attributes(value jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(value) = 'object' then not exists (
    select 1 from jsonb_each(value) item
    where case when jsonb_typeof(item.value) = 'number' then
      (item.value #>> '{}')::numeric not between 1 and 10
      or mod((item.value #>> '{}')::numeric * 2, 1) <> 0
    else true end
  ) else false end;
$$;

update public.ratings r set
  overall = r.overall * 2,
  attributes = coalesce((select jsonb_object_agg(key, (value #>> '{}')::numeric * 2) from jsonb_each(r.attributes)), '{}'::jsonb),
  score_scale = 10, converted_from_five = true
where r.score_scale = 5;
alter table public.ratings alter column score_scale set default 10;
alter table public.ratings add constraint ratings_overall_check
  check (overall between 1 and 10 and mod(overall * 2, 1) = 0);
alter table public.ratings drop constraint if exists ratings_score_scale_check;
alter table public.ratings add constraint ratings_score_scale_check check (score_scale = 10);

-- A versioned, authenticated write boundary prevents cached /5 clients from
-- silently saving values on the wrong scale. SELECT remains protected by RLS.
revoke insert, update, delete on public.ratings from authenticated;
create or replace function public.save_player_rating(
  expected_user_id uuid, target_match_id uuid, target_player_id uuid,
  target_phase public.rating_phase, overall_score numeric, attribute_scores jsonb,
  write_version integer, expected_updated_at timestamptz default null, clear_rating boolean default false, legacy_conversion boolean default false
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  existing public.ratings%rowtype;
  allowed_attributes jsonb;
  saved_at timestamptz;
begin
  if auth.uid() is null or auth.uid() is distinct from expected_user_id then
    raise exception 'Sign in again to save' using errcode = '42501';
  end if;
  if write_version is distinct from 10 then raise exception 'Refresh the app to save ratings'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || target_match_id::text || target_player_id::text || target_phase::text, 1));
  select * into existing from public.ratings where user_id = auth.uid() and match_id = target_match_id and player_id = target_player_id and phase = target_phase for update;
  -- A timed-out request may already have committed; an exact retry is a no-op.
  if clear_rating and existing.id is null then return null; end if;
  if not clear_rating and existing.id is not null and existing.overall is not distinct from overall_score
    and existing.attributes = attribute_scores and existing.converted_from_five = legacy_conversion then return existing.updated_at; end if;
  if existing.id is not null and existing.updated_at is distinct from expected_updated_at then
    raise exception 'This rating changed on another device' using errcode = '40001';
  end if;
  if existing.id is null and expected_updated_at is not null then
    raise exception 'This rating was cleared on another device' using errcode = '40001';
  end if;
  if clear_rating then
    delete from public.ratings where id = existing.id;
    return null;
  end if;
  select rt.attributes into allowed_attributes from public.match_players mp
  join public.rating_templates rt on rt.role_code = mp.role_code
  where mp.match_id = target_match_id and mp.player_id = target_player_id
    and (mp.starter or mp.played)
    and (target_phase = 'ft' or mp.starter or mp.minute_in <= 45);
  if allowed_attributes is null then raise exception 'Player is not eligible for this phase'; end if;
  if (overall_score is not null and (overall_score not between 1 and 10 or mod(overall_score * 2, 1) <> 0))
    or not public.valid_rating_attributes(attribute_scores) then raise exception 'Invalid rating'; end if;
  if exists (select 1 from jsonb_object_keys(attribute_scores) as keys(key) where not exists (
    select 1 from jsonb_array_elements(allowed_attributes) a where a->>'key' = keys.key
  )) then raise exception 'Unknown rating attribute'; end if;
  insert into public.ratings (user_id, match_id, player_id, phase, overall, attributes, score_scale, converted_from_five)
  values (auth.uid(), target_match_id, target_player_id, target_phase, overall_score, attribute_scores, 10, legacy_conversion)
  on conflict (user_id, match_id, player_id, phase) do update
    set overall = excluded.overall, attributes = excluded.attributes, score_scale = 10, converted_from_five = excluded.converted_from_five
  returning updated_at into saved_at;
  return saved_at;
end;
$$;
revoke all on function public.save_player_rating(uuid, uuid, uuid, public.rating_phase, numeric, jsonb, integer, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.save_player_rating(uuid, uuid, uuid, public.rating_phase, numeric, jsonb, integer, timestamptz, boolean, boolean) to authenticated;
commit;
