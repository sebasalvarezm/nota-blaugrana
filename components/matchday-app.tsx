"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { DEMO_MATCH } from "@/lib/demo-data";
import { buildMatchprintCanvas } from "@/lib/matchprint";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { averageRating, formatRating, isRated } from "@/lib/ratings";
import { contributionLabel, contributionsFor } from "@/lib/match-events";
import { playerName, shortPlayerName } from "@/lib/player-names";
import { seasonComparison, seasonLabel } from "@/lib/season";
import type { CommunityRating, MatchData, Phase, Player } from "@/lib/types";
import { AccountDialog } from "@/components/account-dialog";
import { PlayerRatingDialog } from "@/components/player-rating-dialog";
import { RatingBadge } from "@/components/rating-badge";
import { Modal } from "@/components/modal";
import { useRatingStore } from "@/components/use-rating-store";
import { useSeasonAverages } from "@/components/use-season-averages";
import { MatchEditor } from "@/components/match-editor";

const LAST_MATCH_KEY = "nota-blaugrana-last-match-v2";
type MatchChoice = { id: string; label: string };
function usableMatch(value: unknown): value is MatchData {
  if (!value || typeof value !== "object") return false;
  const item = value as MatchData;
  return typeof item.id === "string" && Array.isArray(item.players) && Boolean(item.home?.name && item.away?.name) && Number.isFinite(new Date(item.kickoff).getTime());
}
function cleanMatch(match: MatchData): MatchData {
  return { ...match, players: match.players.map((player) => ({ ...player, name: playerName(player.name) || "Player", short: shortPlayerName(player.name) || "Player" })) };
}

