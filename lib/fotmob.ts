import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";
import { playerName } from "@/lib/player-names";

const FOTMOB_BASE = "https://www.fotmob.com";
const FOTMOB_TEAM_ID = Number(process.env.FOTMOB_TEAM_ID || 8634);
const BARCELONA_PROVIDER_ID = 529;

type FotmobStatus = {
  utcTime: string;
  timezone?: string;
  started?: boolean;
  finished?: boolean;
  cancelled?: boolean;
  scoreStr?: string;
  reason?: { short?: string; long?: string };
};

type FotmobTeam = { id: number; name: string; score?: number };

type FotmobFixture = {
  id: number;
  pageUrl: string;
  home: FotmobTeam;
  away: FotmobTeam;
  notStarted?: boolean;
  tournament: { name: string; stage?: string; leagueId: number };
  status: FotmobStatus;
};

type FotmobTeamPage = {
  details?: { id: number; name: string; latestSeason?: string; country?: string };
  fixtures?: { allFixtures?: { fixtures?: FotmobFixture[] } };
};

type FotmobLayout = { x: number; y: number; height?: number; width?: number };
type FotmobSubEvent = { time?: number; type: "subIn" | "subOut" | string };

type FotmobPlayer = {
  id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  shirtNumber?: string | number | null;
  positionId?: number;
  usualPlayingPositionId?: number;
  verticalLayout?: FotmobLayout;
  performance?: { substitutionEvents?: FotmobSubEvent[] };
};

type FotmobLineupTeam = {
  id: number;
  name: string;
  formation?: string;
  starters?: FotmobPlayer[];
  subs?: FotmobPlayer[];
};

type FotmobEventPlayer = { id?: number | string | null; name?: string; profileUrl?: string };
type FotmobEvent = {
  reactKey?: string;
  eventId?: number;
  type: string;
  time?: number;
  overloadTime?: number | null;
  isHome?: boolean;
  player?: FotmobEventPlayer;
  playerId?: number;
  fullName?: string;
  swap?: FotmobEventPlayer[];
  card?: string;
  cardDescription?: string | null;
  goalDescription?: string | null;
  assistPlayerId?: number;
  assistStr?: string | null;
};

type FotmobMatchPage = {
  general?: {
    matchId?: string;
    leagueId?: number;
    parentLeagueId?: number;
    leagueName?: string;
    countryCode?: string;
    matchTimeUTCDate?: string;
    started?: boolean;
    finished?: boolean;
    homeTeam?: FotmobTeam;
    awayTeam?: FotmobTeam;
  };
  header?: {
    teams?: FotmobTeam[];
    status?: FotmobStatus;
  };
  content?: {
    lineup?: { homeTeam?: FotmobLineupTeam; awayTeam?: FotmobLineupTeam };
    matchFacts?: {
      events?: { events?: FotmobEvent[] };
      infoBox?: { Stadium?: { name?: string } };
    };
  };
};

type NextData = {
  props?: {
    pageProps?: {
      fallback?: Record<string, unknown>;
      general?: FotmobMatchPage["general"];
      header?: FotmobMatchPage["header"];
      content?: FotmobMatchPage["content"];
    };
  };
};

function namespacedId(namespace: "club" | "competition" | "player" | "match", id: number) {
  const offsets = { club: 10_000_000, competition: 20_000_000, player: 30_000_000, match: 40_000_000 };
  return -(offsets[namespace] + id);
}

function canonicalClubId(id: number) {
  return id === FOTMOB_TEAM_ID ? BARCELONA_PROVIDER_ID : namespacedId("club", id);
}

function shortClubName(name: string) {
  if (/barcelona/i.test(name)) return "BAR";
  const words = name.replace(/\b(FC|CF|Club|Football|City)\b/gi, "").trim().split(/\s+/).filter(Boolean);
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase() || name.slice(0, 3).toUpperCase();
}

