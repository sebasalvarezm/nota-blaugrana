begin;
create table if not exists public.match_position_overrides (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role_code text not null references public.rating_templates(role_code),
  role_label text not null,
  pitch_x numeric(5,2) check (pitch_x between 0 and 100),
  pitch_y numeric(5,2) check (pitch_y between 0 and 100),
  primary key(match_id, player_id)
);
alter table public.match_position_overrides enable row level security;
revoke all on public.match_position_overrides from anon, authenticated;
grant select, insert, update on public.match_position_overrides to service_role;
create or replace function public.save_match_positions(target_match_id uuid, position_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(position_rows) is distinct from 'array' or jsonb_array_length(position_rows) not between 1 and 30 then raise exception 'Invalid positions'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 0));
  if (select count(*) from jsonb_array_elements(position_rows)) <> (select count(distinct p->>'player_id') from jsonb_array_elements(position_rows) p)
    or exists(select 1 from jsonb_array_elements(position_rows) p where not exists(select 1 from public.match_players mp where mp.match_id=target_match_id and mp.player_id=(p->>'player_id')::uuid))
    or jsonb_array_length(position_rows) <> (select count(*) from public.match_players where match_id=target_match_id)
    then raise exception 'Lineup changed. Reload before saving positions'; end if;
  insert into public.match_position_overrides(match_id,player_id,role_code,role_label,pitch_x,pitch_y)
  select target_match_id,p.player_id,p.role_code,p.role_label,p.pitch_x,p.pitch_y
  from jsonb_to_recordset(position_rows) p(player_id uuid,role_code text,role_label text,pitch_x numeric,pitch_y numeric)
  on conflict(match_id,player_id) do update set role_code=excluded.role_code,role_label=excluded.role_label,pitch_x=excluded.pitch_x,pitch_y=excluded.pitch_y;
  update public.match_players mp set role_code=o.role_code,role_label=o.role_label,pitch_x=o.pitch_x,pitch_y=o.pitch_y
  from public.match_position_overrides o where mp.match_id=target_match_id and o.match_id=mp.match_id and o.player_id=mp.player_id;
end;
$$;
revoke all on function public.save_match_positions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_match_positions(uuid,jsonb) to service_role;
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
  update public.match_players mp set role_code=o.role_code,role_label=o.role_label,pitch_x=o.pitch_x,pitch_y=o.pitch_y
  from public.match_position_overrides o where mp.match_id=target_match_id and o.match_id=mp.match_id and o.player_id=mp.player_id;
  update public.matches set formation = match_formation, synced_at = now() where id = target_match_id;
end;
$$;

commit;
