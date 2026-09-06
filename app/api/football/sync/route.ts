import { NextRequest, NextResponse } from "next/server";
import { syncBarcelonaFree } from "@/lib/fotmob";
import { getServerSupabase, hasSupabaseServerConfig } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return { ok: true, actor: "cron" };

  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const supabase = getServerSupabase();
  if (!token || !supabase) return { ok: false, actor: "anonymous" };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return { ok: false, actor: "invalid-session" };

  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return { ok: admins.includes(data.user.email.toLowerCase()), actor: data.user.email };
}

async function shouldRunPublicRefresh(supabase: SupabaseClient) {
  const { data: barca } = await supabase.from("clubs").select("id").eq("provider_id", 529).maybeSingle();
  if (!barca?.id) return true;

  const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const { data: matches } = await supabase
    .from("matches")
    .select("kickoff_at, status, synced_at")
    .or(`home_team_id.eq.${barca.id},away_team_id.eq.${barca.id}`)
    .gte("kickoff_at", cutoff)
    .order("kickoff_at", { ascending: true })
    .limit(1);
  const match = matches?.[0];
  if (!match) return true;

  const now = Date.now();
  const kickoff = new Date(match.kickoff_at).getTime();
  const lastSync = match.synced_at ? new Date(match.synced_at).getTime() : 0;
  const distance = Math.abs(kickoff - now);
  const refreshEvery = match.status === "live" || match.status === "halftime"
    ? 2 * 60 * 1000
    : distance <= 36 * 60 * 60 * 1000
      ? 15 * 60 * 1000
      : 12 * 60 * 60 * 1000;
  return now - lastSync >= refreshEvery;
}

async function run(request: NextRequest) {
  if (!hasSupabaseServerConfig(true)) {
    return NextResponse.json({ error: "Cloud import is not configured yet." }, { status: 503 });
  }
  const auth = await authorize(request);
  const publicAutoRefresh = request.method === "GET" && request.nextUrl.searchParams.get("auto") === "1";
  if (!auth.ok && !publicAutoRefresh) {
    return NextResponse.json({ error: "This account is not allowed to sync match data." }, { status: 403 });
  }

  const supabase = getServerSupabase(true);
  let claimed = false;
  let succeeded = false;
  try {
    if (!supabase) throw new Error("Supabase service connection is unavailable");
    if (publicAutoRefresh && !(await shouldRunPublicRefresh(supabase))) {
      return NextResponse.json({ ok: true, actor: "automatic", skipped: true, syncedAt: new Date().toISOString() });
    }
    const lease = await supabase.rpc("claim_football_sync", { min_interval_seconds: publicAutoRefresh ? 120 : 60 });
    if (lease.error) throw lease.error;
    if (!lease.data) return NextResponse.json({ ok: true, skipped: true });
    claimed = true;
    const result = await syncBarcelonaFree(supabase);
    succeeded = true;
    return NextResponse.json({ ok: true, ...result, syncedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Match updates are temporarily unavailable." }, { status: 502 });
  } finally {
    if (claimed && supabase) await supabase.rpc("finish_football_sync", { succeeded });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
