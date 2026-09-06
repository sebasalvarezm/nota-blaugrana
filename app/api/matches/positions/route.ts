import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ratingTemplates } from "@/lib/rating-templates";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const auth = getServerSupabase();
  if (!auth || !token) return NextResponse.json({error:"Sign in as owner."},{status:401});
  const {data,error} = await auth.auth.getUser(token);
  const owners = (process.env.ADMIN_EMAILS||"").split(",").map(email=>email.trim().toLowerCase()).filter(Boolean);
  if (error || !data.user?.email || !owners.includes(data.user.email.toLowerCase())) return NextResponse.json({error:"Owner access required."},{status:403});
  const body = await request.json().catch(()=>null);
  const uuid = (value:unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (!uuid(body?.matchId) || !Array.isArray(body?.positions) || !body.positions.length || body.positions.length>30
    || body.positions.some((p:Record<string,unknown>)=>!p || !uuid(p.player_id) || typeof p.role_code!=="string" || !Object.hasOwn(ratingTemplates,p.role_code)
      || typeof p.role_label!=="string" || p.role_label.length>80 || ![p.pitch_x,p.pitch_y].every(n=>n===null || (typeof n==="number" && Number.isFinite(n) && n>=0 && n<=100)))) {
    return NextResponse.json({error:"Invalid positions."},{status:400});
  }
  const service = getServerSupabase(true);
  if (!service) return NextResponse.json({error:"Position saving is unavailable."},{status:503});
  const result = await service.rpc("save_match_positions",{target_match_id:body.matchId,position_rows:body.positions});
  return result.error ? NextResponse.json({error:"Could not save positions. Reload the match and retry."},{status:409}) : NextResponse.json({ok:true});
}
