"use client";
import { useState } from "react";
import type { MatchData, Player } from "@/lib/types";
import { POSITIONS, movePlayer, positionId } from "@/lib/lineup-positions";
import { Modal } from "@/components/modal";

export function PositionEditor({ match, onSave, onClose }: { match:MatchData; onSave:(players:Player[])=>Promise<void>; onClose:()=>void }) {
  const [players,setPlayers] = useState(match.players);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { await onSave(players); } catch { setError("Could not save positions. Your changes are still here; please retry."); }
    finally { setBusy(false); }
  }
  return <Modal labelId="positions-title" className="editor-dialog" onClose={()=>{if(!busy) onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow">Owner controls</span><h2 id="positions-title">Edit player positions</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close position editor">×</button></div>
    <p className="muted">Choose each player’s position. Moving into an occupied starting position swaps the players. Corrections apply to this match and stay saved after refreshes.</p>
    <div className="position-preview" aria-label="Corrected formation preview"><span className="position-direction">ATTACK ↑</span>{players.filter(player=>player.starter).map(player=><span key={player.id} style={{left:`${Math.max(12,Math.min(88,player.x??50))}%`,top:`${Math.max(12,Math.min(88,player.y??50))}%`}}><b>{player.number??"·"}</b>{player.short}</span>)}</div>
    <form onSubmit={event=>{event.preventDefault();void save();}}><div className="position-fields">{players.map(player=><label key={player.id}><span>{player.name}<small>{player.starter?"Starting XI":"Substitute"}</small></span><select disabled={busy} aria-label={`${player.name} position`} value={positionId(player)} onChange={event=>setPlayers(previous=>movePlayer(previous,player.id,event.target.value))}><option value="" disabled>{player.roleLabel} · imported</option>{POSITIONS.map(position=><option key={position.id} value={position.id}>{position.label}</option>)}</select></label>)}</div>
    {error&&<p role="alert" className="notice">{error}</p>}<div className="dialog-actions"><button type="submit" className="button primary" disabled={busy}>{busy?"Saving…":"Save positions"}</button><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button></div></form>
  </Modal>;
}
