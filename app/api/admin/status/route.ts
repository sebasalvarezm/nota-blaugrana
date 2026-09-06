import { NextResponse } from "next/server";
import { getServerSupabase, hasSupabaseServerConfig } from "@/lib/supabase/server";

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken || !hasSupabaseServerConfig()) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ isAdmin: false }, { status: 503 });

  const { data, error } = await supabase.auth.getUser(accessToken);
  const email = data.user?.email?.trim().toLowerCase();
  const isAdmin = !error && Boolean(email && adminEmails().includes(email));
  return NextResponse.json({ isAdmin }, { status: isAdmin ? 200 : 403 });
}
