begin;
create index if not exists ratings_personal_season_idx on public.ratings(user_id, player_id, match_id) where phase = 'ft' and overall is not null;
create or replace function public.personal_season_averages(expected_user_id uuid, target_match_id uuid)
returns table (player_id uuid, average numeric, match_count bigint, includes_converted boolean)
language sql stable security invoker set search_path = public as $$
  with target as (
    select m.kickoff_at,
      date_trunc('year', (m.kickoff_at at time zone 'UTC') - interval '6 months') + interval '6 months' as season_start
    from public.matches m where m.id = target_match_id and auth.uid() = expected_user_id
  )
  select r.player_id, round(avg(r.overall), 4), count(*), bool_or(r.converted_from_five)
  from public.ratings r
  join public.matches m on m.id = r.match_id
  cross join target t
  where r.user_id = auth.uid() and r.phase = 'ft' and r.overall is not null
    and m.status = 'finished' and m.kickoff_at < t.kickoff_at
    and m.kickoff_at >= (t.season_start at time zone 'UTC')
    and exists (select 1 from public.clubs b where b.provider_id = 529 and (b.id = m.home_team_id or b.id = m.away_team_id))
  group by r.player_id;
$$;
revoke all on function public.personal_season_averages(uuid, uuid) from public, anon;
grant execute on function public.personal_season_averages(uuid, uuid) to authenticated;
commit;
