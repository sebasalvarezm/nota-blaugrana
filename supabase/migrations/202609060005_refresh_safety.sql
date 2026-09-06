begin;
create table if not exists public.football_sync_state (
  singleton boolean primary key default true check (singleton),
  last_attempt_at timestamptz,
  lease_until timestamptz,
  last_success_at timestamptz
);
alter table public.football_sync_state enable row level security;
revoke all on public.football_sync_state from anon, authenticated;
grant select, insert, update on public.football_sync_state to service_role;
create or replace function public.claim_football_sync(min_interval_seconds integer)
returns boolean language plpgsql security invoker set search_path = public as $$
declare claimed boolean;
begin
  insert into public.football_sync_state(singleton) values (true) on conflict do nothing;
  update public.football_sync_state set last_attempt_at = now(), lease_until = now() + interval '90 seconds'
  where singleton and coalesce(lease_until, '-infinity') < now()
    and coalesce(last_attempt_at, '-infinity') < now() - make_interval(secs => greatest(min_interval_seconds, 60))
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
create or replace function public.finish_football_sync(succeeded boolean)
returns void language sql security invoker set search_path = public as $$
  update public.football_sync_state set lease_until = now(), last_success_at = case when succeeded then now() else last_success_at end where singleton;
$$;
create or replace function public.replace_fotmob_lineup(target_match_id uuid, lineup_rows jsonb, match_formation text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(lineup_rows) <> 'array' then raise exception 'Expected a lineup array'; end if;
  if (select count(*) from jsonb_array_elements(lineup_rows) p where (p->>'starter')::boolean) <> 11 then raise exception 'Expected eleven starters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 0));
  delete from public.match_players where match_id = target_match_id;
  insert into public.match_players (match_id, player_id, team_id, squad_number, starter, played, minute_in, minute_out, provider_position, role_code, role_label, grid, pitch_x, pitch_y)
  select target_match_id, p.player_id, p.team_id, p.squad_number, p.starter, p.played, p.minute_in, p.minute_out, p.provider_position, p.role_code, p.role_label, p.grid, p.pitch_x, p.pitch_y
  from jsonb_to_recordset(lineup_rows) p(player_id uuid, team_id uuid, squad_number integer, starter boolean, played boolean, minute_in integer, minute_out integer, provider_position text, role_code text, role_label text, grid text, pitch_x numeric, pitch_y numeric);
  update public.matches set formation = match_formation, synced_at = now() where id = target_match_id;
end;
$$;
revoke all on function public.claim_football_sync(integer), public.finish_football_sync(boolean), public.replace_fotmob_lineup(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_football_sync(integer), public.finish_football_sync(boolean), public.replace_fotmob_lineup(uuid, jsonb, text) to service_role;
commit;