function displayClubName(team: FotmobTeam) {
  return team.id === FOTMOB_TEAM_ID ? "FC Barcelona" : team.name;
}

function clubLogo(id: number) {
  return id === FOTMOB_TEAM_ID
    ? "https://media.api-sports.io/football/teams/529.png"
    : `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

async function fetchNextData(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; NotaBlaugrana/1.0; personal project)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Free match feed returned ${response.status}`);
  const html = await response.text();
  const anchor = html.indexOf('id="__NEXT_DATA__"');
  const start = anchor >= 0 ? html.indexOf(">", anchor) + 1 : -1;
  const end = start > 0 ? html.indexOf("</script>", start) : -1;
  if (anchor < 0 || start <= 0 || end <= start) throw new Error("Free match feed format changed");
  return JSON.parse(html.slice(start, end)) as NextData;
}

function findTeamPage(data: NextData) {
  const fallback = data.props?.pageProps?.fallback || {};
  const exact = fallback[`team-${FOTMOB_TEAM_ID}`] as FotmobTeamPage | undefined;
  if (exact?.fixtures) return exact;
  return Object.values(fallback).find((value) => {
    const candidate = value as FotmobTeamPage;
    return candidate?.details?.id === FOTMOB_TEAM_ID && Boolean(candidate.fixtures);
  }) as FotmobTeamPage | undefined;
}

function parseMatchPage(data: NextData): FotmobMatchPage {
  const props = data.props?.pageProps || {};
  return { general: props.general, header: props.header, content: props.content };
}

function normalizedStatus(status: FotmobStatus) {
  const short = (status.reason?.short || "").toUpperCase();
  if (status.cancelled) return "cancelled";
  if (status.finished) return "finished";
  if (short === "HT") return "halftime";
  if (status.started) return "live";
  return "scheduled";
}

function statusShort(status: FotmobStatus) {
  const short = status.reason?.short?.toUpperCase();
  if (short === "PEN") return "PEN";
  if (short === "PEN.") return "PEN";
  if (short === "PENALTIES" || short === "PENALTY") return "PEN";
  if (short === "PEN" || short === "FT" || short === "HT") return short;
  if (status.finished && short === "PEN") return "PEN";
  if (status.finished && status.reason?.short?.toLowerCase() === "pen") return "PEN";
  if (status.finished) return "FT";
  if (status.started) return short || "LIVE";
  if (status.cancelled) return "CANC";
  return "NS";
}

function scoreFromFixture(fixture: FotmobFixture) {
  if (!fixture.status.started && !fixture.status.finished) return { home: null, away: null };
  const match = fixture.status.scoreStr?.match(/(\d+)\s*-\s*(\d+)/);
  if (match) return { home: Number(match[1]), away: Number(match[2]) };
  return { home: fixture.home.score ?? null, away: fixture.away.score ?? null };
}

