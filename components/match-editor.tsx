"use client";
import { useState } from "react";
import type { MatchData } from "@/lib/types";
import { DEMO_MATCH } from "@/lib/demo-data";
import { Modal } from "@/components/modal";
import { playerName, shortPlayerName } from "@/lib/player-names";

function localDate(iso: string) { const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
export function MatchEditor({ match, onSave, onClose }: { match: MatchData; onSave: (match: MatchData) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<MatchData>(() => structuredClone({ ...match, players: match.players.length ? match.players : DEMO_MATCH.players }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const barcaHome = draft.home.providerId === 529;
  const opponent = barcaHome ? draft.away : draft.home;
  async function save() {
    setBusy(true); setError("");
    try { await onSave({ ...draft, players: draft.players.map((player) => ({ ...player, name: playerName(player.name), short: shortPlayerName(player.name) })) }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save. Your edits are still here."); }
    finally { setBusy(false); }
  }
  return <Modal labelId="editor-title" onClose={onClose} className="editor-dialog"><div className="dialog-heading"><div><span className="eyebrow">Owner controls</span><h2 id="editor-title">Match & lineup</h2></div><button className="icon-button" onClick={onClose} aria-label="Close match editor">×</button></div><p className="muted">Use this when imported match details need a correction. Saving updates the shared match.</p>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="editor-grid"><label className="form-field">Opponent<input required maxLength={100} value={opponent.name} onChange={(event) => setDraft({ ...draft, [barcaHome ? "away" : "home"]: { ...opponent, name: event.target.value, shortName: event.target.value.slice(0, 3).toUpperCase() } })} /></label><label className="form-field">Kickoff<input type="datetime-local" required value={localDate(draft.kickoff)} onChange={(event) => { if (event.target.value) setDraft({ ...draft, kickoff: new Date(event.target.value).toISOString() }); }} /></label><label className="form-field">Venue<input maxLength={120} value={draft.venue || ""} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label><label className="form-field">Status<select value={draft.statusShort} onChange={(event) => setDraft({ ...draft, statusShort: event.target.value })}>{["NS", "1H", "HT", "2H", "FT", "AET", "PEN", "PST"].map((status) => <option key={status}>{status}</option>)}</select></label>
        {(["homeScore", "awayScore", "halftimeHomeScore", "halftimeAwayScore"] as const).map((field, index) => <label key={field} className="form-field">{["Home score", "Away score", "HT home score", "HT away score"][index]}<input type="number" min="0" max="50" value={draft[field] ?? ""} onChange={(event) => setDraft({ ...draft, [field]: event.target.value === "" ? null : Number(event.target.value) })} /></label>)}
      </div><h3>Players</h3><div className="editor-lineup">{draft.players.map((player, index) => <div key={player.id}><label><span className="visually-hidden">Player {index + 1} name</span><input required maxLength={80} value={player.name} onChange={(event) => setDraft({ ...draft, players: draft.players.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label><label><span className="visually-hidden">Player {index + 1} shirt number</span><input type="number" min="0" max="99" value={player.number ?? ""} onChange={(event) => setDraft({ ...draft, players: draft.players.map((item, itemIndex) => itemIndex === index ? { ...item, number: event.target.value === "" ? null : Number(event.target.value) } : item) })} /></label></div>)}</div>
      {error && <p className="notice" role="alert">{error}</p>}<div className="dialog-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save match details"}</button><button className="button secondary" type="button" onClick={onClose}>Cancel</button></div>
    </form></Modal>;
}
