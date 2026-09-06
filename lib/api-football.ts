import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";

const API_BASE = "https://v3.football.api-sports.io";

type ApiTeam = { id: number; name: string; logo?: string; winner?: boolean | null };
type ApiPlayer = { id: number; name: string; number: number | null; pos: string | null; grid: string | null };
type ApiFixture = {
  fixture: {
    id: number;
    date: string;
    timezone: string;
    venue?: { name?: string | null };
    status: { long: string; short: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string; logo?: string; season: number };
  teams: { home: ApiTeam; away: ApiTeam };
  goals: { home: number | null; away: number | null };
  score: { halftime?: { home: number | null; away: number | null } };
};
type ApiLineup = {
  team: ApiTeam;
  formation: string | null;
  startXI: Array<{ player: ApiPlayer }>;
  substitutes: Array<{ player: ApiPlayer }>;
};
type ApiEvent = {
  time: { elapsed: number | null; extra: number | null };
  team: ApiTeam;
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments: string | null;
};
type ApiEnvelope<T> = {
  response: T[];
  errors: Record<string, string> | string[];
  results: number;
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function apiFootball<T>(path: string, params: Record<string, string | number>) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

  const url = new URL(`${API_BASE}/${path}`);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  const response = await fetch(url, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`API-Football returned ${response.status}`);

  const payload = (await response.json()) as ApiEnvelope<T>;
  const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors || {});
  if (errors.length) throw new Error(`API-Football: ${errors.join(", ")}`);
  return payload.response;
}

function normalizeStatus(short: string) {
  if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return "live";
  if (short === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["PST", "SUSP", "INT"].includes(short)) return "postponed";
  if (["CANC", "ABD", "AWD", "WO"].includes(short)) return "cancelled";
  return "scheduled";
}

function shortClubName(name: string) {
  if (name === "FC Barcelona") return "BAR";
  const words = name.replace(/\b(FC|CF|Club|Football)\b/gi, "").trim().split(/\s+/);
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase() || name.slice(0, 3).toUpperCase();
}

function parseGrid(grid: string | null) {
  if (!grid) return null;
  const [row, column] = grid.split(":").map(Number);
  return Number.isFinite(row) && Number.isFinite(column) ? { row, column } : null;
}

function inferRole(position: string | null, grid: string | null, rowSize: number): { code: Role; label: string } {
  const parsed = parseGrid(grid);
  if (position === "G") return { code: "GK", label: "Sweeper goalkeeper" };
  if (position === "D") {
    const isOutside = parsed && rowSize >= 4 && (parsed.column === 1 || parsed.column === rowSize);
    return isOutside ? { code: "FB", label: "Full-back" } : { code: "CB", label: "Centre-back" };
  }
  if (position === "M") {
    const isCentralPivot = parsed && rowSize === 3 && parsed.column === 2;
    return isCentralPivot ? { code: "PIVOT", label: "Pivot" } : { code: "MID", label: "Interior midfielder" };
  }
  if (position === "F") {
    const isWide = parsed && rowSize >= 3 && (parsed.column === 1 || parsed.column === rowSize);
    return isWide ? { code: "WING", label: "Winger" } : { code: "ST", label: "Striker" };
  }
  return { code: "MID", label: "Midfielder" };
}

