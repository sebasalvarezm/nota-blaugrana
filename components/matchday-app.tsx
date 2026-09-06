"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { DEMO_MATCH } from "@/lib/demo-data";
import { buildMatchprintCanvas } from "@/lib/matchprint";
import { ratingTemplates, scoreDescriptions } from "@/lib/rating-templates";
import { getBrowserSupabase, hasSupabaseBrowserConfig } from "@/lib/supabase/browser";
import type { CommunityRating, MatchData, Phase, Player, PlayerRating, RatingsState } from "@/lib/types";

const MANUAL_MATCH_KEY = "nota-blaugrana-manual-match-v1";
const USE_MANUAL_KEY = "nota-blaugrana-use-manual-v1";
const LEGACY_MANUAL_MATCH_KEY = "matchday-five-manual-match-v1";
const LEGACY_USE_MANUAL_KEY = "matchday-five-use-manual-v1";

function blankRating(player: Player): PlayerRating {
  return {
    overall: null,
    attributes: Object.fromEntries(ratingTemplates[player.role].map(([key]) => [key, null])),
  };
}

function emptyRatings(): RatingsState {
  return { ht: {}, ft: {} };
}

function ratingStorageKey(matchId: string) {
  return `nota-blaugrana-ratings-v1:${matchId}`;
}

function legacyRatingStorageKey(matchId: string) {
  return `matchday-five-ratings-v2:${matchId}`;
}

function isComplete(player: Player, rating?: PlayerRating) {
  return Boolean(
    rating?.overall && ratingTemplates[player.role].every(([key]) => Boolean(rating.attributes[key]))
  );
}

function displayScore(score: number | null) {
  return score == null ? "–" : String(score);
}

