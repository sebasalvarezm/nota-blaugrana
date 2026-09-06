-- Safe to run again. Preserve player IDs and every existing rating.
begin;
update public.players
set name = btrim(regexp_replace(name, '^\s*(assist(ed)?\s+by\s*:?|assist\s*:)\s*', '', 'i'))
where name ~* '^\s*(assist(ed)?\s+by\s*:?|assist\s*:)\s*\S'
  and length(btrim(regexp_replace(name, '^\s*(assist(ed)?\s+by\s*:?|assist\s*:)\s*', '', 'i'))) > 0;
commit;
