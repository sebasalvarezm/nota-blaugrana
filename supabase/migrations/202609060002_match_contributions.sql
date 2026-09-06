begin;
alter table public.match_events add column if not exists period text not null default 'unknown'
  check (period in ('first', 'second', 'extra', 'shootout', 'unknown'));

update public.match_events set period = case
  when detail ~* 'shoot.?out' then 'shootout'
  when minute <= 45 then 'first'
  when minute <= 90 then 'second'
  when minute > 90 then 'extra'
  else 'unknown' end
where period = 'unknown';

create or replace function public.replace_fotmob_events(target_match_id uuid, event_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(event_rows) <> 'array' then raise exception 'Expected an event array'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 0));
  delete from public.match_events where match_id = target_match_id and event_key like 'fotmob:%';
  insert into public.match_events (match_id, event_key, minute, extra_minute, team_id, player_id, assist_player_id, type, detail, comments, period)
  select target_match_id, e.event_key, e.minute, e.extra_minute, e.team_id, e.player_id, e.assist_player_id, e.type, e.detail, e.comments, e.period
  from jsonb_to_recordset(event_rows) as e(event_key text, minute integer, extra_minute integer, team_id uuid, player_id uuid, assist_player_id uuid, type text, detail text, comments text, period text)
  where e.event_key like 'fotmob:%';
  update public.matches set provider_payload = provider_payload || jsonb_build_object('eventsSyncedAt', now()) where id = target_match_id;
end;
$$;
grant delete on public.match_events to service_role;
revoke all on function public.replace_fotmob_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_fotmob_events(uuid, jsonb) to service_role;
commit;