function localDateTimeValue(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function teamBadge(team: MatchData["home"], fallback: string) {
  return team.logoUrl ? (
    // External provider badges are display-only and never drawn into exported posters.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={team.logoUrl} alt={`${team.name} crest`} onError={(event) => { event.currentTarget.style.display = "none"; }} />
  ) : <b style={{ display: "block" }}>{fallback}</b>;
}

export function MatchdayApp() {
  const [match, setMatch] = useState<MatchData>(DEMO_MATCH);
  const [mode, setMode] = useState("loading");
  const [phase, setPhase] = useState<Phase>("ft");
  const [ratings, setRatings] = useState<RatingsState>(emptyRatings);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [activeField, setActiveField] = useState("overall");
  const [user, setUser] = useState<User | null>(null);
  const [canGeneratePoster, setCanGeneratePoster] = useState(false);
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);
  const [community, setCommunity] = useState<CommunityRating[]>([]);
  const [saveStatus, setSaveStatus] = useState("Saved on this device");
  const [toast, setToast] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterPreviewUrl, setPosterPreviewUrl] = useState("");
  const [posterLeaderIds, setPosterLeaderIds] = useState<string[]>([]);
  const [manualDraft, setManualDraft] = useState<MatchData>(DEMO_MATCH);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const loadCommunity = useCallback(async (matchId: string) => {
    if (!hasSupabaseBrowserConfig() || matchId.startsWith("demo-") || matchId.startsWith("manual-")) {
      setCommunity([]);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.rpc("community_match_summary", { target_match_id: matchId });
    setCommunity((data || []) as unknown as CommunityRating[]);
  }, []);

  const loadMatch = useCallback(async (ignoreManual = false) => {
    setLoading(true);
    try {
      const manualEnabled = localStorage.getItem(USE_MANUAL_KEY) === "true"
        || localStorage.getItem(LEGACY_USE_MANUAL_KEY) === "true";
      if (!ignoreManual && manualEnabled) {
        const saved = localStorage.getItem(MANUAL_MATCH_KEY) || localStorage.getItem(LEGACY_MANUAL_MATCH_KEY);
        if (saved) {
          const manual = JSON.parse(saved) as MatchData;
          setMatch(manual);
          setMode("manual");
          return;
        }
      }
      await fetch("/api/football/sync?auto=1", { cache: "no-store" }).catch(() => undefined);
      const response = await fetch("/api/matches/current", { cache: "no-store" });
      const payload = (await response.json()) as { match: MatchData; mode: string };
      setMatch(payload.match);
      setMode(payload.mode);
      void loadCommunity(payload.match.id);
    } catch {
      setMatch(DEMO_MATCH);
      setMode("local");
      showToast("Using the offline test match");
    } finally {
      setLoading(false);
    }
  }, [loadCommunity, showToast]);

  useEffect(() => {
    queueMicrotask(() => void loadMatch());
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setAdminCheckComplete(true);
      return;
    }

    async function applySession(session: Session | null) {
      setUser(session?.user || null);
      setCanGeneratePoster(false);
      setAdminCheckComplete(false);
      if (!session?.access_token) {
        setAdminCheckComplete(true);
        return;
      }
      try {
        const response = await fetch("/api/admin/status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as { isAdmin?: boolean };
        setCanGeneratePoster(Boolean(payload.isAdmin));
      } catch {
        setCanGeneratePoster(false);
      } finally {
        setAdminCheckComplete(true);
      }
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { void applySession(session); });
    return () => authListener.subscription.unsubscribe();
  }, [loadMatch]);

  useEffect(() => {
    if (adminCheckComplete && !canGeneratePoster) setPosterOpen(false);
  }, [adminCheckComplete, canGeneratePoster]);

  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setActivePlayerId(null);
      try {
        const local = localStorage.getItem(ratingStorageKey(match.id))
          || localStorage.getItem(legacyRatingStorageKey(match.id));
        setRatings(local ? (JSON.parse(local) as RatingsState) : emptyRatings());
      } catch {
        setRatings(emptyRatings());
      }
    });

    const supabase = getBrowserSupabase();
    if (user && supabase && match.source === "cloud") {
      void supabase
        .from("ratings")
        .select("player_id, phase, overall, attributes")
        .eq("match_id", match.id)
        .then(({ data }) => {
          if (!data) return;
          const cloud = emptyRatings();
          data.forEach((row) => {
            const rowPhase = row.phase as Phase;
            cloud[rowPhase][row.player_id] = {
              overall: row.overall,
              attributes: (row.attributes || {}) as Record<string, number | null>,
            };
          });
          setRatings((current) => ({
            ht: { ...current.ht, ...cloud.ht },
            ft: { ...current.ft, ...cloud.ft },
          }));
          setSaveStatus("Synced to your account");
        });
    }
  }, [match.id, match.source, user]);

  useEffect(() => {
    document.body.style.overflow = activePlayerId || authOpen || setupOpen || posterOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activePlayerId, authOpen, posterOpen, setupOpen]);

  const eligiblePlayers = useMemo(
    () => match.players.filter((player) => player.starter || (
      player.played && (phase === "ft" || (player.minute != null && player.minute <= 45))
    )),
    [match.players, phase]
  );
  const starters = useMemo(() => match.players.filter((player) => player.starter), [match.players]);
  const substitutes = useMemo(
    () => match.players.filter((player) => !player.starter && player.played && (
      phase === "ft" || (player.minute != null && player.minute <= 45)
    )),
    [match.players, phase]
  );
  const activePlayer = match.players.find((player) => player.id === activePlayerId) || null;
  const phaseRatings = useMemo(
    () => phase === "ft" ? { ...ratings.ht, ...ratings.ft } : ratings.ht,
    [phase, ratings]
  );
  const inheritedFullTimeCount = useMemo(
    () => phase === "ft"
      ? Object.keys(ratings.ht).filter((playerId) => !ratings.ft[playerId]).length
      : 0,
    [phase, ratings]
  );

  const summary = useMemo(() => {
    const completed = eligiblePlayers.filter((player) => isComplete(player, phaseRatings[player.id])).length;
    const rated = eligiblePlayers
      .map((player) => ({ player, score: phaseRatings[player.id]?.overall }))
      .filter((item): item is { player: Player; score: number } => Boolean(item.score))
      .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name));
    const average = rated.length ? rated.reduce((sum, item) => sum + item.score, 0) / rated.length : null;
    return {
      completed,
      rated,
      average,
      remaining: eligiblePlayers.length - completed,
      percent: eligiblePlayers.length ? Math.round((completed / eligiblePlayers.length) * 100) : 0,
    };
  }, [eligiblePlayers, phaseRatings]);

  const posterCandidates = summary.rated;

  const phaseCommunity = useMemo(() => community.filter((row) => row.phase === phase), [community, phase]);
  const communityAverage = phaseCommunity.length
    ? phaseCommunity.reduce((sum, row) => sum + Number(row.overall_average || 0), 0) / phaseCommunity.length
    : null;
  const communityVotes = phaseCommunity.reduce((sum, row) => sum + Number(row.vote_count || 0), 0);

  function saveLocal(next: RatingsState) {
    localStorage.setItem(ratingStorageKey(match.id), JSON.stringify(next));
    setSaveStatus(user && match.source === "cloud" ? "Saving to your account…" : "Saved on this device");
  }

  function scheduleCloudSave(player: Player, playerRating: PlayerRating) {
    if (!user || match.source !== "cloud") return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const key = `${phase}:${player.id}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const { error } = await supabase.from("ratings").upsert({
        user_id: user.id,
        match_id: match.id,
        player_id: player.id,
        phase,
        overall: playerRating.overall,
        attributes: Object.fromEntries(Object.entries(playerRating.attributes).filter(([, value]) => value != null)),
      }, { onConflict: "user_id,match_id,player_id,phase" });
      setSaveStatus(error ? "Saved locally · cloud retry needed" : "Synced to your account");
      if (!error) void loadCommunity(match.id);
    }, 450);
  }

  function selectScore(field: string, score: number) {
    if (!activePlayer) return;
    const current = phaseRatings[activePlayer.id] || blankRating(activePlayer);
    const updated: PlayerRating = field === "overall"
      ? { ...current, overall: score }
      : { ...current, attributes: { ...current.attributes, [field]: score } };
    const next: RatingsState = {
      ...ratings,
      [phase]: { ...ratings[phase], [activePlayer.id]: updated },
    };
    setRatings(next);
    saveLocal(next);
    scheduleCloudSave(activePlayer, updated);
    const fields = ["overall", ...ratingTemplates[activePlayer.role].map(([key]) => key)];
    setActiveField(fields[Math.min(fields.indexOf(field) + 1, fields.length - 1)]);
  }

  async function clearActivePlayer() {
    if (!activePlayer) return;
    const next = { ...ratings, [phase]: { ...ratings[phase] } };
    delete next[phase][activePlayer.id];
    setRatings(next);
    saveLocal(next);
    const supabase = getBrowserSupabase();
    if (user && supabase && match.source === "cloud") {
      await supabase.from("ratings").delete().eq("match_id", match.id).eq("player_id", activePlayer.id).eq("phase", phase);
      setSaveStatus("Synced to your account");
      void loadCommunity(match.id);
    }
    showToast(phase === "ft" && ratings.ht[activePlayer.id]
      ? `${activePlayer.short} reset to the half-time rating`
      : `${activePlayer.short}'s ${phase.toUpperCase()} rating cleared`);
  }

  function openPlayer(playerId: string) {
    const player = match.players.find((item) => item.id === playerId);
    if (!player || (!player.starter && phase === "ht")) return;
    setActiveField("overall");
    setActivePlayerId(playerId);
  }

  function openNextPlayer() {
    if (!activePlayer) return;
    const currentIndex = eligiblePlayers.findIndex((player) => player.id === activePlayer.id);
    const next = eligiblePlayers.slice(currentIndex + 1).find((player) => !isComplete(player, phaseRatings[player.id]))
      || eligiblePlayers.find((player) => !isComplete(player, phaseRatings[player.id]));
    if (next) openPlayer(next.id);
    else {
      setActivePlayerId(null);
      showToast(`${phase.toUpperCase()} sheet complete — lovely.`);
    }
  }

  async function syncMatch() {
    const supabase = getBrowserSupabase();
    if (!supabase || !user) {
      setAuthOpen(true);
      return;
    }
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/football/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token || ""}` },
      });
      const payload = (await response.json()) as { error?: string; fixtureCount?: number; lineupFound?: boolean };
      if (!response.ok) throw new Error(payload.error || "Sync failed");
      localStorage.removeItem(USE_MANUAL_KEY);
      await loadMatch(true);
      showToast(payload.lineupFound ? "Match and lineup are current" : `${payload.fixtureCount || 0} fixtures synced · lineup still pending`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not sync match data");
    } finally {
      setSyncing(false);
    }
  }

  function openSetup() {
    const draft = JSON.parse(JSON.stringify(match)) as MatchData;
    if (!draft.players.length) {
      draft.players = DEMO_MATCH.players.map((player) => ({ ...player }));
      draft.formation = "4–3–3";
    }
    setManualDraft(draft);
    setSetupOpen(true);
  }

  async function saveManualMatch() {
    const kickoff = manualDraft.kickoff || new Date().toISOString();
    const formatted = new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(kickoff));
    const manual: MatchData = {
      ...manualDraft,
      id: manualDraft.id.startsWith("manual-") ? manualDraft.id : `manual-${Date.now()}`,
      date: formatted,
      source: "demo",
      statusShort: manualDraft.statusShort || "NS",
    };
    const supabase = getBrowserSupabase();
    if (user && supabase) {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/matches/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token || ""}`,
        },
        body: JSON.stringify(manual),
      });
      if (response.ok) {
        localStorage.removeItem(USE_MANUAL_KEY);
        localStorage.removeItem(LEGACY_USE_MANUAL_KEY);
        setSetupOpen(false);
        await loadMatch(true);
        showToast("Manual match and lineup saved to your account");
        return;
      }
    }

    localStorage.setItem(MANUAL_MATCH_KEY, JSON.stringify(manual));
    localStorage.setItem(USE_MANUAL_KEY, "true");
    setMatch(manual);
    setMode("manual");
    setSetupOpen(false);
    showToast(user ? "Cloud save failed · kept safely on this device" : "Manual match saved on this device");
  }

  async function returnToLiveMatch() {
    localStorage.removeItem(USE_MANUAL_KEY);
    setSetupOpen(false);
    await loadMatch(true);
    showToast("Back to imported match data");
  }

  function updateDraftPlayer(index: number, field: "name" | "number", value: string) {
    setManualDraft((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => playerIndex === index
        ? { ...player, [field]: field === "number" ? (value ? Number(value) : null) : value, short: field === "name" ? value.split(" ").slice(-1)[0] || "Player" : player.short }
        : player),
    }));
  }

  const buildPosterCanvas = useCallback((featuredPlayerIds: string[] = []) => {
    return buildMatchprintCanvas({
      match,
      phase,
      featuredPlayerIds,
      players: eligiblePlayers.map((player) => ({
        player,
        rating: phaseRatings[player.id],
        halfTimeRating: ratings.ht[player.id],
      })),
    });
  }, [eligiblePlayers, match, phase, phaseRatings, ratings.ht]);

  function refreshPosterPreview(featuredPlayerIds: string[]) {
    const canvas = buildPosterCanvas(featuredPlayerIds);
    if (!canvas) return;
    setPosterLeaderIds(featuredPlayerIds);
    setPosterPreviewUrl(canvas.toDataURL("image/png", 1));
  }

  function choosePosterLeader(slot: number, playerId: string) {
    const next = [...posterLeaderIds];
    const previousSlot = next.indexOf(playerId);
    if (previousSlot >= 0 && previousSlot !== slot) {
      [next[slot], next[previousSlot]] = [next[previousSlot], next[slot]];
    } else {
      next[slot] = playerId;
    }
    refreshPosterPreview(next.filter(Boolean));
  }

  async function posterBlob(featuredPlayerIds = posterLeaderIds) {
    if (!canGeneratePoster) return null;
    const canvas = buildPosterCanvas(featuredPlayerIds);
    if (!canvas) return null;
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  }

  async function downloadPoster() {
    const blob = await posterBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `barcelona-ratings-${phase}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Match poster downloaded");
  }

  function openPosterPreview() {
    if (!canGeneratePoster) {
      showToast(user ? "Matchprint is currently owner-only" : "Sign in as the owner to create a Matchprint");
      if (!user) setAuthOpen(true);
      return;
    }
    const availableIds = new Set(posterCandidates.map(({ player }) => player.id));
    const retained = posterLeaderIds.filter((playerId) => availableIds.has(playerId));
    const defaults = [...retained];
    posterCandidates.forEach(({ player }) => {
      if (defaults.length < 3 && !defaults.includes(player.id)) defaults.push(player.id);
    });
    refreshPosterPreview(defaults.slice(0, 3));
    setPosterOpen(true);
  }

  async function sharePoster() {
    const blob = await posterBlob();
    if (!blob) return;
    const file = new File([blob], `barcelona-ratings-${phase}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "My Barcelona ratings", text: "My match ratings" });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await downloadPoster();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!activePlayer) return;
      if (event.key === "Escape") setActivePlayerId(null);
      if (/^[1-5]$/.test(event.key)) selectScore(activeField, Number(event.key));
      if (event.key === "Enter") openNextPlayer();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const cloudLabel = user ? `Signed in as ${user.email}` : mode === "cloud" ? "Cloud data · sign in" : "Local beta mode";
  const competitionLabel = match.competition === "Manual match" ? "Matchday" : match.competition;
  const draftBarcaIsHome = manualDraft.home.providerId === 529 || manualDraft.away.providerId !== 529;
  const draftOpponent = draftBarcaIsHome ? manualDraft.away : manualDraft.home;
  const draftBarcaScore = draftBarcaIsHome ? manualDraft.homeScore : manualDraft.awayScore;
  const draftOpponentScore = draftBarcaIsHome ? manualDraft.awayScore : manualDraft.homeScore;

  return (
    <>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Nota Blaugrana home">
          <span className="brand-crest" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://media.api-sports.io/football/teams/529.png" alt="" />
            <span>FCB</span>
          </span>
          <span><strong>Nota Blaugrana</strong><small>My Barça ratings</small></span>
        </a>
        <div className="topbar-actions">
          {user && <button className="sync-button" onClick={() => void syncMatch()} disabled={syncing}>{syncing ? "Syncing…" : "Sync match"}</button>}
          <button className="cloud-button" onClick={() => setAuthOpen(true)} title={cloudLabel}>
            <span className={`account-mark ${user ? "is-cloud" : ""}`} aria-hidden="true" />
            <span>{user ? "Cloud saved" : "Sign in"}</span>
          </button>
        </div>
      </header>

      <main id="top" className="app-shell">
        <section className="match-hero" aria-labelledby="matchTitle">
          <div className="match-meta">
            <div className="meta-line">
              <span className="eyebrow">{competitionLabel}</span>
              {match.source !== "cloud" && <span className="source-note">Preview data</span>}
            </div>
            <h1 id="matchTitle">{match.home.name} <span>vs</span> {match.away.name}</h1>
            <p>{match.date}{match.venue ? ` · ${match.venue}` : ""}</p>
            <div className="match-tools">
              <button onClick={openSetup}>Edit details</button>
              {mode === "manual" && <button onClick={() => void returnToLiveMatch()}>Use imported match</button>}
            </div>
          </div>
          <div className="score-lockup" aria-label={`${match.home.name} ${displayScore(match.homeScore)}, ${match.away.name} ${displayScore(match.awayScore)}`}>
            <div className="team team-home">
              <span className="team-badge barca-badge">{teamBadge(match.home, match.home.shortName)}</span>
              <strong>{match.home.shortName}</strong>
            </div>
            <div className="score"><strong>{displayScore(match.homeScore)}</strong><span>{match.statusShort}</span><strong>{displayScore(match.awayScore)}</strong></div>
            <div className="team team-away">
              <span className="team-badge opponent-badge">{teamBadge(match.away, match.away.shortName)}</span>
              <strong>{match.away.shortName}</strong>
            </div>
          </div>
        </section>

        <section className="rating-toolbar" aria-label="Rating controls">
          <div>
            <span className="section-kicker">Rating sheet</span>
            <div className="phase-switch" role="tablist" aria-label="Match phase">
              {(["ht", "ft"] as Phase[]).map((item) => (
                <button key={item} className={`phase-button ${phase === item ? "is-active" : ""}`} onClick={() => { setPhase(item); setActivePlayerId(null); }} role="tab" aria-selected={phase === item}>
                  {item === "ht" ? "Half time" : "Full time"}
                </button>
              ))}
            </div>
            {phase === "ft" && inheritedFullTimeCount > 0 && (
              <p className="phase-note">Half-time scores carried forward · edit only what changed</p>
            )}
          </div>
          <div className="toolbar-progress">
            <div className="progress-copy"><span>{summary.completed} of {eligiblePlayers.length} players complete</span><strong>{summary.percent}%</strong></div>
            <div className="progress-track" aria-hidden="true"><span style={{ width: `${summary.percent}%` }} /></div>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="pitch-card" aria-labelledby="lineupHeading">
            <div className="card-heading">
              <div><span className="section-kicker">Starting XI</span><h2 id="lineupHeading">{starters.length ? "Tap a player to rate" : "Lineup not announced"}</h2></div>
              <span className="formation-chip">{match.formation}</span>
            </div>
            {starters.length ? (
              <div className="pitch-wrap">
                <div className="pitch" aria-label="Barcelona formation">
                  <span className="pitch-marking center-circle" /><span className="pitch-marking center-spot" />
                  <span className="pitch-marking penalty-box top" /><span className="pitch-marking penalty-box bottom" />
                  <span className="pitch-marking goal-box top" /><span className="pitch-marking goal-box bottom" />
                  {starters.map((player) => {
                    const score = phaseRatings[player.id]?.overall;
                    return (
                      <button key={player.id} className={`player-marker ${score ? "is-rated" : ""}`} style={{ left: `${player.x ?? 50}%`, top: `${player.y ?? 50}%` }} onClick={() => openPlayer(player.id)} aria-label={`Rate ${player.name}`}>
                        <span className="player-orb"><span className="player-number">{player.number ?? "·"}</span>{score && <span className="player-rating-pill">{score}</span>}</span>
                        <span className="player-name">{player.short}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="lineup-empty">
                <span>XI</span><h3>Waiting for the official lineup</h3>
                <p>Sync again around an hour before kickoff, or enter the lineup manually so the rating sheet is never blocked.</p>
                <div><button className="primary-button" onClick={() => void syncMatch()} disabled={syncing}>{syncing ? "Checking…" : "Check for lineup"}</button><button className="secondary-button" onClick={openSetup}>Enter manually</button></div>
              </div>
            )}
            <div className="bench-section">
              <div className="bench-heading"><span>Substitutes used</span><small>Tap to rate</small></div>
              <div className="bench-list">
                {substitutes.length ? substitutes.map((player) => {
                  const score = phaseRatings[player.id]?.overall;
                  return (
                    <button key={player.id} className={`bench-player ${score ? "is-rated" : ""}`} onClick={() => openPlayer(player.id)}>
                      <span className="bench-number">{player.number ?? "·"}</span><span className="bench-copy"><strong>{player.short}</strong><small>On {player.minute ?? "—"}&apos; · {player.roleLabel}</small></span><span className="bench-score">{score || "—"}</span>
                    </button>
                  );
                }) : <p className="bench-empty">No substitutions imported yet.</p>}
              </div>
            </div>
          </section>

          <aside className="summary-card" aria-labelledby="summaryHeading">
            <div className="card-heading summary-heading"><div><span className="section-kicker">At a glance</span><h2 id="summaryHeading">My match</h2></div><span className="phase-badge">{phase.toUpperCase()}</span></div>
            <div className="average-panel"><span>Team average</span><strong>{summary.average?.toFixed(1) || "—"}</strong><div className="average-stars" aria-hidden="true">{summary.average ? "★".repeat(Math.round(summary.average)) + "☆".repeat(5 - Math.round(summary.average)) : "☆☆☆☆☆"}</div></div>
            <div className="community-strip"><span>Community</span><strong>{communityAverage?.toFixed(1) || "—"}</strong><small>{communityVotes ? `${communityVotes} player votes` : match.source === "cloud" ? "Be the first to rate" : "Available after cloud setup"}</small></div>
            <div className="insight-grid">
              <article><span>Top performer</span><strong>{summary.rated[0]?.player.short || "Waiting for ratings"}</strong><small>{summary.rated[0] ? `${summary.rated[0].score}.0 / 5 overall` : "Rate a player to begin"}</small></article>
              <article><span>Still to rate</span><strong>{summary.remaining === 1 ? "1 player" : `${summary.remaining} players`}</strong><small>{summary.remaining ? "Complete overall + four details" : "Match sheet complete"}</small></article>
            </div>
            <div className="leaders-block"><div className="leaders-title"><span>MVPs</span><small>Overall rating</small></div><ol className="leaderboard">
              {summary.rated.length ? summary.rated.slice(0, 3).map((item, index) => <li key={item.player.id}><span className="leader-rank">{index + 1}</span><span className="leader-name">{item.player.name}</span><span className="leader-score">{item.score}.0</span></li>) : <li className="leader-empty">Your leaders will appear here.</li>}
            </ol></div>
            {canGeneratePoster ? <div className="summary-actions"><button className="primary-button" onClick={openPosterPreview}><span aria-hidden="true">◇</span>Preview Matchprint</button><button className="secondary-button" onClick={() => void sharePoster()}><span aria-hidden="true">↗</span>Share</button></div>
              : <div className="matchprint-access"><span>{adminCheckComplete ? (user ? "Matchprint is currently owner-only" : "Owner sign-in required for Matchprint") : "Checking Matchprint access…"}</span>{adminCheckComplete && !user && <button onClick={() => setAuthOpen(true)}>Owner sign in</button>}</div>}
            <p className="privacy-note"><span aria-hidden="true">●</span>{user ? saveStatus : `${saveStatus} · Sign in for cross-device sync`}</p>
          </aside>
        </div>
      </main>

      {activePlayer && (
        <>
          <button className="sheet-backdrop" onClick={() => setActivePlayerId(null)} aria-label="Close ratings" />
          <section className="rating-sheet" aria-modal="true" role="dialog" aria-labelledby="sheetPlayerName">
            <div className="sheet-grabber" aria-hidden="true" />
            <button className="sheet-close" onClick={() => setActivePlayerId(null)} aria-label="Close player ratings">×</button>
            <header className="sheet-player"><span className="sheet-avatar">{activePlayer.number ?? "·"}</span><div><h2 id="sheetPlayerName">{activePlayer.name}</h2><p>{activePlayer.roleLabel} · #{activePlayer.number ?? "—"} · {phase === "ht" ? "Half time" : "Full time"}</p>{phase === "ft" && ratings.ht[activePlayer.id] && !ratings.ft[activePlayer.id] && <small className="inherited-note">Using your half-time rating as the starting point</small>}</div></header>
            <p className="sheet-intro">Go with your first instinct. One overall score, then four quick role-specific details.</p>
            {(() => {
              const crowd = phaseCommunity.find((row) => row.player_id === activePlayer.id);
              if (!crowd) return null;
              return <div className="player-community"><span>Community</span><strong>{crowd.overall_average ? Number(crowd.overall_average).toFixed(1) : "—"}</strong><small>{crowd.vote_count} {crowd.vote_count === 1 ? "rating" : "ratings"}</small></div>;
            })()}
            <div className="rating-groups">
              {([["overall", "Overall performance"], ...ratingTemplates[activePlayer.role]] as Array<[string, string]>).map(([field, label], index) => {
                const rating = phaseRatings[activePlayer.id] || blankRating(activePlayer);
                const value = field === "overall" ? rating.overall : rating.attributes[field];
                const crowd = phaseCommunity.find((row) => row.player_id === activePlayer.id);
                const crowdValue = field === "overall" ? crowd?.overall_average : crowd?.attribute_averages?.[field];
                return (
                  <section key={field} className={`rating-group ${index === 0 ? "overall" : ""} ${activeField === field ? "is-active" : ""}`} onPointerDown={() => setActiveField(field)}>
                    <div className="rating-label"><strong>{label}</strong><span>{value ? `${value} · ${scoreDescriptions[value]}` : "Not rated"}{crowdValue ? ` · Crowd ${Number(crowdValue).toFixed(1)}` : ""}</span></div>
                    <div className="score-row" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((score) => <button key={score} className={`score-button ${value === score ? "is-selected" : ""}`} onClick={() => selectScore(field, score)} aria-pressed={value === score}>{score}</button>)}</div>
                  </section>
                );
              })}
            </div>
            <div className="sheet-actions"><button className="clear-player" onClick={() => void clearActivePlayer()}>Clear</button><button className="next-player" onClick={openNextPlayer}>Save & next player →</button></div>
            <p className="sheet-helper">On a keyboard, use 1–5 and Enter to move quickly.</p>
          </section>
        </>
      )}

      {posterOpen && posterPreviewUrl && canGeneratePoster && (
        <>
          <button className="sheet-backdrop" onClick={() => setPosterOpen(false)} aria-label="Close Matchprint preview" />
          <section className="poster-preview" aria-modal="true" role="dialog" aria-labelledby="posterPreviewTitle">
            <header><div><span className="section-kicker">Your match archive</span><h2 id="posterPreviewTitle">Nota Matchprint</h2></div><button className="sheet-close" onClick={() => setPosterOpen(false)} aria-label="Close Matchprint preview">×</button></header>
            {/* The preview is generated entirely from the user's match data; no external image is embedded. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={posterPreviewUrl} alt={`Nota Matchprint for ${match.home.name} versus ${match.away.name}`} />
            {posterCandidates.length > 1 && (
              <div className="poster-leader-picker">
                <div className="poster-leader-intro"><strong>Choose MVP order</strong><span>Use this to break ties.</span></div>
                <div className="poster-leader-selects">
                  {Array.from({ length: Math.min(3, posterCandidates.length) }, (_, slot) => (
                    <label key={slot}>
                      <span>#{slot + 1}</span>
                      <select value={posterLeaderIds[slot] || ""} onChange={(event) => choosePosterLeader(slot, event.target.value)} aria-label={`Cover player ${slot + 1}`}>
                        {posterCandidates.map(({ player, score }) => <option key={player.id} value={player.id}>{player.short || player.name} · {score}/5</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="poster-preview-copy"><strong>NB data signature</strong><span>Its geometry is generated from this match and your ratings.</span></div>
            <footer><button className="primary-button" onClick={() => void downloadPoster()}>Download PNG</button><button className="secondary-button" onClick={() => void sharePoster()}>Share</button></footer>
          </section>
        </>
      )}

      {authOpen && <AuthDialog user={user} onClose={() => setAuthOpen(false)} onToast={showToast} />}

      {setupOpen && (
        <>
          <button className="modal-backdrop" onClick={() => setSetupOpen(false)} aria-label="Close match setup" />
          <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
            <button className="sheet-close" onClick={() => setSetupOpen(false)} aria-label="Close match setup">×</button>
            <span className="section-kicker">API fallback</span><h2 id="setupTitle">Match & lineup setup</h2><p className="setup-intro">Use this if the official lineup has not appeared yet. It stays on this device and can be replaced by imported data at any time.</p>
            <div className="setup-grid">
              <label><span>Opponent</span><input value={draftOpponent.name} onChange={(event) => setManualDraft({ ...manualDraft, [draftBarcaIsHome ? "away" : "home"]: { ...draftOpponent, name: event.target.value, shortName: event.target.value.slice(0, 3).toUpperCase() } })} /></label>
              <label><span>Kickoff</span><input type="datetime-local" value={localDateTimeValue(manualDraft.kickoff)} onChange={(event) => setManualDraft({ ...manualDraft, kickoff: new Date(event.target.value).toISOString() })} /></label>
              <label><span>Venue</span><input value={manualDraft.venue || ""} onChange={(event) => setManualDraft({ ...manualDraft, venue: event.target.value })} /></label>
              <label><span>Status</span><select value={manualDraft.statusShort} onChange={(event) => setManualDraft({ ...manualDraft, statusShort: event.target.value })}><option>NS</option><option>1H</option><option>HT</option><option>2H</option><option>FT</option></select></label>
              <label><span>Barcelona score</span><input type="number" min="0" value={draftBarcaScore ?? ""} onChange={(event) => setManualDraft({ ...manualDraft, [draftBarcaIsHome ? "homeScore" : "awayScore"]: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label><span>Opponent score</span><input type="number" min="0" value={draftOpponentScore ?? ""} onChange={(event) => setManualDraft({ ...manualDraft, [draftBarcaIsHome ? "awayScore" : "homeScore"]: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            </div>
            <div className="lineup-editor"><div><strong>Editable test lineup</strong><small>Names and shirt numbers</small></div>{manualDraft.players.map((player, index) => <label key={player.id}><span>{player.starter ? player.role : "SUB"}</span><input value={player.name} onChange={(event) => updateDraftPlayer(index, "name", event.target.value)} /><input className="number-input" type="number" min="0" value={player.number ?? ""} onChange={(event) => updateDraftPlayer(index, "number", event.target.value)} /></label>)}</div>
            <div className="setup-actions">{mode === "manual" && <button className="secondary-button" onClick={() => void returnToLiveMatch()}>Discard manual version</button>}<button className="primary-button" onClick={() => void saveManualMatch()}>Use this match</button></div>
          </section>
        </>
      )}

      {loading && <div className="loading-pill">Loading match…</div>}
      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}

function AuthDialog({ user, onClose, onToast }: { user: User | null; onClose: () => void; onToast: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = hasSupabaseBrowserConfig();

  async function signIn() {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) onToast(error.message);
    else { onToast("Signed in · ratings will sync"); onClose(); }
  }

  async function signUp() {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    setBusy(false);
    if (error) onToast(error.message);
    else onToast("Account created · check your email if confirmation is enabled");
  }

  async function signOut() {
    const supabase = getBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    onToast("Signed out · local ratings remain here");
    onClose();
  }

  return (
    <>
      <button className="modal-backdrop" onClick={onClose} aria-label="Close account" />
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <button className="sheet-close" onClick={onClose} aria-label="Close account">×</button>
        <span className="section-kicker">Your account</span><h2 id="authTitle">{user ? "Cloud sync is on" : "Keep ratings across devices"}</h2>
        {!configured ? <div className="config-note"><strong>Cloud setup is not connected yet.</strong><p>Add the Supabase URL and publishable key from the included setup guide. The app continues to save locally until then.</p></div>
          : user ? <><div className="signed-in-card"><span className="status-dot is-cloud" /><div><strong>{user.email}</strong><small>Private ratings sync to Supabase</small></div></div><button className="secondary-button full-button" onClick={() => void signOut()}>Sign out</button></>
          : <><div className="auth-fields"><label><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label><span>Password</span><input type="password" minLength={6} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div><div className="auth-actions"><button className="secondary-button" onClick={() => void signUp()} disabled={busy || !email || password.length < 6}>Create account</button><button className="primary-button" onClick={() => void signIn()} disabled={busy || !email || !password}>{busy ? "Working…" : "Sign in"}</button></div></>}
        <p className="privacy-note"><span aria-hidden="true">●</span>Your individual ratings are protected by database row-level security.</p>
      </section>
    </>
  );
}
