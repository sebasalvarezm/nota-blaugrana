import { NextResponse } from "next/server";
import { DEMO_MATCH } from "@/lib/demo-data";
import { getServerSupabase } from "@/lib/supabase/server";
import type { MatchData, Player, Role, Team } from "@/lib/types";

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
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone,
  }).format(kickoff);

  const players: Player[] = (row.match_players || []).map((entry) => {
    const player = one(entry.player);
    return {
      id: entry.player_id,
      providerId: player?.provider_id,
      name: player?.name || "Unknown player",
      short: (player?.name || "Unknown").split(" ").slice(-1)[0],
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
    formation: row.formation || "Lineup pending",
    players,
    source: "cloud",
    lastSyncedAt: row.synced_at,
  };
}

const matchSelect = `
  id, provider_id, kickoff_at, venue, status, status_short, home_score, away_score, formation, synced_at,
  competition:competitions(name),
  home_team:clubs!matches_home_team_id_fkey(id, provider_id, name, short_name, logo_url),
  away_team:clubs!matches_away_team_id_fkey(id, provider_id, name, short_name, logo_url),
  match_players(player_id, squad_number, starter, played, minute_in, role_code, role_label, pitch_x, pitch_y,
    player:players(id, provider_id, name, photo_url))
`;

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ match: DEMO_MATCH, mode: "local" });

  const { data: barca } = await supabase.from("clubs").select("id").eq("provider_id", 529).maybeSingle();
  if (!barca) return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-empty" });

  const recentCutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const query = supabase
    .from("matches")
    .select(matchSelect)
    .or(`home_team_id.eq.${barca.id},away_team_id.eq.${barca.id}`)
    .gte("kickoff_at", recentCutoff)
    .order("kickoff_at", { ascending: true })
    .limit(1);

  let result = await query.maybeSingle();
  if (!result.data && !result.error) {
    result = await supabase
      .from("matches")
      .select(matchSelect)
      .or(`home_team_id.eq.${barca.id},away_team_id.eq.${barca.id}`)
      .order("kickoff_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  if (result.error) {
    return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-error", error: result.error.message }, { status: 200 });
  }
  if (!result.data) return NextResponse.json({ match: DEMO_MATCH, mode: "cloud-empty" });

  return NextResponse.json({ match: normalizeMatch(result.data as unknown as MatchRow), mode: "cloud" });
}
