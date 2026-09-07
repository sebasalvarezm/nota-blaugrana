export type MvpCandidate = { id: string; name: string; score: number };

// Preferences break ties only: a lower score must never displace a higher one.
export function selectMvpIds(candidates: MvpCandidate[], preferred: string[] = []): string[] {
  const priority = (id: string) => { const index = preferred.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return [...candidates].filter(row => Number.isFinite(row.score))
    .sort((a,b) => b.score-a.score || priority(a.id)-priority(b.id) || a.name.localeCompare(b.name))
    .slice(0,3).map(row=>row.id);
}

export function replaceMvp(ids: string[], slot: number, playerId: string): string[] {
  const next = [...ids];
  const previousSlot = next.indexOf(playerId);
  if (previousSlot >= 0) next[previousSlot] = next[slot];
  next[slot] = playerId;
  return next;
}
