import type { Player, Role } from "@/lib/types";

export const POSITIONS: Array<{ id: string; label: string; role: Role; x: number; y: number }> = [
  { id:"GK", label:"Goalkeeper", role:"GK", x:50, y:88 },
  { id:"RB", label:"Right-back", role:"FB", x:82, y:72 },
  { id:"RCB", label:"Right centre-back", role:"CB", x:65, y:74 },
  { id:"CB", label:"Centre-back", role:"CB", x:50, y:74 },
  { id:"LCB", label:"Left centre-back", role:"CB", x:35, y:74 },
  { id:"LB", label:"Left-back", role:"FB", x:18, y:72 },
  { id:"RDM", label:"Right defensive midfield", role:"PIVOT", x:65, y:58 },
  { id:"DM", label:"Defensive midfield", role:"PIVOT", x:50, y:58 },
  { id:"LDM", label:"Left defensive midfield", role:"PIVOT", x:35, y:58 },
  { id:"RCM", label:"Right central midfield", role:"MID", x:70, y:45 },
  { id:"CM", label:"Central midfield", role:"MID", x:50, y:45 },
  { id:"LCM", label:"Left central midfield", role:"MID", x:30, y:45 },
  { id:"AM", label:"Attacking midfield", role:"MID", x:50, y:32 },
  { id:"RW", label:"Right wing", role:"WING", x:82, y:20 },
  { id:"ST", label:"Striker", role:"ST", x:50, y:15 },
  { id:"LW", label:"Left wing", role:"WING", x:18, y:20 },
];
export function positionId(player: Player): string {
  return POSITIONS.find((position) => position.role === player.role && position.x === player.x && position.y === player.y)?.id || "";
}
export function movePlayer(players: Player[], playerId: string, targetId: string): Player[] {
  const moving = players.find((player) => player.id === playerId);
  const target = POSITIONS.find((position) => position.id === targetId);
  if (!moving || !target) return players;
  // Swap an occupied starting position, preserving player identity and ratings.
  const occupant = moving.starter ? players.find((player) => player.starter && player.id !== playerId && player.x != null && player.y != null
    && Math.abs(player.x - target.x) < 13 && Math.abs(player.y - target.y) < 13) : undefined;
  return players.map((player) => player.id === playerId ? { ...player, role:target.role, roleLabel:target.label, x:target.x, y:target.y }
    : player.id === occupant?.id ? { ...player, role:moving.role, roleLabel:moving.roleLabel, x:moving.x, y:moving.y } : player);
}
