import { NextResponse } from "next/server";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    cloudConfigured: hasSupabaseServerConfig(),
    importConfigured: hasSupabaseServerConfig(true),
    importSource: "fotmob-public-page",
    checkedAt: new Date().toISOString(),
  });
}
