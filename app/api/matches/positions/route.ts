import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { parsePositionChanges, positionSaveError } from "@/lib/position-save";

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const auth = getServerSupabase();
    if (!auth || !token) return NextResponse.json({error:"Sign in as owner to save positions."},{status:401});
    const {data,error} = await auth.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({error:"Your sign-in expired. Sign in again to save positions."},{status:401});
    const owners = (process.env.ADMIN_EMAILS||"").split(",").map(email=>email.trim().toLowerCase()).filter(Boolean);
    if (!data.user.email || !owners.includes(data.user.email.toLowerCase())) return NextResponse.json({error:"Only the owner can save match positions."},{status:403});
    const body = await request.json().catch(()=>null);
    const positions = parsePositionChanges(body?.positions);
    if (typeof body?.matchId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.matchId) || !positions)
      return NextResponse.json({error:"Refresh the app and choose valid player positions before saving."},{status:400});
    const service = getServerSupabase(true);
    if (!service) return NextResponse.json({error:"Owner position saving is not configured on the server."},{status:503});
    const result = await service.rpc("save_match_positions_v2",{target_match_id:body.matchId,position_rows:positions}).abortSignal(AbortSignal.timeout(9000));
    if (result.error) {
      console.error("position_save_failed",{matchId:body.matchId,code:result.error.code,message:result.error.message});
      const failure = positionSaveError(result.error.code);
      return NextResponse.json({error:failure.message},{status:failure.status});
    }
    if (!Array.isArray(result.data) || result.data.length!==positions.length) throw new Error("Invalid save confirmation");
    for (const expected of positions) {
      const saved = result.data.find(row=>row.player_id===expected.player_id);
      if (!saved || saved.role_code!==expected.role_code || saved.role_label!==expected.role_label
        || saved.pitch_x!==expected.pitch_x || saved.pitch_y!==expected.pitch_y) throw new Error("Positions did not match save confirmation");
    }
    return NextResponse.json({ok:true,matchId:body.matchId,positions:result.data},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"Could not confirm the save. Your edits are still here; retrying is safe."},{status:503});
  }
}
