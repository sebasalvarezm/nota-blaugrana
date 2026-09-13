import type { Player } from "@/lib/types";
import { ratingTemplates } from "@/lib/rating-templates";

export type PositionValue = { role_code: Player["role"]; role_label: string; pitch_x: number | null; pitch_y: number | null };
export type PositionChange = PositionValue & { player_id: string; expected: PositionValue };
export function positionValue(player: Player): PositionValue {
  return {role_code:player.role,role_label:player.roleLabel,pitch_x:player.x??null,pitch_y:player.y??null};
}
export function positionChanges(original: Player[], edited: Player[]): PositionChange[] {
  return edited.flatMap(player=>{
    const before = original.find(row=>row.id===player.id);
    if (!before) return [];
    const value = positionValue(player), expected = positionValue(before);
    return JSON.stringify(value) === JSON.stringify(expected) ? [] : [{player_id:player.id,...value,expected}];
  });
}
export function parsePositionChanges(input: unknown): PositionChange[] | null {
  const validValue = (value: unknown): boolean => {
    if (!value || typeof value!=="object") return false;
    const p = value as PositionValue;
    return typeof p.role_code==="string" && Object.hasOwn(ratingTemplates,p.role_code)
      && typeof p.role_label==="string" && p.role_label.length>0 && p.role_label.length<=80
      && [p.pitch_x,p.pitch_y].every(n=>n===null || (typeof n==="number" && Number.isFinite(n) && n>=0 && n<=100));
  };
  if (!Array.isArray(input) || !input.length || input.length>30) return null;
  const seen = new Set<string>();
  const result: PositionChange[] = [];
  for (const p of input) {
    if (!p || typeof p.player_id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.player_id)
      || seen.has(p.player_id.toLowerCase()) || !validValue(p) || !validValue(p.expected)) return null;
    seen.add(p.player_id.toLowerCase());
    result.push({player_id:p.player_id,role_code:p.role_code,role_label:p.role_label,pitch_x:p.pitch_x,pitch_y:p.pitch_y,
      expected:{role_code:p.expected.role_code,role_label:p.expected.role_label,pitch_x:p.expected.pitch_x,pitch_y:p.expected.pitch_y}});
  }
  return result;
}
export function positionSaveError(code?: string): {status:number; message:string} {
  if (["PGRST202","PGRST205","42P01","42883"].includes(code||"")) return {status:503,message:"Position saving needs the database update supplied with this release. Your edits have not been saved."};
  if (code==="42501") return {status:503,message:"The database cannot save positions with its current permissions. Apply the position-saving database update."};
  if (code==="40001") return {status:409,message:"One of these players changed since you opened the editor. Refresh the match and reopen Edit positions before trying again."};
  if (["22023","23503","23514"].includes(code||"")) return {status:400,message:"These positions are no longer valid for this lineup. Refresh the match and try again."};
  return {status:503,message:"Position saving is temporarily unavailable. Your edits are still here; please retry."};
}
