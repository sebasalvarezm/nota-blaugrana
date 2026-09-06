import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, hasSupabaseServerConfig } from "@/lib/supabase/server";
import type { MatchData, Team } from "@/lib/types";
import { playerName } from "@/lib/player-names";
import { ratingTemplates } from "@/lib/rating-templates";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;

  const supabase = getServerSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return false;
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase());
  return admins.includes(data.user.email.toLowerCase());
}

function statusFromShort(short: string) {
  if (["1H", "2H", "ET", "LIVE"].includes(short)) return "live";
  if (short === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (short === "PST") return "postponed";
  return "scheduled";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  if (!hasSupabaseServerConfig(true)) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "This account cannot manage matches." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as MatchData | null;
  if (!body || typeof body.id !== "string" || !body.home?.name || !body.away?.name || !Number.isFinite(Date.parse(body.kickoff)) || !Array.isArray(body.players)) {
    return NextResponse.json({ error: "Match, kickoff, and lineup are required." }, { status: 400 });
  }
  const bounded = (value: unknown, max: number) => value == null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);
  if (body.players.length > 30 || body.players.filter((player) => player.starter).length !== 11
    || new Set(body.players.map((player) => player.id)).size !== body.players.length
    || body.players.some((player) => !playerName(player.name) || player.name.length > 80 || !(player.role in ratingTemplates) || !bounded(player.number, 99))
    || ![body.homeScore, body.awayScore, body.halftimeHomeScore, body.halftimeAwayScore].every((score) => bounded(score, 50))
    || !["NS", "1H", "HT", "2H", "ET", "LIVE", "FT", "AET", "PEN", "PST"].includes(body.statusShort)
    || (body.home.providerId !== 529 && body.away.providerId !== 529)) {
    return NextResponse.json({ error: "Check the scores and complete starting XI before saving." }, { status: 400 });
  }

  const supabase = getServerSupabase(true);
  if (!supabase) return NextResponse.json({ error: "Supabase service connection failed." }, { status: 503 });

  async function ensureClub(team: Team) {
    if (team.providerId) {
      const { data, error } = await supabase!
        .from("clubs")
        .upsert({ provider_id: team.providerId, name: team.name, short_name: team.shortName, logo_url: team.logoUrl || null }, { onConflict: "provider_id" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    }
    const { data: existing } = await supabase!.from("clubs").select("id").eq("name", team.name).limit(1);
    if (existing?.[0]) return existing[0].id as string;
    const { data, error } = await supabase!
      .from("clubs")
      .insert({ name: team.name, short_name: team.shortName, logo_url: team.logoUrl || null })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  try {
    const [homeTeamId, awayTeamId] = await Promise.all([ensureClub(body.home), ensureClub(body.away)]);
    const season = new Date(body.kickoff).getUTCFullYear();
    const { data: competition, error: competitionError } = await supabase
      .from("competitions")
      .upsert({ provider_id: -1000, name: "Manual match", country: "Spain", season }, { onConflict: "provider_id,season" })
      .select("id")
      .single();
    if (competitionError) throw competitionError;

    const matchValues = {
      competition_id: competition.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      kickoff_at: body.kickoff,
      venue: body.venue || null,
      timezone: process.env.NEXT_PUBLIC_TIMEZONE || "America/New_York",
      status: statusFromShort(body.statusShort),
      status_short: body.statusShort,
      home_score: body.homeScore,
      away_score: body.awayScore,
      halftime_home_score: body.halftimeHomeScore ?? null,
      halftime_away_score: body.halftimeAwayScore ?? null,
      formation: body.formation,
      provider_payload: { source: "manual" },
      synced_at: new Date().toISOString(),
    };

    let matchId: string;
    if (isUuid(body.id)) {
      const { data, error } = await supabase.from("matches").update(matchValues).eq("id", body.id).select("id").single();
      if (error) throw error;
      matchId = data.id;
    } else {
      const { data, error } = await supabase.from("matches").insert(matchValues).select("id").single();
      if (error) throw error;
      matchId = data.id;
    }

    const barcaTeamId = body.home.providerId === 529 ? homeTeamId : awayTeamId;
    const lineupRows = [];
    for (const player of body.players) {
      // Retain the player's stable identity when correcting a name.
      let lookup = supabase.from("players").select("id");
      lookup = isUuid(player.id) ? lookup.eq("id", player.id) : player.providerId ? lookup.eq("provider_id", player.providerId) : lookup.eq("name", playerName(player.name));
      const { data: existingPlayers, error: lookupError } = await lookup.limit(1);
      if (lookupError) throw lookupError;
      let playerId = existingPlayers?.[0]?.id as string | undefined;
      if (!playerId) {
        const { data, error } = await supabase
          .from("players")
          .insert({ name: playerName(player.name), default_position: player.role })
          .select("id")
          .single();
        if (error) throw error;
        playerId = data.id;
      } else {
        const { error } = await supabase.from("players").update({ name: playerName(player.name) }).eq("id", playerId);
        if (error) throw error;
      }
      lineupRows.push({
        match_id: matchId,
        player_id: playerId,
        team_id: barcaTeamId,
        squad_number: player.number,
        starter: player.starter,
        played: player.played,
        minute_in: player.minute ?? (player.starter ? 0 : null),
        role_code: player.role,
        role_label: player.roleLabel,
        pitch_x: player.x ?? null,
        pitch_y: player.y ?? null,
      });
    }
    const { error: lineupError } = await supabase.rpc("replace_fotmob_lineup", { target_match_id: matchId, lineup_rows: lineupRows, match_formation: body.formation });
    if (lineupError) throw lineupError;

    return NextResponse.json({ ok: true, matchId, savedPlayers: lineupRows.length });
  } catch {
    return NextResponse.json({ error: "Could not save the match. Please retry." }, { status: 500 });
  }
}
