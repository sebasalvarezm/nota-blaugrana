create extension if not exists pgcrypto;

create type public.match_status as enum ('scheduled', 'live', 'halftime', 'finished', 'postponed', 'cancelled');
create type public.rating_phase as enum ('ht', 'ft');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  provider_id integer unique,
  name text not null,
  short_name text not null,
  logo_url text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  provider_id integer not null,
  name text not null,
  country text,
  logo_url text,
  season integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, season)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  provider_id integer unique,
  name text not null,
  first_name text,
  last_name text,
  photo_url text,
  nationality text,
  default_position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  provider_id integer unique,
  competition_id uuid references public.competitions(id),
  home_team_id uuid not null references public.clubs(id),
  away_team_id uuid not null references public.clubs(id),
  kickoff_at timestamptz not null,
  venue text,
  timezone text,
  status public.match_status not null default 'scheduled',
  status_short text,
  elapsed integer,
  home_score integer,
  away_score integer,
  halftime_home_score integer,
  halftime_away_score integer,
  formation text,
  provider_payload jsonb not null default '{}'::jsonb,
  provider_updated_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_kickoff_at_idx on public.matches(kickoff_at desc);
create index matches_home_team_idx on public.matches(home_team_id, kickoff_at desc);
create index matches_away_team_idx on public.matches(away_team_id, kickoff_at desc);

create table public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  team_id uuid not null references public.clubs(id),
  squad_number integer,
  starter boolean not null default false,
  played boolean not null default false,
  minute_in integer,
  minute_out integer,
  provider_position text,
  role_code text not null,
  role_label text not null,
  grid text,
  pitch_x numeric(5,2),
  pitch_y numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(match_id, player_id)
);

create index match_players_match_idx on public.match_players(match_id, starter desc);

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  event_key text not null,
  minute integer,
  extra_minute integer,
  team_id uuid references public.clubs(id),
  player_id uuid references public.players(id),
  assist_player_id uuid references public.players(id),
  type text not null,
  detail text,
  comments text,
  created_at timestamptz not null default now(),
  unique(match_id, event_key)
);

create index match_events_match_minute_idx on public.match_events(match_id, minute, extra_minute);

create table public.rating_templates (
  role_code text primary key,
  label text not null,
  attributes jsonb not null,
  version integer not null default 1,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.valid_rating_attributes(value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each(value) item
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}')::numeric not between 1 and 5
    );
$$;

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  phase public.rating_phase not null,
  overall smallint check (overall between 1 and 5),
  attributes jsonb not null default '{}'::jsonb,
  template_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, match_id, player_id, phase),
  check (public.valid_rating_attributes(attributes))
);

create index ratings_match_phase_idx on public.ratings(match_id, phase);
create index ratings_user_match_idx on public.ratings(user_id, match_id);

insert into public.rating_templates(role_code, label, attributes) values
  ('GK', 'Goalkeeper', '[{"key":"distribution","label":"Distribution"},{"key":"handling","label":"Handling & security"},{"key":"interventions","label":"Interventions"},{"key":"decisions","label":"Decisions & sweeping"}]'),
  ('CB', 'Centre-back', '[{"key":"positioning","label":"Positioning"},{"key":"duels","label":"Duels & defending"},{"key":"buildUp","label":"Build-up passing"},{"key":"cover","label":"Cover & recovery"}]'),
  ('FB', 'Full-back', '[{"key":"defending","label":"1v1 defending"},{"key":"positioning","label":"Positioning"},{"key":"progression","label":"Ball progression"},{"key":"delivery","label":"Width & final ball"}]'),
  ('PIVOT', 'Pivot', '[{"key":"resistance","label":"Press resistance"},{"key":"distribution","label":"Distribution"},{"key":"positioning","label":"Defensive positioning"},{"key":"recovery","label":"Ball recovery"}]'),
  ('MID', 'Midfielder', '[{"key":"resistance","label":"Press resistance"},{"key":"progression","label":"Passing & progression"},{"key":"creativity","label":"Creativity"},{"key":"tempo","label":"Tempo & work rate"}]'),
  ('WING', 'Winger', '[{"key":"oneVOne","label":"1v1 ability"},{"key":"progression","label":"Ball progression"},{"key":"finalBall","label":"Creativity & final ball"},{"key":"endProduct","label":"End product"}]'),
  ('ST', 'Striker', '[{"key":"movement","label":"Movement"},{"key":"linkUp","label":"Link-up play"},{"key":"finishing","label":"Finishing"},{"key":"pressing","label":"Pressing & box presence"}]')
