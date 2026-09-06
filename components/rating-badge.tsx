import { formatRating, ratingBand, RATING_COLORS } from "@/lib/ratings";

export function RatingBadge({ value, large = false }: { value: number | null | undefined; large?: boolean }) {
  const band = ratingBand(value);
  const colors = RATING_COLORS[band];
  return <span className={`rating-badge ${large ? "rating-badge-large" : ""}`} data-band={band}
    style={{ backgroundColor: colors.background, color: colors.foreground }} aria-label={value == null ? "Not rated" : `${formatRating(value)} out of 10`}>
    {formatRating(value)}
  </span>;
}
