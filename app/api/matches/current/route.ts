import { NextRequest, NextResponse } from "next/server";
import { DEMO_MATCH } from "@/lib/demo-data";
import { getServerSupabase } from "@/lib/supabase/server";
import type { MatchData, Player, Role, Team } from "@/lib/types";
import { playerName, shortPlayerName } from "@/lib/player-names";
import { eventPeriod } from "@/lib/match-events";

export const dynamic = "force-dynamic";

type ClubRow = { id: string; provider_id: number | null; name: string; short_name: string; logo_url: string | null };
type CompetitionRow = { name: string };
type PlayerRow = { id: string; provider_id: number | null; name: string; photo_url: string | null };
type MatchPlayerRow = {
  player_id: string;
  squad_number: number | null;
  starter: boolean;
  played: boolean;
  minute_in: number | null;
  role_code: Role;
  role_label: string;
  pitch_x: number | string | null;
  pitch_y: number | string | null;
  player: PlayerRow | PlayerRow[] | null;
};
type MatchRow = {
  id: string;
  provider_id: number | null;
  kickoff_at: string;
  venue: string | null;
  status: string;
  status_short: string | null;
  home_score: number | null;
  away_score: number | null;
  halftime_home_score: number | null;
  halftime_away_score: number | null;
  provider_payload: { eventsSyncedAt?: string } | null;
  formation: string | null;
  synced_at: string | null;
  competition: CompetitionRow | CompetitionRow[] | null;
  home_team: ClubRow | ClubRow[] | null;
  away_team: ClubRow | ClubRow[] | null;
  match_players: MatchPlayerRow[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function teamFrom(row: ClubRow | null): Team {
  return row
    ? { id: row.id, providerId: row.provider_id, name: row.name, shortName: row.short_name, logoUrl: row.logo_url }
    : { name: "Unknown", shortName: "TBD" };
}

function normalizeMatch(row: MatchRow): MatchData {
  const timeZone = process.env.NEXT_PUBLIC_TIMEZONE || "America/New_York";
  const kickoff = new Date(row.kickoff_at);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short",
  }).format(kickoff);

  const players: Player[] = (row.match_players || []).map((entry) => {
    const player = one(entry.player);
    return {
      id: entry.player_id,
      providerId: player?.provider_id,
      name: playerName(player?.name) || "Unknown player",
      short: shortPlayerName(player?.name || "Unknown"),
      number: entry.squad_number,
      role: entry.role_code,
      roleLabel: entry.role_label,
      x: entry.pitch_x == null ? undefined : Number(entry.pitch_x),
      y: entry.pitch_y == null ? undefined : Number(entry.pitch_y),
      starter: entry.starter,
      played: entry.played,
      minute: entry.minute_in,
      photoUrl: player?.photo_url,
    };
  });

  return {
    id: row.id,
    providerId: row.provider_id,
    competition: one(row.competition)?.name || "Club match",
    date,
    kickoff: row.kickoff_at,
    venue: row.venue,
    status: row.status,
    statusShort: row.status_short || "NS",
    home: teamFrom(one(row.home_team)),
    away: teamFrom(one(row.away_team)),
    homeScore: row.home_score,
    awayScore: row.away_score,
    halftimeHomeScore: row.halftime_home_score,
    halftimeAwayScore: row.halftime_away_score,
    eventsAvailable: Boolean(row.provider_payload?.eventsSyncedAt),
    formation: row.formation || "Lineup pending",
    players,
    source: "cloud",
    lastSyncedAt: row.synced_at,
  };
}

const matchSelect = `
  id, provider_id, kickoff_at, venue, status, status_short, home_score, away_score, halftime_home_score, halftime_away_score, provider_payload, formation, synced_at,
  competition:competitions(name),
  home_team:clubs!matches_home_team_id_fkey(id, provider_id, name, short_name, logo_url),
  away_team:clubs!matches_away_team_id_fkey(id, provider_id, name, short_name, logo_url),
  match_players(player_id, squad_number, starter, played, minute_in, role_code, role_label, pitch_x, pitch_y,
    player:players(id, provider_id, name, photo_url))
`;

export async function GET(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ match: DEMO_MATCH, mode: "local" });

  const { data: barca } = await supabase.from("clubs").select("id").eq("provider_id", 529).maybeSingle();
  if (!barca) return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-empty" });

  const selectedId = request.nextUrl.searchParams.get("matchId");
  if (selectedId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedId)) return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  const { data: recent, error: recentError } = await supabase.from("matches")
    .select("id, kickoff_at, status, home_score, away_score, formation, home_team:clubs!matches_home_team_id_fkey(short_name), away_team:clubs!matches_away_team_id_fkey(short_name)")
    .or(`home_team_id.eq.${barca.id},away_team_id.eq.${barca.id}`)
    .lte("kickoff_at", new Date(Date.now() + 7 * 86400000).toISOString()).order("kickoff_at", { ascending: false }).limit(24);
  if (recentError) return NextResponse.json({ mode: "cloud-error" }, { status: 503 });
  const recentRows = recent || [];
  const active = recentRows.find((row) => ["live", "halftime"].includes(row.status));
  const imminent = recentRows.find((row) => row.status === "scheduled" && row.formation && Math.abs(new Date(row.kickoff_at).getTime() - Date.now()) < 2 * 3600000);
  const latest = recentRows.find((row) => row.status === "finished" && row.formation);
  const targetId = selectedId || active?.id || imminent?.id || latest?.id || recentRows.at(-1)?.id;
  if (!targetId) return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-empty" });
  const result = await supabase
    .from("matches")
    .select(matchSelect)
    .or(`home_team_id.eq.${barca.id},away_team_id.eq.${barca.id}`)
    .eq("id", targetId).maybeSingle();

  if (result.error) {
    return NextResponse.json({ mode: "cloud-error" }, { status: 503 });
  }
  if (!result.data) return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-empty" });

  const match = normalizeMatch(result.data as unknown as MatchRow);
  const { data: events, error: eventError } = await supabase.from("match_events")
    .select("event_key, player_id, assist_player_id, type, detail, minute, extra_minute, period").eq("match_id", match.id);
  match.events = (events || []).map((event) => ({
    id: event.event_key, playerId: event.player_id, assistPlayerId: event.assist_player_id,
    type: event.type, detail: event.detail, minute: event.minute, extraMinute: event.extra_minute,
    period: event.period === "unknown" ? eventPeriod(null, event.minute, event.extra_minute) : event.period,
  }));
  if (eventError) match.eventsAvailable = false;
  const matches = recentRows.map((row) => ({ id: row.id, label: `${new Date(row.kickoff_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · ${one(row.home_team)?.short_name || "Home"} ${row.home_score ?? "—"}–${row.away_score ?? "—"} ${one(row.away_team)?.short_name || "Away"}` }));
  return NextResponse.json({ match, matches, mode: "cloud" }, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
}