async function upsertClub(supabase: SupabaseClient, team: ApiTeam) {
  const { data, error } = await supabase
    .from("clubs")
    .upsert({ provider_id: team.id, name: team.name, short_name: shortClubName(team.name), logo_url: team.logo || null }, { onConflict: "provider_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function upsertPlayer(supabase: SupabaseClient, player: { id: number; name: string }, position?: string | null) {
  const { data, error } = await supabase
    .from("players")
    .upsert({
      provider_id: player.id,
      name: player.name,
      photo_url: `https://media.api-sports.io/football/players/${player.id}.png`,
      default_position: position || null,
    }, { onConflict: "provider_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function upsertFixture(supabase: SupabaseClient, fixture: ApiFixture) {
  const [homeTeamId, awayTeamId] = await Promise.all([
    upsertClub(supabase, fixture.teams.home),
    upsertClub(supabase, fixture.teams.away),
  ]);
  const { data: competition, error: competitionError } = await supabase
    .from("competitions")
    .upsert({
      provider_id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.league.country,
      logo_url: fixture.league.logo || null,
      season: fixture.league.season,
    }, { onConflict: "provider_id,season" })
    .select("id")
    .single();
  if (competitionError) throw competitionError;

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .upsert({
      provider_id: fixture.fixture.id,
      competition_id: competition.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      kickoff_at: fixture.fixture.date,
      venue: fixture.fixture.venue?.name || null,
      timezone: fixture.fixture.timezone,
      status: normalizeStatus(fixture.fixture.status.short),
      status_short: fixture.fixture.status.short,
      elapsed: fixture.fixture.status.elapsed,
      home_score: fixture.goals.home,
      away_score: fixture.goals.away,
      halftime_home_score: fixture.score.halftime?.home ?? null,
      halftime_away_score: fixture.score.halftime?.away ?? null,
      provider_payload: fixture,
      provider_updated_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }, { onConflict: "provider_id" })
    .select("id, home_team_id, away_team_id")
    .single();
  if (matchError) throw matchError;
  return match as { id: string; home_team_id: string; away_team_id: string };
}

async function importLineupAndEvents(supabase: SupabaseClient, fixture: ApiFixture, matchId: string, barcaTeamId: string) {
  const [lineups, events] = await Promise.all([
    apiFootball<ApiLineup>("fixtures/lineups", { fixture: fixture.fixture.id }),
    apiFootball<ApiEvent>("fixtures/events", { fixture: fixture.fixture.id }),
  ]);
  const barcaLineup = lineups.find((lineup) => lineup.team.id === Number(process.env.API_FOOTBALL_TEAM_ID || 529));

  const substitutionEvents = events.filter((event) => event.team.id === Number(process.env.API_FOOTBALL_TEAM_ID || 529) && event.type === "subst");
  const incomingMinute = new Map<number, number>();
  const outgoingMinute = new Map<number, number>();
  substitutionEvents.forEach((event) => {
    if (event.assist.id) incomingMinute.set(event.assist.id, event.time.elapsed || 0);
    if (event.player.id) outgoingMinute.set(event.player.id, event.time.elapsed || 0);
  });

  if (barcaLineup) {
    const starters = barcaLineup.startXI.map((entry) => entry.player);
    const rowSizes = new Map<number, number>();
    starters.forEach((player) => {
      const grid = parseGrid(player.grid);
      if (grid) rowSizes.set(grid.row, Math.max(rowSizes.get(grid.row) || 0, grid.column));
    });

    const importPlayer = async (player: ApiPlayer, starter: boolean) => {
      const playerId = await upsertPlayer(supabase, player, player.pos);
      const grid = parseGrid(player.grid);
      const rowSize = grid ? rowSizes.get(grid.row) || 1 : 1;
      const role = inferRole(player.pos, player.grid, rowSize);
      const pitchX = grid ? Number(((grid.column / (rowSize + 1)) * 100).toFixed(2)) : null;
      const pitchY = grid ? Math.max(17, 90 - (grid.row - 1) * 22) : null;
      const minuteIn = incomingMinute.get(player.id) ?? (starter ? 0 : null);
      const minuteOut = outgoingMinute.get(player.id) ?? null;
      const { error } = await supabase.from("match_players").upsert({
        match_id: matchId,
        player_id: playerId,
        team_id: barcaTeamId,
        squad_number: player.number,
        starter,
        played: starter || incomingMinute.has(player.id),
        minute_in: minuteIn,
        minute_out: minuteOut,
        provider_position: player.pos,
        role_code: role.code,
        role_label: role.label,
        grid: player.grid,
        pitch_x: pitchX,
        pitch_y: pitchY,
      }, { onConflict: "match_id,player_id" });
      if (error) throw error;
    };

    for (const entry of barcaLineup.startXI) await importPlayer(entry.player, true);
    for (const entry of barcaLineup.substitutes) await importPlayer(entry.player, false);

    const { error } = await supabase
      .from("matches")
      .update({ formation: barcaLineup.formation, synced_at: new Date().toISOString() })
      .eq("id", matchId);
    if (error) throw error;
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const teamId = event.team.id === fixture.teams.home.id
      ? (event.team.id === Number(process.env.API_FOOTBALL_TEAM_ID || 529) ? barcaTeamId : await upsertClub(supabase, event.team))
      : (event.team.id === Number(process.env.API_FOOTBALL_TEAM_ID || 529) ? barcaTeamId : await upsertClub(supabase, event.team));
    const playerId = event.player.id && event.player.name ? await upsertPlayer(supabase, { id: event.player.id, name: event.player.name }) : null;
    const assistPlayerId = event.assist.id && event.assist.name ? await upsertPlayer(supabase, { id: event.assist.id, name: event.assist.name }) : null;
    const eventKey = [event.time.elapsed || 0, event.time.extra || 0, event.team.id, event.type, event.detail, event.player.id || 0, index].join(":");
    const { error } = await supabase.from("match_events").upsert({
      match_id: matchId,
      event_key: eventKey,
      minute: event.time.elapsed,
      extra_minute: event.time.extra,
      team_id: teamId,
      player_id: playerId,
      assist_player_id: assistPlayerId,
      type: event.type,
      detail: event.detail,
      comments: event.comments,
    }, { onConflict: "match_id,event_key" });
    if (error) throw error;
  }

  return { lineupFound: Boolean(barcaLineup), eventCount: events.length };
}

export async function syncBarcelona(supabase: SupabaseClient) {
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
  const teamId = Number(process.env.API_FOOTBALL_TEAM_ID || 529);
  const timezone = process.env.NEXT_PUBLIC_TIMEZONE || "America/New_York";
  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const fixtures = await apiFootball<ApiFixture>("fixtures", {
    team: teamId,
    season,
    from: dateOnly(from),
    to: dateOnly(to),
    timezone,
  });

  const imported = new Map<number, { matchId: string; barcaTeamId: string }>();
  for (const fixture of fixtures) {
    const match = await upsertFixture(supabase, fixture);
    const barcaTeamId = fixture.teams.home.id === teamId ? match.home_team_id : match.away_team_id;
    imported.set(fixture.fixture.id, { matchId: match.id, barcaTeamId });
  }

  const candidates = fixtures
    .filter((fixture) => Math.abs(new Date(fixture.fixture.date).getTime() - now.getTime()) <= 36 * 60 * 60 * 1000)
    .sort((a, b) => Math.abs(new Date(a.fixture.date).getTime() - now.getTime()) - Math.abs(new Date(b.fixture.date).getTime() - now.getTime()));
  const target = candidates[0];
  let detail = { lineupFound: false, eventCount: 0 };
  if (target) {
    const saved = imported.get(target.fixture.id);
    if (saved) detail = await importLineupAndEvents(supabase, target, saved.matchId, saved.barcaTeamId);
  }

  return {
    fixtureCount: fixtures.length,
    detailedFixtureId: target?.fixture.id || null,
    ...detail,
    requestEstimate: target ? 3 : 1,
  };
}
