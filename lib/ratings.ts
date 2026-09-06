import type { Phase, PlayerRating, RatingsState } from "@/lib/types";

export const RATING_SCALE = 10;
export const STORAGE_VERSION = 3;
export const RATING_VALUES = Array.from({ length: 10 }, (_, index) => index + 1);

export function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10 && Number.isInteger(value * 2);
}

export function formatRating(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function emptyRatings(): RatingsState { return { ht: {}, ft: {} }; }

export function normalizeRatings(value: unknown, scale: 5 | 10): RatingsState {
  const result = emptyRatings();
  if (!value || typeof value !== "object") return result;
  for (const phase of ["ht", "ft"] as Phase[]) {
    const entries = (value as Partial<RatingsState>)[phase];
    if (!entries || typeof entries !== "object") continue;
    for (const [id, rating] of Object.entries(entries)) {
      if (!rating || typeof rating !== "object") continue;
      const convert = (score: unknown) => {
        if (typeof score !== "number" || (scale === 5 && (score < 1 || score > 5 || !Number.isInteger(score)))) return null;
        const converted = scale === 5 ? score * 2 : score;
        return validScore(converted) ? converted : null;
      };
      const attributes = Object.fromEntries(Object.entries(rating.attributes || {})
        .map(([key, score]) => [key, convert(score)]));
      result[phase][id] = {
        overall: convert(rating.overall), attributes,
        ...(scale === 5 || rating.convertedFromFive ? { convertedFromFive: true } : {}),
        ...(typeof rating.updatedAt === "string" ? { updatedAt: rating.updatedAt } : {}),
      };
    }
  }
  return result;
}

export function ratingDescription(value: number | null | undefined): string {
  if (value == null) return "Not rated";
  if (value >= 9.5) return "Outstanding";
  if (value >= 8.5) return "Excellent";
  if (value >= 7) return "Good";
  if (value >= 6) return "Steady";
  if (value >= 4) return "Below par";
  return "Difficult match";
}

export function isRated(rating?: PlayerRating): boolean { return validScore(rating?.overall); }

export function averageRating(ratings: Array<number | null | undefined>): number | null {
  const values = ratings.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, score) => sum + score, 0) / values.length : null;
}

export type RatingBand = "unrated" | "poor" | "steady" | "good" | "excellent";
export function ratingBand(value: number | null | undefined): RatingBand {
  if (value == null || !Number.isFinite(value)) return "unrated";
  // Classify the displayed precision, so a visible 8.5 always uses the blue badge.
  const score = Math.round((value + Number.EPSILON) * 10) / 10;
  return score >= 8.5 ? "excellent" : score >= 7 ? "good" : score >= 6 ? "steady" : "poor";
}

export const RATING_COLORS: Record<RatingBand, { background: string; foreground: string }> = {
  unrated: { background: "#e0e5eb", foreground: "#475668" },
  poor: { background: "#f9dfe4", foreground: "#9e2538" },
  steady: { background: "#f6e8c9", foreground: "#805000" },
  good: { background: "#dceee1", foreground: "#14613b" },
  excellent: { background: "#dbeaff", foreground: "#1555b5" },
};
