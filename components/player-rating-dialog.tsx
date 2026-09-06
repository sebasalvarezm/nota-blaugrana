"use client";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { RatingBadge } from "@/components/rating-badge";
import { ratingTemplates } from "@/lib/rating-templates";
import { formatRating, ratingDescription, RATING_VALUES } from "@/lib/ratings";
import type { CommunityRating, Phase, Player, PlayerRating } from "@/lib/types";

export function PlayerRatingDialog({ player, phase, rating, halfTime, community, saveStatus, onChange, onClear, onClose, onNext }:
  { player: Player; phase: Phase; rating?: PlayerRating; halfTime?: PlayerRating; community?: CommunityRating; saveStatus: string;
    onChange: (rating: PlayerRating) => void; onClear: () => void; onClose: () => void; onNext: () => void }) {
  const [activeField, setActiveField] = useState("overall");
  const current = rating || { overall: null, attributes: {} };
  const provisional = phase === "ft" && current.overall == null && halfTime?.overall != null;
  function select(field: string, value: number) {
    onChange(field === "overall" ? { ...current, overall: value, convertedFromFive: false }
      : { ...current, attributes: { ...current.attributes, [field]: value }, convertedFromFive: false });
  }
  function controls(field: string, label: string) {
    const value = field === "overall" ? current.overall : current.attributes[field];
    return <section className="score-control" onFocus={() => setActiveField(field)} onPointerDown={() => setActiveField(field)}>
      <div className="score-label"><strong>{label}</strong><span>{ratingDescription(value)}</span></div>
      <div className="score-choices" role="group" aria-label={`${label}, out of ten`}>
        {RATING_VALUES.map((score) => <button key={score} type="button" aria-pressed={value === score} className={value === score ? "selected" : ""} onClick={() => select(field, score)}>{score}</button>)}
      </div>
      <div className="score-fine"><button type="button" onClick={() => select(field, Math.max(1, (value ?? 6) - 0.5))} disabled={value === 1} aria-label={`Lower ${label} by half a point`}>− 0.5</button><span>{formatRating(value)} / 10</span><button type="button" onClick={() => select(field, Math.min(10, (value ?? 6) + 0.5))} disabled={value === 10} aria-label={`Raise ${label} by half a point`}>+ 0.5</button></div>
    </section>;
  }
  return <Modal labelId="player-title" onClose={onClose} className="player-dialog">
    <div onKeyDown={(event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); select(activeField, event.key === "0" ? 10 : Number(event.key)); }
    }}>
      <div className="dialog-heading"><div><span className="eyebrow">{phase === "ht" ? "Half-time" : "Full-time"} rating</span><h2 id="player-title">{player.name}</h2><p className="muted">{player.roleLabel} · #{player.number ?? "—"}</p></div><button className="icon-button" onClick={onClose} aria-label="Close player rating">×</button></div>
      {provisional && <div className="notice"><span>Your HT score was {formatRating(halfTime.overall)}. Choose your FT score or confirm it below.</span><button className="text-button" onClick={() => onChange({ overall: halfTime.overall, attributes: { ...halfTime.attributes }, convertedFromFive: halfTime.convertedFromFive })}>Keep {formatRating(halfTime.overall)} for FT</button></div>}
      <div className="overall-preview"><RatingBadge value={current.overall} large /><p>One overall score completes your rating.<br /><span className="muted">Add the details when you want to go deeper.</span></p></div>
      {controls("overall", "Overall performance")}
      <details className="role-details"><summary>Role details <span>optional</span></summary>{ratingTemplates[player.role].map(([field, label]) => <div key={field}>{controls(field, label)}</div>)}</details>
      {community?.overall_average != null && <div className="community-inline"><span>Community</span><RatingBadge value={Number(community.overall_average)} /><small>{community.vote_count} player ratings</small></div>}
      <div className="dialog-actions"><button className="text-button" onClick={onClear} disabled={!rating}>Clear this {phase.toUpperCase()} rating</button><button className="button primary" onClick={onNext} disabled={current.overall == null}>Next player →</button></div>
      <small className="muted" role="status">{saveStatus} Keyboard: 1–9; 0 selects 10.</small>
    </div>
  </Modal>;
}
