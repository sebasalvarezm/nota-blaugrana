import type { MatchEvent, Phase } from "@/lib/types";

export type Contributions = { goals: number; assists: number };

export function eventPeriod(value: unknown, minute: number | null, extraMinute = 0): MatchEvent["period"] {
  const label = String(value ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (["1", "1h", "first", "firsthalf"].includes(label)) return "first";
  if (["2", "2h", "second", "secondhalf"].includes(label)) return "second";
  if (["3", "4", "et", "et1", "et2", "extratime"].includes(label)) return "extra";
  if (["5", "pen", "pens", "penalties", "shootout"].includes(label)) return "shootout";
  if (minute == null || !Number.isFinite(minute)) return "unknown";
  // Providers normally encode 45+2 as minute=45, extraMinute=2.
  if (minute <= 45) return "first";
  if (minute <= 90 || (minute === 90 && extraMinute > 0)) return "second";
  return "extra";
}

export function contributionsFor(events: MatchEvent[] | undefined, phase: Phase): Record<string, Contributions> {
  const totals: Record<string, Contributions> = {};
  const seen = new Set<string>();
  for (const event of events || []) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.type !== "goal" || event.period === "shootout") continue;
    if (/own\s*goal|owngoal|disallow|cancel|shoot.?out|miss/i.test(event.detail || "")) continue;
    if (phase === "ht" && event.period !== "first") continue;
    if (event.playerId) {
      totals[event.playerId] ||= { goals: 0, assists: 0 };
      totals[event.playerId].goals += 1;
    }
    if (event.assistPlayerId && event.assistPlayerId !== event.playerId) {
      totals[event.assistPlayerId] ||= { goals: 0, assists: 0 };
      totals[event.assistPlayerId].assists += 1;
    }
  }
  return totals;
}

export function contributionLabel(value?: Contributions): string {
  return [value?.goals ? `G ${value.goals}` : "", value?.assists ? `A ${value.assists}` : ""].filter(Boolean).join(" · ");
}
