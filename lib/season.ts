import type { MatchData, PhaseRatings } from "@/lib/types";
import { formatRating, validScore } from "@/lib/ratings";
import { readStoredRatings, type StoredRatings } from "@/lib/rating-storage";

export type SeasonAverage = { average: number; matches: number; includesConverted: boolean };
export function seasonStart(kickoff: string): number {
  const date = new Date(kickoff);
  return Date.UTC(date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0), 6, 1);
}
export function seasonLabel(kickoff: string): string {
  const year = new Date(seasonStart(kickoff)).getUTCFullYear();
  return `${year}/${String(year + 1).slice(-2)}`;
}
export function seasonComparison(_score: number | null | undefined, baseline?: SeasonAverage): string {
  if (!baseline || baseline.matches < 1 || !Number.isFinite(baseline.average)) return "";
  return `Season avg ${formatRating(baseline.average)}`;
}

export function includeCurrentMatch(previous: Record<string, SeasonAverage>, match: MatchData, ratings: PhaseRatings): Record<string, SeasonAverage> {
  const result = { ...previous };
  if (match.source !== "cloud" || match.status !== "finished") return result;
  // Both history loaders exclude this match. Add its latest local FT value once,
  // including an edit still waiting to sync. HT ratings never become extra votes.
  for (const player of match.players) {
    const rating = ratings[player.id];
    if (!validScore(rating?.overall)) continue;
    const history = previous[player.id];
    const count = history?.matches || 0;
    result[player.id] = { average: ((history?.average || 0) * count + rating.overall) / (count + 1), matches: count + 1,
      includesConverted: Boolean(history?.includesConverted || rating.convertedFromFive) };
  }
  return result;
}
export function localSeasonAverages(storage: Pick<Storage, "length" | "key" | "getItem">, scope: string, match: MatchData): Record<string, SeasonAverage> {
  if (match.source !== "cloud") return {};
  const totals: Record<string, { total: number; count: number; converted: boolean }> = {};
  const prefix = `nota-blaugrana-ratings-v3:${scope}:`;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix) || key.includes(":backup:")) continue;
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as StoredRatings;
      const kickoff = new Date(data.match?.kickoff).getTime();
      if (data.match?.source !== "cloud" || data.match.status !== "finished" || data.match.id === match.id
        || !Number.isFinite(kickoff) || kickoff < seasonStart(match.kickoff) || kickoff >= new Date(match.kickoff).getTime()) continue;
      for (const [playerId, rating] of Object.entries(readStoredRatings(raw).ratings.ft)) {
        if (rating.overall == null) continue;
        totals[playerId] ||= { total: 0, count: 0, converted: false };
        totals[playerId].total += rating.overall;
        totals[playerId].count += 1;
        totals[playerId].converted ||= Boolean(rating.convertedFromFive);
      }
    } catch { /* An unreadable record must not invalidate the rest of the history. */ }
  }
  return Object.fromEntries(Object.entries(totals).map(([id, row]) => [id, { average: row.total / row.count, matches: row.count, includesConverted: row.converted }]));
}
