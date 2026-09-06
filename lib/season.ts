import type { MatchData } from "@/lib/types";
import { formatRating } from "@/lib/ratings";
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
export function seasonComparison(score: number | null | undefined, baseline?: SeasonAverage): string {
  if (!baseline) return "No baseline";
  if (baseline.matches < 3) return `Limited history · ${baseline.matches}`;
  if (score == null) return `Season ${formatRating(baseline.average)}`;
  const difference = Math.round((score - baseline.average) * 10) / 10;
  return difference === 0 ? "= season avg" : `${difference > 0 ? "↑" : "↓"} ${Math.abs(difference).toFixed(1)} vs season`;
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