function seasonFromLabel(label: string | undefined, kickoff: string) {
  const parsed = Number(label?.match(/^\d{4}/)?.[0]);
  if (Number.isFinite(parsed) && parsed > 1900) return parsed;
  const date = new Date(kickoff);
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

async function upsertClub(supabase: SupabaseClient, team: FotmobTeam) {
  const name = displayClubName(team);
  const { data, error } = await supabase
    .from("clubs")
    .upsert({
      provider_id: canonicalClubId(team.id),
      name,
      short_name: shortClubName(name),
      logo_url: clubLogo(team.id),
    }, { onConflict: "provider_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function upsertPlayer(supabase: SupabaseClient, player: FotmobEventPlayer | FotmobPlayer, position?: number, authoritative = true) {
  const rawId = Number(player.id);
  if (!Number.isSafeInteger(rawId) || rawId <= 0) return null;
  const providerId = namespacedId("player", rawId);
  if (!authoritative) {
    const { data: existing, error } = await supabase.from("players")
      .select("id").eq("provider_id", providerId).maybeSingle();
    if (error) throw error;
    // Lineups own names and positions. Events only resolve the same stable ID.
    if (existing) return existing.id as string;
  }
  const name = playerName(player.name);
  if (!name) return null;
  const { data, error } = await supabase
    .from("players")
    .upsert({
      provider_id: providerId,
      name,
      photo_url: `https://images.fotmob.com/image_resources/playerimages/${rawId}.png`,
      ...(position == null ? {} : { default_position: String(position) }),
    }, { onConflict: "provider_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function upsertFixture(supabase: SupabaseClient, fixture: FotmobFixture, seasonLabel?: string) {
  const [homeTeamId, awayTeamId] = await Promise.all([
    upsertClub(supabase, fixture.home),
    upsertClub(supabase, fixture.away),
  ]);
  const season = seasonFromLabel(seasonLabel, fixture.status.utcTime);
  const { data: competition, error: competitionError } = await supabase
    .from("competitions")
    .upsert({
      provider_id: namespacedId("competition", fixture.tournament.leagueId),
      name: fixture.tournament.name,
      country: fixture.tournament.leagueId === 87 ? "Spain" : null,
      season,
    }, { onConflict: "provider_id,season" })
    .select("id")
    .single();
  if (competitionError) throw competitionError;

  const score = scoreFromFixture(fixture);
  const now = new Date().toISOString();
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .upsert({
      provider_id: namespacedId("match", fixture.id),
      competition_id: competition.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      kickoff_at: fixture.status.utcTime,
      timezone: fixture.status.timezone || "UTC",
      status: normalizedStatus(fixture.status),
      status_short: statusShort(fixture.status),
      home_score: score.home,
      away_score: score.away,
      provider_payload: { source: "fotmob-public-page", fixture, pageUrl: fixture.pageUrl },
      provider_updated_at: now,
      synced_at: now,
    }, { onConflict: "provider_id" })
    .select("id, home_team_id, away_team_id")
    .single();
  if (matchError) throw matchError;
  return match as { id: string; home_team_id: string; away_team_id: string };
}

function substitutionMinute(player: FotmobPlayer, type: "subIn" | "subOut") {
  return player.performance?.substitutionEvents?.find((event) => event.type === type)?.time ?? null;
}

function inferRole(player: FotmobPlayer, starters: FotmobPlayer[]): { code: Role; label: string } {
  const position = player.usualPlayingPositionId;
  const x = player.verticalLayout?.x ?? 0.5;
  const y = player.verticalLayout?.y ?? 0.5;
  if (position === 0) return { code: "GK", label: "Sweeper goalkeeper" };
  if (position === 1) {
    return x < 0.25 || x > 0.75
      ? { code: "FB", label: "Full-back" }
      : { code: "CB", label: "Centre-back" };
  }
  if (position === 3 || (position === 2 && y > 0.78)) {
    return x < 0.35 || x > 0.65
      ? { code: "WING", label: "Winger" }
      : { code: "ST", label: "Striker" };
  }
  if (position === 2) {
    const sameLine = starters.filter((entry) => {
      const entryY = entry.verticalLayout?.y;
      return entry.usualPlayingPositionId === 2 && entryY != null && Math.abs(entryY - y) < 0.045;
    });
    const isPivot = y < 0.56 || (sameLine.length === 3 && Math.abs(x - 0.5) < 0.13);
    return isPivot ? { code: "PIVOT", label: "Pivot" } : { code: "MID", label: "Interior midfielder" };
  }
  return { code: "MID", label: "Midfielder" };
}

async function importLineup(
  supabase: SupabaseClient,
  matchId: string,
  barcaTeamId: string,
  lineup: FotmobLineupTeam | undefined,
) {
  const starters = lineup?.starters || [];
  if (starters.length < 11) return false;

  const { error: clearError } = await supabase.from("match_players").delete().eq("match_id", matchId);
  if (clearError) throw clearError;

  const savePlayer = async (player: FotmobPlayer, starter: boolean) => {
    const playerId = await upsertPlayer(supabase, player, player.usualPlayingPositionId);
    if (!playerId) return;
    const role = inferRole(player, starters);
    const minuteIn = starter ? 0 : substitutionMinute(player, "subIn");
    const minuteOut = substitutionMinute(player, "subOut");
    const layout = player.verticalLayout;
    const pitchX = layout ? Math.max(7, Math.min(93, Number((layout.x * 100).toFixed(2)))) : null;
    const pitchY = layout ? Math.max(9, Math.min(91, Number(((1 - layout.y) * 100).toFixed(2)))) : null;
    const { error } = await supabase.from("match_players").upsert({
      match_id: matchId,
      player_id: playerId,
      team_id: barcaTeamId,
      squad_number: player.shirtNumber == null ? null : Number(player.shirtNumber),
      starter,
      played: starter || minuteIn != null,
      minute_in: minuteIn,
      minute_out: minuteOut,
      provider_position: player.positionId == null ? String(player.usualPlayingPositionId ?? "") : String(player.positionId),
      role_code: role.code,
      role_label: role.label,
      grid: layout ? `${Math.round(layout.y * 100)}:${Math.round(layout.x * 100)}` : null,
      pitch_x: pitchX,
      pitch_y: pitchY,
    }, { onConflict: "match_id,player_id" });
    if (error) throw error;
  };

  for (const player of starters) await savePlayer(player, true);
  for (const player of lineup?.subs || []) await savePlayer(player, false);

  const { error } = await supabase
    .from("matches")
    .update({ formation: lineup?.formation || null, synced_at: new Date().toISOString() })
    .eq("id", matchId);
  if (error) throw error;
  return true;
}

function eventPeople(event: FotmobEvent) {
  if (event.type === "Substitution" && event.swap?.length) {
    return { player: event.swap[0], assist: event.swap[1] };
  }
  const player = event.player?.name
    ? event.player
    : event.playerId && event.fullName
      ? { id: event.playerId, name: event.fullName }
      : undefined;
  const assist = event.assistPlayerId
    ? { id: event.assistPlayerId, name: playerName(event.assistStr) }
    : undefined;
  return { player, assist };
}

function eventDetail(event: FotmobEvent) {
  if (event.type === "Substitution" && event.swap?.length) {
    return `${event.swap[1]?.name || "Player"} → ${event.swap[0]?.name || "Player"}`;
  }
  if (event.type === "Card") return event.cardDescription || event.card || "Card";
  if (event.type === "Goal") return event.goalDescription || "Goal";
  return event.type;
}

async function importEvents(
  supabase: SupabaseClient,
  matchId: string,
  match: { home_team_id: string; away_team_id: string },
  events: FotmobEvent[],
) {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const people = eventPeople(event);
    const [playerId, assistPlayerId] = await Promise.all([
      people.player ? upsertPlayer(supabase, people.player, undefined, false) : Promise.resolve(null),
      people.assist ? upsertPlayer(supabase, people.assist, undefined, false) : Promise.resolve(null),
    ]);
    const eventKey = `fotmob:${event.eventId || event.reactKey || `${event.type}:${event.time || 0}:${index}`}`;
    const teamId = event.isHome == null ? null : event.isHome ? match.home_team_id : match.away_team_id;
    const { error } = await supabase.from("match_events").upsert({
      match_id: matchId,
      event_key: eventKey,
      minute: event.time ?? null,
      extra_minute: event.overloadTime ?? null,
      team_id: teamId,
      player_id: playerId,
      assist_player_id: assistPlayerId,
      type: event.type.toLowerCase(),
      detail: eventDetail(event),
      comments: null,
    }, { onConflict: "match_id,event_key" });
    if (error) throw error;
  }
}

async function importMatchDetail(
  supabase: SupabaseClient,
  fixture: FotmobFixture,
  saved: { id: string; home_team_id: string; away_team_id: string },
) {
  const path = fixture.pageUrl.split("#")[0];
  const data = await fetchNextData(`${FOTMOB_BASE}${path}`);
  const detail = parseMatchPage(data);
  if (Number(detail.general?.matchId) !== fixture.id) throw new Error("Free match feed returned the wrong fixture detail");

  const barcaIsHome = detail.general?.homeTeam?.id === FOTMOB_TEAM_ID;
  const lineup = barcaIsHome ? detail.content?.lineup?.homeTeam : detail.content?.lineup?.awayTeam;
  const barcaTeamId = barcaIsHome ? saved.home_team_id : saved.away_team_id;
  const events = detail.content?.matchFacts?.events?.events || [];
  const headerStatus = detail.header?.status || fixture.status;
  const scoreTeams = detail.header?.teams || [];
  const homeScore = headerStatus.started || headerStatus.finished ? scoreTeams[0]?.score ?? null : null;
  const awayScore = headerStatus.started || headerStatus.finished ? scoreTeams[1]?.score ?? null : null;
  const venue = detail.content?.matchFacts?.infoBox?.Stadium?.name || null;
  const elapsed = events.reduce((latest, event) => Math.max(latest, event.time || 0), 0) || null;

  const { error: updateError } = await supabase.from("matches").update({
    venue,
    status: normalizedStatus(headerStatus),
    status_short: statusShort(headerStatus),
    elapsed,
    home_score: homeScore,
    away_score: awayScore,
    provider_payload: {
      source: "fotmob-public-page",
      fixture,
      pageUrl: fixture.pageUrl,
      general: detail.general,
      detailedAt: new Date().toISOString(),
    },
    provider_updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  }).eq("id", saved.id);
  if (updateError) throw updateError;

  const lineupFound = await importLineup(supabase, saved.id, barcaTeamId, lineup);
  await importEvents(supabase, saved.id, saved, events);
  return { lineupFound, eventCount: events.length };
}

export async function syncBarcelonaFree(supabase: SupabaseClient) {
  const teamData = await fetchNextData(`${FOTMOB_BASE}/teams/${FOTMOB_TEAM_ID}/overview/barcelona`);
  const teamPage = findTeamPage(teamData);
  const allFixtures = teamPage?.fixtures?.allFixtures?.fixtures || [];
  if (!allFixtures.length) throw new Error("No Barcelona fixtures were found in the free match feed");

  const now = new Date();
  const from = now.getTime() - 5 * 24 * 60 * 60 * 1000;
  const to = now.getTime() + 90 * 24 * 60 * 60 * 1000;
  const fixtures = allFixtures.filter((fixture) => {
    const kickoff = new Date(fixture.status.utcTime).getTime();
    return Number.isFinite(kickoff) && kickoff >= from && kickoff <= to;
  });
  if (!fixtures.length) throw new Error("No current Barcelona fixtures were found in the free match feed");

  const imported = new Map<number, { id: string; home_team_id: string; away_team_id: string }>();
  for (const fixture of fixtures) {
    imported.set(fixture.id, await upsertFixture(supabase, fixture, teamPage?.details?.latestSeason));
  }

  const candidates = fixtures
    .filter((fixture) => Math.abs(new Date(fixture.status.utcTime).getTime() - now.getTime()) <= 36 * 60 * 60 * 1000)
    .sort((a, b) => Math.abs(new Date(a.status.utcTime).getTime() - now.getTime()) - Math.abs(new Date(b.status.utcTime).getTime() - now.getTime()));
  const target = candidates[0];
  let detail = { lineupFound: false, eventCount: 0 };
  if (target) {
    const saved = imported.get(target.id);
    if (saved) detail = await importMatchDetail(supabase, target, saved);
  }

  return {
    source: "fotmob-public-page",
    fixtureCount: fixtures.length,
    detailedFixtureId: target?.id || null,
    ...detail,
    requestEstimate: target ? 2 : 1,
  };
}