export function MatchdayApp() {
  const [match, setMatch] = useState<MatchData>(DEMO_MATCH);
  const [choices, setChoices] = useState<MatchChoice[]>([]);
  const [phase, setPhase] = useState<Phase>("ft");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchNotice, setMatchNotice] = useState("");
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [poster, setPoster] = useState<{ url: string; name: string } | null>(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [community, setCommunity] = useState<{ matchId: string; rows: CommunityRating[] }>({ matchId: "", rows: [] });
  const requests = useRef(0);
  const mounted = useRef(true);
  const refreshLock = useRef(false);
  const posterGeneration = useRef(0);
  const scope = user?.id || "guest";
  const store = useRatingStore(match, scope, authReady && !loading);
  const season = useSeasonAverages(match, scope, authReady && !loading);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.current += 1; }; }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  const loadMatch = useCallback(async (selectedId?: string, background = false) => {
    const request = ++requests.current;
    if (!background) setRefreshing(true);
    try {
      const response = await fetch(`/api/matches/current${selectedId ? `?matchId=${encodeURIComponent(selectedId)}` : ""}`, { signal: AbortSignal.timeout(9000) });
      const payload = await response.json() as { match?: MatchData; matches?: MatchChoice[]; mode?: string };
      if (!mounted.current || request !== requests.current) return;
      if (!response.ok || !usableMatch(payload.match) || payload.mode !== "cloud") throw new Error("Match data unavailable");
      const next = cleanMatch(payload.match);
      posterGeneration.current += 1; setPoster(null); setActivePlayerId(null); setMatch(next); setChoices(payload.matches || []); setMatchNotice("");
      try { localStorage.setItem(LAST_MATCH_KEY, JSON.stringify(next)); } catch { /* Cache is optional. */ }
    } catch {
      if (mounted.current && request === requests.current) setMatchNotice("Match updates are unavailable. Your saved ratings are safe; the displayed match may be out of date.");
    } finally {
      if (mounted.current && request === requests.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { const raw = localStorage.getItem(LAST_MATCH_KEY); const cached = raw ? JSON.parse(raw) : null; if (usableMatch(cached)) { setMatch(cleanMatch(cached)); setLoading(false); } } catch { /* Ignore an unreadable cache. */ }
      void loadMatch();
    });
    // The provider refresh never blocks the cached match or the first render.
    void fetch("/api/football/sync?auto=1", { signal: AbortSignal.timeout(32_000) })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => { if (active && result?.ok && !result.skipped && requests.current <= 1) void loadMatch(undefined, true); }).catch(() => undefined);
    return () => { active = false; };
  }, [loadMatch]);

  useEffect(() => {
    let active = true;
    let sessionVersion = 0;
    const supabase = getBrowserSupabase();
    const timeout = setTimeout(() => { if (active) setAuthReady(true); }, 7000);
    async function apply(session: Session | null) {
      const version = ++sessionVersion;
      if (!active) return;
      posterGeneration.current += 1;
      setUser(session?.user || null); setIsAdmin(false); setAuthReady(true); setPoster(null); setActivePlayerId(null);
      if (!session?.access_token) return;
      try {
        const response = await fetch("/api/admin/status", { headers: { Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(7000) });
        const result = await response.json();
        if (active && version === sessionVersion) setIsAdmin(response.ok && result.isAdmin === true);
      } catch { /* Owner controls remain private if the check fails. */ }
    }
    if (!supabase) queueMicrotask(() => { if (active) setAuthReady(true); });
    else void supabase.auth.getSession().then(({ data }) => apply(data.session)).catch(() => { if (active) setAuthReady(true); });
    const listener = supabase?.auth.onAuthStateChange((_event, session) => { void apply(session); });
    return () => { active = false; clearTimeout(timeout); listener?.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase || match.source !== "cloud" || store.pending > 0) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const delay = setTimeout(() => {
      void Promise.resolve(supabase.rpc("community_match_summary", { target_match_id: match.id }).abortSignal(controller.signal))
        .then(({ data, error }) => { if (active && !error) setCommunity({ matchId: match.id, rows: (data || []) as CommunityRating[] }); }).catch(() => undefined).finally(() => clearTimeout(timer));
    }, 1200);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(delay); };
  }, [match.id, match.source, store.pending]);
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined); }, []);

  const eligible = useMemo(() => match.players.filter((player) => player.starter || (player.played && (phase === "ft" || (player.minute != null && player.minute <= 45)))), [match.players, phase]);
  const starters = eligible.filter((player) => player.starter);
  const substitutes = eligible.filter((player) => !player.starter);
  const actualRatings = store.ratings[phase];
  const activePlayer = eligible.find((player) => player.id === activePlayerId);
  const rated = eligible.map((player) => ({ player, score: actualRatings[player.id]?.overall })).filter((row): row is { player: Player; score: number } => row.score != null).sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name));
  const average = averageRating(rated.map((row) => row.score));
  const remaining = eligible.length - rated.length;
  const progress = eligible.length ? Math.round(rated.length / eligible.length * 100) : 0;
  const contributions = useMemo(() => contributionsFor(match.events, phase), [match.events, phase]);
  const phaseCommunity = community.matchId === match.id ? community.rows.filter((row) => row.phase === phase && row.overall_average != null) : [];
  const crowdAverage = averageRating(phaseCommunity.map((row) => Number(row.overall_average)));
  const provisional = phase === "ft" ? eligible.filter((player) => !isRated(actualRatings[player.id]) && isRated(store.ratings.ht[player.id])) : [];

  async function refreshMatch() {
    if (refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true);
    try {
      const session = isAdmin ? await getBrowserSupabase()?.auth.getSession() : null;
      const response = await fetch(isAdmin ? "/api/football/sync" : "/api/football/sync?auto=1", { method: isAdmin ? "POST" : "GET", headers: session?.data.session ? { Authorization: `Bearer ${session.data.session.access_token}` } : {}, signal: AbortSignal.timeout(32_000) });
      await loadMatch(match.source === "cloud" ? match.id : undefined);
      if (!response.ok) setMatchNotice("The provider could not refresh. Showing the last saved match.");
    } catch { setMatchNotice("Could not refresh. Showing the last saved match."); }
    finally { refreshLock.current = false; setRefreshing(false); }
  }
  function nextPlayer() {
    const index = eligible.findIndex((player) => player.id === activePlayerId);
    const next = [...eligible.slice(index + 1), ...eligible.slice(0, index)].find((player) => !isRated(actualRatings[player.id]));
    setActivePlayerId(next?.id || null);
    if (!next) setToast("Your ratings are complete. Your Matchprint is ready.");
  }
  async function openPoster() {
    if (!rated.length || posterBusy) return;
    if (phase === "ft" && season.loading) { setToast("Your season history is loading. Please try again in a moment."); return; }
    const generation = ++posterGeneration.current;
    setPosterBusy(true);
    try {
      await document.fonts.ready;
      if (generation !== posterGeneration.current || !mounted.current) return;
      const canvas = buildMatchprintCanvas({ match, phase, players: eligible.map((player) => ({ player, rating: actualRatings[player.id], halfTimeRating: store.ratings.ht[player.id], seasonAverage: season.averages[player.id] })), seasonUnavailable: season.unavailable });
      if (!canvas) throw new Error("Image unavailable");
      setPoster({ url: canvas.toDataURL("image/png"), name: `nota-blaugrana-${match.kickoff.slice(0, 10)}-${phase}.png` });
    } catch { setToast("The image could not be created. Please try again."); }
    finally { setPosterBusy(false); }
  }
  function downloadPoster() {
    if (!poster) return;
    const link = document.createElement("a"); link.href = poster.url; link.download = poster.name; link.click(); setToast("Your Matchprint has been downloaded.");
  }
  async function sharePoster() {
    if (!poster) return;
    try {
      const bytes = Uint8Array.from(atob(poster.url.split(",")[1]), (character) => character.charCodeAt(0));
      const file = new File([bytes], poster.name, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "My Barça ratings" }); else downloadPoster();
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) downloadPoster(); }
  }
  async function saveManual(draft: MatchData) {
    if (!isAdmin) throw new Error("Owner access is required.");
    const session = await getBrowserSupabase()?.auth.getSession();
    const response = await fetch("/api/matches/manual", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.data.session?.access_token || ""}` }, body: JSON.stringify(draft), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Could not save the match. Your edits remain in the form.");
    const result = await response.json(); await loadMatch(result.matchId); setEditorOpen(false); setToast("Match details saved.");
  }
  function chooseMatch(id: string) {
    posterGeneration.current += 1;
    setActivePlayerId(null); setPoster(null);
    if (id === DEMO_MATCH.id) { requests.current += 1; setMatch(DEMO_MATCH); setLoading(false); setRefreshing(false); setMatchNotice(""); } else void loadMatch(id);
  }
  const displayScore = phase === "ht" ? [match.halftimeHomeScore, match.halftimeAwayScore] : [match.homeScore, match.awayScore];

  return <>
    <a className="skip-link" href="#ratings">Skip to player ratings</a>
    <header className="app-header"><a className="brand" href="#top" aria-label="Nota Blaugrana home"><span className="brand-mark" aria-hidden="true">NB</span><span><strong>Nota Blaugrana</strong><small>Your match. Your verdict.</small></span></a><div className="header-actions">{isAdmin && <button className="text-button" onClick={() => setEditorOpen(true)}>Manage match</button>}<button className="button secondary small" onClick={() => setAuthOpen(true)}>{user ? "My account" : "Sign in"}</button></div></header>
    <main id="top" className="app-main">
      <section className="match-header" aria-labelledby="match-title"><div className="match-context"><span className="eyebrow">{loading ? "Loading match" : match.source === "demo" ? "Example match · illustrative data" : match.competition}</span><h1 id="match-title">{loading ? "Your next verdict awaits" : `${match.home.name} vs ${match.away.name}`}</h1><p>{loading ? "Getting the latest match details…" : `${match.date}${match.venue ? ` · ${match.venue}` : ""}`}</p></div><div className="match-score" aria-label={`${phase.toUpperCase()} score: ${displayScore[0] ?? "unavailable"} to ${displayScore[1] ?? "unavailable"}`}><span>{match.home.shortName}</span><strong>{loading ? "—" : displayScore[0] ?? "—"}<i>:</i>{loading ? "—" : displayScore[1] ?? "—"}</strong><span>{match.away.shortName}</span><small>{phase === "ht" ? "HALF TIME" : ["AET", "PEN"].includes(match.statusShort) ? match.statusShort : match.status === "finished" ? "FULL TIME" : match.statusShort}</small></div></section>
      <div className="match-navigation"><label className="match-select"><span className="visually-hidden">Choose a match</span><select value={match.id} onChange={(event) => chooseMatch(event.target.value)} disabled={refreshing}>{!choices.some((choice) => choice.id === match.id) && match.id !== DEMO_MATCH.id && <option value={match.id}>{match.home.shortName} vs {match.away.shortName}</option>}{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}<option value={DEMO_MATCH.id}>Try an example match</option></select></label><button className="text-button" disabled={refreshing} onClick={() => void refreshMatch()}>{refreshing ? "Refreshing…" : "Refresh match"}</button></div>
      {matchNotice && <p className="notice" role="status">{matchNotice}</p>}
      {store.canRestore && <div className="notice"><span>Earlier ratings are saved on this device. Restore missing scores without replacing your current ratings.</span><button className="text-button" onClick={store.restore}>Restore saved ratings</button></div>}
      <div className="rating-toolbar"><div className="phase-switch" role="group" aria-label="Match phase">{(["ht", "ft"] as Phase[]).map((item) => <button key={item} onClick={() => { posterGeneration.current += 1; setPhase(item); setActivePlayerId(null); setPoster(null); }} aria-pressed={phase === item}>{item === "ht" ? "Half time" : "Full time"}</button>)}</div><div className="rating-progress"><span>{rated.length} / {eligible.length} players rated</span><progress value={progress} max="100" aria-label="Rating progress">{progress}%</progress></div></div>
      {provisional.length > 0 && <div className="phase-notice"><span>{provisional.length} HT {provisional.length === 1 ? "score needs" : "scores need"} your FT confirmation.</span><button className="text-button" onClick={() => { provisional.forEach((player) => store.update("ft", player.id, { ...store.ratings.ht[player.id], updatedAt: undefined })); setToast("Half-time scores confirmed for full time."); }}>Keep these HT scores</button></div>}
      <div className="workspace"><section id="ratings" className="lineup-section" aria-labelledby="lineup-title"><div className="section-heading"><div><span className="eyebrow">Starting XI</span><h2 id="lineup-title">Choose a player</h2></div><span className="formation">{match.formation}</span></div>
        {starters.length ? <div className={`pitch ${loading ? "is-loading" : ""}`} aria-label="Barcelona formation"><div className="pitch-circle" /><div className="pitch-box top" /><div className="pitch-box bottom" />{starters.map((player) => <button key={player.id} className="pitch-player" style={{ left: `${Math.max(12, Math.min(88, player.x ?? 50))}%`, top: `${Math.max(12, Math.min(88, player.y ?? 50))}%` }} onClick={() => setActivePlayerId(player.id)} disabled={!store.ready || loading} aria-label={`Rate ${player.name}${actualRatings[player.id]?.overall != null ? `, currently ${formatRating(actualRatings[player.id].overall)} out of ten` : ""}`}><span className="shirt-number">{player.number ?? "·"}</span><span className="pitch-player-name">{player.short}</span><RatingBadge value={actualRatings[player.id]?.overall} />{phase === "ft" && !isRated(actualRatings[player.id]) && isRated(store.ratings.ht[player.id]) && <small className="ht-draft">HT {formatRating(store.ratings.ht[player.id].overall)}</small>}</button>)}</div> : <div className="empty-state"><span className="empty-xi">XI</span><h3>Waiting for the lineup</h3><p>Choose a completed match or try the example while the starting XI is confirmed.</p><button className="button secondary" onClick={() => chooseMatch(DEMO_MATCH.id)}>Try the example</button></div>}
        <div className="section-heading bench-heading"><h3>Substitutes used</h3><span className="muted">{substitutes.length} players</span></div><div className="bench-list">{substitutes.map((player) => <button key={player.id} className="bench-player" onClick={() => setActivePlayerId(player.id)} disabled={!store.ready}><span className="bench-number">{player.number ?? "—"}</span><span className="bench-name"><strong>{player.name}</strong><small>On {player.minute ?? "—"}′ · {player.roleLabel}</small></span><RatingBadge value={actualRatings[player.id]?.overall} /></button>)}{!substitutes.length && <p className="empty-copy">No used substitutes recorded for this phase.</p>}</div>
      </section><aside className="summary-panel" aria-labelledby="summary-title"><div className="section-heading"><div><span className="eyebrow">Your verdict</span><h2 id="summary-title">My match</h2></div><span className="phase-label">{phase.toUpperCase()}</span></div><div className="team-average"><div><span>Team average</span><small>{rated.length ? `From ${rated.length} rated players` : "Rate a player to begin"}</small></div><RatingBadge value={average} large /></div><div className="community-line"><span>Community average</span><strong>{formatRating(crowdAverage)}</strong></div><div className="leaders"><div className="section-heading"><h3>MVPs</h3><span className="muted">Your highest ratings</span></div><ol>{rated.slice(0, 3).map(({ player, score }, index) => <li key={player.id}><span className="leader-rank">{index + 1}</span><div className="leader-copy"><strong>{player.name}</strong><small>{contributionLabel(contributions[player.id]) || player.roleLabel}</small></div><RatingBadge value={score} /></li>)}</ol>{!rated.length && <p className="empty-copy">Your top performers will appear here.</p>}</div><button className="button primary full-width" onClick={() => void openPoster()} disabled={!rated.length || posterBusy}>{posterBusy ? "Creating your image…" : "Preview Matchprint"}</button><p className="export-note">{remaining ? `${remaining} players still to rate. Partial sheets are labelled.` : "Your match sheet is complete."}</p><div className="save-status" role="status"><span className={store.pending ? "status-dot pending" : "status-dot"} /><span>{store.status}</span></div>{store.conflict ? <button className="text-button" onClick={() => store.retry(true)}>Keep this device’s edits and sync</button> : user && (store.pending > 0 || store.status.includes("unavailable")) && <button className="text-button" onClick={() => store.retry()}>Retry account sync</button>}{!user && <p className="guest-note">Guest ratings stay on this device. <button className="text-button" onClick={() => setAuthOpen(true)}>Sign in to sync</button></p>}</aside></div>
      {phase === "ft" && rated.length > 0 && <section className="season-section" aria-labelledby="season-title"><div className="section-heading"><div><span className="eyebrow">{seasonLabel(match.kickoff)}</span><h2 id="season-title">Against your season</h2></div><span className="muted">Previous full-time ratings</span></div><div className="season-list">{rated.map(({ player, score }) => <div key={player.id} className="season-player"><strong>{player.name}</strong><RatingBadge value={score} /><div><span>{season.unavailable ? "History unavailable" : seasonComparison(score, season.averages[player.id])}</span><small>{season.averages[player.id] ? `Season ${formatRating(season.averages[player.id].average)} · ${season.averages[player.id].matches} rated matches` : "Build your history by rating more matches"}</small></div></div>)}</div><p className="method-note">Your personal FT ratings, before this match. Season: July–June. At least 3 previous ratings are needed for a comparison.{Object.values(season.averages).some((item) => item.includesConverted) ? " Includes earlier /5 scores converted to /10." : ""}</p></section>}
      <footer className="app-footer"><span>Nota Blaugrana · Independent fan ratings</span><span>{match.source === "demo" ? "Example data" : match.lastSyncedAt ? `Match data updated ${new Date(match.lastSyncedAt).toLocaleString()}` : "Match data awaiting refresh"}</span><span>Ratings /10 · G = goals · A = assists</span></footer>
    </main>
    {activePlayer && store.ready && <PlayerRatingDialog key={`${scope}:${match.id}:${phase}:${activePlayer.id}`} player={activePlayer} phase={phase} rating={actualRatings[activePlayer.id]} saveStatus={store.status} halfTime={store.ratings.ht[activePlayer.id]} community={phaseCommunity.find((row) => row.player_id === activePlayer.id)} onChange={(rating) => store.update(phase, activePlayer.id, rating)} onClear={() => store.update(phase, activePlayer.id, null)} onClose={() => setActivePlayerId(null)} onNext={nextPlayer} />}
    {authOpen && <AccountDialog user={user} onClose={() => setAuthOpen(false)} />}
    {editorOpen && isAdmin && <MatchEditor match={match} onClose={() => setEditorOpen(false)} onSave={saveManual} />}
    {poster && <Modal labelId="poster-title" className="poster-dialog" onClose={() => setPoster(null)}><div className="dialog-heading"><div><span className="eyebrow">Ready to share</span><h2 id="poster-title">Your Matchprint</h2></div><button className="icon-button" onClick={() => setPoster(null)} aria-label="Close Matchprint">×</button></div>
      {/* This PNG is created on the device and contains no external image assets. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="poster-image" src={poster.url} alt={`${phase.toUpperCase()} ratings for ${match.home.name} versus ${match.away.name}`} /><div className="dialog-actions"><button className="button primary" onClick={downloadPoster}>Download PNG</button><button className="button secondary" onClick={() => void sharePoster()}>Share image</button></div><p className="muted">Created on your device. No upload is required.</p></Modal>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
