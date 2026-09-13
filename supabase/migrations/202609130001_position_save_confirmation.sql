begin;
-- This migration follows 202609060006_owner_positions.sql.
grant select, insert, update on public.match_position_overrides to service_role;
grant select, update on public.match_players to service_role;

create or replace function public.save_match_positions_v2(target_match_id uuid, position_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  edit_row record;
  current_position public.match_players%rowtype;
  confirmation jsonb;
begin
  if jsonb_typeof(position_rows) is distinct from 'array' then
    raise exception 'Invalid positions' using errcode='22023';
  end if;
  if jsonb_array_length(position_rows) not between 1 and 30
    or (select count(distinct r->>'player_id') from jsonb_array_elements(position_rows) r) <> jsonb_array_length(position_rows) then
    raise exception 'Invalid or duplicate players' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text,0));
  for edit_row in select * from jsonb_to_recordset(position_rows) r(player_id uuid,role_code text,role_label text,pitch_x numeric,pitch_y numeric,expected jsonb) loop
    if edit_row.role_code is null or edit_row.role_code not in ('GK','CB','FB','PIVOT','MID','WING','ST')
      or edit_row.role_label is null or length(edit_row.role_label) not between 1 and 80
      or edit_row.pitch_x not between 0 and 100 or edit_row.pitch_y not between 0 and 100
      or jsonb_typeof(edit_row.expected) is distinct from 'object'
      or not (edit_row.expected ?& array['role_code','role_label','pitch_x','pitch_y']) then
      raise exception 'Invalid position' using errcode='22023';
    end if;
    select * into current_position from public.match_players where match_id=target_match_id and player_id=edit_row.player_id for update;
    if not found then raise exception 'Player left the lineup' using errcode='40001'; end if;
    -- A successful request whose response was lost can be retried unchanged.
    if current_position.role_code is not distinct from edit_row.role_code and current_position.role_label is not distinct from edit_row.role_label
      and current_position.pitch_x is not distinct from edit_row.pitch_x and current_position.pitch_y is not distinct from edit_row.pitch_y then
      continue;
    end if;
    if current_position.role_code is distinct from edit_row.expected->>'role_code'
      or current_position.role_label is distinct from edit_row.expected->>'role_label'
      or current_position.pitch_x is distinct from (edit_row.expected->>'pitch_x')::numeric
      or current_position.pitch_y is distinct from (edit_row.expected->>'pitch_y')::numeric then
      raise exception 'Edited player changed since editor opened' using errcode='40001';
    end if;
  end loop;

  -- Only edited players are written. A new substitute cannot invalidate the save,
  -- and untouched players do not acquire unnecessary permanent match overrides.
  insert into public.match_position_overrides(match_id,player_id,role_code,role_label,pitch_x,pitch_y)
  select target_match_id,p.player_id,p.role_code,p.role_label,p.pitch_x,p.pitch_y
  from jsonb_to_recordset(position_rows) p(player_id uuid,role_code text,role_label text,pitch_x numeric,pitch_y numeric)
  on conflict(match_id,player_id) do update set role_code=excluded.role_code,role_label=excluded.role_label,pitch_x=excluded.pitch_x,pitch_y=excluded.pitch_y;
  update public.match_players mp set role_code=p.role_code,role_label=p.role_label,pitch_x=p.pitch_x,pitch_y=p.pitch_y
  from jsonb_to_recordset(position_rows) p(player_id uuid,role_code text,role_label text,pitch_x numeric,pitch_y numeric)
  where mp.match_id=target_match_id and mp.player_id=p.player_id;
  select jsonb_agg(jsonb_build_object('player_id',mp.player_id,'role_code',mp.role_code,'role_label',mp.role_label,'pitch_x',mp.pitch_x,'pitch_y',mp.pitch_y))
  into confirmation from public.match_players mp
  where mp.match_id=target_match_id and mp.player_id in (select (r->>'player_id')::uuid from jsonb_array_elements(position_rows) r);
  return confirmation;
end;
$$;
revoke all on function public.save_match_positions_v2(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_match_positions_v2(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