on conflict (role_code) do update set attributes = excluded.attributes, updated_at = now();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger clubs_set_updated_at before update on public.clubs for each row execute function public.set_updated_at();
create trigger competitions_set_updated_at before update on public.competitions for each row execute function public.set_updated_at();
create trigger players_set_updated_at before update on public.players for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches for each row execute function public.set_updated_at();
create trigger match_players_set_updated_at before update on public.match_players for each row execute function public.set_updated_at();
create trigger ratings_set_updated_at before update on public.ratings for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.competitions enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_events enable row level security;
alter table public.rating_templates enable row level security;
alter table public.ratings enable row level security;

create policy "Profiles are visible to their owner" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Profiles are editable by their owner" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Clubs are public" on public.clubs for select to anon, authenticated using (true);
create policy "Competitions are public" on public.competitions for select to anon, authenticated using (true);
create policy "Players are public" on public.players for select to anon, authenticated using (true);
create policy "Matches are public" on public.matches for select to anon, authenticated using (true);
create policy "Lineups are public" on public.match_players for select to anon, authenticated using (true);
create policy "Match events are public" on public.match_events for select to anon, authenticated using (true);
create policy "Rating templates are public" on public.rating_templates for select to anon, authenticated using (active);

create policy "Users can read their ratings" on public.ratings for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their ratings" on public.ratings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their ratings" on public.ratings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their ratings" on public.ratings for delete to authenticated using ((select auth.uid()) = user_id);

grant select on public.clubs, public.competitions, public.players, public.matches, public.match_players, public.match_events, public.rating_templates to anon, authenticated;
grant select, insert, update, delete on public.ratings to authenticated;
grant select, update on public.profiles to authenticated;

grant select, insert, update on public.clubs to service_role;
grant select, insert, update on public.competitions to service_role;
grant select, insert, update on public.players to service_role;
grant select, insert, update on public.matches to service_role;
grant select, insert, update, delete on public.match_players to service_role;
grant select, insert, update on public.match_events to service_role;

create or replace function public.community_match_summary(target_match_id uuid)
returns table (
  player_id uuid,
  phase public.rating_phase,
  vote_count bigint,
  overall_average numeric,
  attribute_averages jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with overall as (
    select r.player_id, r.phase, count(*) as vote_count, round(avg(r.overall)::numeric, 2) as overall_average
    from public.ratings r
    where r.match_id = target_match_id and r.overall is not null
    group by r.player_id, r.phase
  ), attributes as (
    select r.player_id, r.phase, item.key,
      round(avg((item.value #>> '{}')::numeric), 2) as attribute_average
    from public.ratings r
    cross join lateral jsonb_each(r.attributes) item
    where r.match_id = target_match_id and jsonb_typeof(item.value) = 'number'
    group by r.player_id, r.phase, item.key
  ), packed as (
    select a.player_id, a.phase, jsonb_object_agg(a.key, a.attribute_average) as attribute_averages
    from attributes a
    group by a.player_id, a.phase
  )
  select o.player_id, o.phase, o.vote_count, o.overall_average,
    coalesce(p.attribute_averages, '{}'::jsonb)
  from overall o
  left join packed p using (player_id, phase);
$$;

revoke all on function public.community_match_summary(uuid) from public;
grant execute on function public.community_match_summary(uuid) to anon, authenticated;
