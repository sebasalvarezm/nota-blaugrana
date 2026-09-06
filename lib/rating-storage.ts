import type { MatchData, Phase, PlayerRating, RatingsState } from "@/lib/types";
import { emptyRatings, normalizeRatings } from "@/lib/ratings";

export type PendingRating = { phase: Phase; playerId: string; rating: PlayerRating | null; expectedUpdatedAt: string | null; revision: number };
export type StoredRatings = {
  version: 3; scale: 10; ratings: RatingsState; pending: Record<string, PendingRating>;
  match: Pick<MatchData, "id" | "kickoff" | "status" | "source">;
};
export const ratingKey = (scope: string, matchId: string) => `nota-blaugrana-ratings-v3:${scope}:${matchId}`;
export const pendingKey = (phase: Phase, playerId: string) => `${phase}:${playerId}`;

export function readStoredRatings(raw: string | null): { ratings: RatingsState; pending: Record<string, PendingRating> } {
  if (!raw) return { ratings: emptyRatings(), pending: {} };
  const data = JSON.parse(raw) as StoredRatings;
  if (data.version !== 3 || data.scale !== 10) throw new Error("Unrecognised rating storage version");
  const ratings = normalizeRatings(data.ratings, 10);
  const pending: Record<string, PendingRating> = {};
  for (const [key, value] of Object.entries(data.pending || {})) {
    if (!value || !["ht", "ft"].includes(value.phase) || typeof value.playerId !== "string" || key !== pendingKey(value.phase, value.playerId)) continue;
    const rating = value.rating === null ? null : normalizeRatings({ [value.phase]: { [value.playerId]: value.rating } }, 10)[value.phase][value.playerId];
    if (rating !== undefined) pending[key] = { ...value, rating, revision: Number.isSafeInteger(value.revision) ? value.revision : 0, expectedUpdatedAt: typeof value.expectedUpdatedAt === "string" ? value.expectedUpdatedAt : null };
  }
  return { ratings, pending };
}

export function mergeAccountRatings(local: RatingsState, remote: RatingsState, pending: Record<string, PendingRating>): RatingsState {
  const merged = emptyRatings();
  for (const phase of ["ht", "ft"] as Phase[]) {
    merged[phase] = { ...remote[phase] };
    for (const item of Object.values(pending).filter((item) => item.phase === phase)) {
      if (item.rating) merged[phase][item.playerId] = local[phase][item.playerId] || item.rating;
      else delete merged[phase][item.playerId];
    }
  }
  return merged;
}
