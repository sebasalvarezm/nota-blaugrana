import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, hasSupabaseServerConfig } from "@/lib/supabase/server";
import type { MatchData, Team } from "@/lib/types";

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

  const body = (await request.json()) as MatchData;
  if (!body.home?.name || !body.away?.name || !body.kickoff || !body.players?.length) {
    return NextResponse.json({ error: "Match, kickoff, and lineup are required." }, { status: 400 });
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
      formation: body.formation,
      provider_payload: { source: "manual" },
      synced_at: new Date().toISOString(),
    };

    let matchId: string;
    if (isUuid(body.id)) {
      const { data, error } = await supabase.from("matches").update(matchValues).eq("id", body.id).select("id").single();
      if (error) throw error;
      matchId = data.id;
      const { error: clearError } = await supabase.from("match_players").delete().eq("match_id", matchId);
      if (clearError) throw clearError;
    } else {
      const { data, error } = await supabase.from("matches").insert(matchValues).select("id").single();
      if (error) throw error;
      matchId = data.id;
    }

    const barcaTeamId = body.home.providerId === 529 ? homeTeamId : awayTeamId;
    let savedPlayers = 0;
    for (const player of body.players) {
      const { data: existingPlayers } = await supabase.from("players").select("id").eq("name", player.name).limit(1);
      let playerId = existingPlayers?.[0]?.id as string | undefined;
      if (!playerId) {
        const { data, error } = await supabase
          .from("players")
          .insert({ name: player.name, default_position: player.role })
          .select("id")
          .single();
        if (error) throw error;
        playerId = data.id;
      }
      const { error } = await supabase.from("match_players").insert({
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
      if (error) throw error;
      savedPlayers += 1;
    }

    return NextResponse.json({ ok: true, matchId, savedPlayers });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Could not save the manual match";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
