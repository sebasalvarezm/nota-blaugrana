"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchData, Phase, PlayerRating, RatingsState } from "@/lib/types";
import { emptyRatings, normalizeRatings } from "@/lib/ratings";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { mergeAccountRatings, pendingKey, ratingKey, readStoredRatings, type PendingRating, type StoredRatings } from "@/lib/rating-storage";

type View = { scope: string; matchId: string; ratings: RatingsState; ready: boolean; status: string; pending: number; canRestore: boolean; conflict: boolean };
type Store = {
  scope: string; match: MatchData; ratings: RatingsState; pending: Record<string, PendingRating>;
  ready: boolean; cloudReady: boolean; busy: boolean; disposed: boolean; revision: number;
  failures: number; conflict: boolean; status: string; canRestore: boolean; canPersist: boolean;
  timer?: ReturnType<typeof setTimeout>;
  publish: () => void; pump: () => Promise<void>; hydrate: (keepDevice?: boolean) => Promise<void>;
};
const initial: View = { scope: "", matchId: "", ratings: emptyRatings(), ready: false, status: "Loading your ratings…", pending: 0, canRestore: false, conflict: false };

export function useRatingStore(match: MatchData, scope: string, enabled: boolean) {
  const [view, setView] = useState<View>(initial);
  const current = useRef<Store | null>(null);
  const matchInfo = useRef(match);
  useEffect(() => {
    matchInfo.current = match;
    queueMicrotask(() => {
      const store = current.current;
      if (store && !store.disposed && store.match.id === match.id) { store.match = match; if (store.ready) store.publish(); }
    });
  }, [match]);

  useEffect(() => {
    if (!enabled) return;
    const selected = matchInfo.current;
    const supabase = getBrowserSupabase();
    const cloud = scope !== "guest" && selected.source === "cloud" && Boolean(supabase);
    const store: Store = {
      scope, match: selected, ratings: emptyRatings(), pending: {}, ready: false, cloudReady: !cloud,
      busy: false, disposed: false, revision: Date.now(), failures: 0, conflict: false,
      status: "Loading your ratings…", canRestore: false, canPersist: true, publish: () => {}, pump: async () => {}, hydrate: async () => {},
    };
    current.current = store;
    const alive = () => !store.disposed && current.current === store;
    const legacy = () => {
      const guest = scope === "guest" ? null : localStorage.getItem(ratingKey("guest", selected.id));
      const old = localStorage.getItem(`nota-blaugrana-ratings-v1:${selected.id}`)
        || localStorage.getItem(`matchday-five-ratings-v2:${selected.id}`);
      const older = old ? normalizeRatings(JSON.parse(old), 5) : emptyRatings();
      const newer = guest ? readStoredRatings(guest).ratings : emptyRatings();
      return { ht: { ...older.ht, ...newer.ht }, ft: { ...older.ft, ...newer.ft } };
    };
    store.publish = () => {
      if (!alive()) return;
      const record: StoredRatings = { version: 3, scale: 10, ratings: store.ratings, pending: store.pending, match: { id: store.match.id, kickoff: store.match.kickoff, status: store.match.status, source: store.match.source } };
      try {
        if (!store.canPersist) throw new Error("Original copy needs recovery");
        localStorage.setItem(ratingKey(scope, selected.id), JSON.stringify(record));
      } catch { store.status = "Device storage is unavailable. Keep this page open."; }
      try {
        const previous = legacy();
        store.canRestore = (["ht", "ft"] as Phase[]).some((phase) => Object.keys(previous[phase]).some((id) => !store.ratings[phase][id] && !store.pending[pendingKey(phase, id)]));
      } catch { store.canRestore = false; }
      setView({ scope, matchId: selected.id, ratings: { ht: { ...store.ratings.ht }, ft: { ...store.ratings.ft } }, ready: store.ready, status: store.status, pending: Object.keys(store.pending).length, canRestore: store.canRestore, conflict: store.conflict });
    };
    store.pump = async () => {
      if (!alive() || !cloud || !supabase || !store.cloudReady || store.busy || store.conflict || store.failures >= 3) return;
      const item = Object.values(store.pending)[0];
      if (!item) { store.status = "Saved to your account"; store.publish(); return; }
      store.busy = true;
      store.status = "Saved here · syncing…";
      store.publish();
      try {
        const { data, error } = await supabase.rpc("save_player_rating", {
          expected_user_id: scope, target_match_id: selected.id, target_player_id: item.playerId, target_phase: item.phase,
          overall_score: item.rating?.overall ?? null,
          attribute_scores: Object.fromEntries(Object.entries(item.rating?.attributes || {}).filter(([, value]) => value != null)),
          write_version: 10, expected_updated_at: item.expectedUpdatedAt, clear_rating: item.rating === null,
          legacy_conversion: Boolean(item.rating?.convertedFromFive),
        }).abortSignal(AbortSignal.timeout(12_000));
        if (!alive()) return;
        if (error) {
          store.conflict = error.code === "40001";
          throw error;
        }
        const key = pendingKey(item.phase, item.playerId);
        const latest = store.pending[key];
        if (latest?.revision === item.revision) delete store.pending[key];
        else if (latest) latest.expectedUpdatedAt = typeof data === "string" ? data : null;
        if (store.ratings[item.phase][item.playerId]) {
          store.ratings[item.phase][item.playerId] = { ...store.ratings[item.phase][item.playerId], updatedAt: typeof data === "string" ? data : undefined };
        }
        store.failures = 0;
        store.status = Object.keys(store.pending).length ? "Saved here · syncing…" : "Saved to your account";
      } catch {
        if (!alive()) return;
        store.failures += 1;
        store.status = store.conflict ? "A rating changed on another device. Your edits are safe here." : "Saved here · account sync needs a retry";
      } finally {
        store.busy = false;
        if (alive()) {
          store.publish();
          if (Object.keys(store.pending).length && !store.conflict && store.failures < 3) {
            store.timer = setTimeout(() => void store.pump(), store.failures ? 1500 * 2 ** store.failures : 100);
          }
        }
      }
    };
    store.hydrate = async (keepDevice = false) => {
      if (!cloud || !supabase || !alive()) return;
      try {
        const { data, error } = await supabase.from("ratings").select("player_id, phase, overall, attributes, updated_at, converted_from_five")
          .eq("match_id", selected.id).eq("user_id", scope).abortSignal(AbortSignal.timeout(12_000));
        if (!alive()) return;
        if (error) throw error;
        const remote = emptyRatings();
        for (const row of data || []) {
          remote[row.phase as Phase][row.player_id] = { overall: row.overall == null ? null : Number(row.overall), attributes: row.attributes || {}, updatedAt: row.updated_at, convertedFromFive: row.converted_from_five };
        }
        if (keepDevice) {
          for (const item of Object.values(store.pending)) item.expectedUpdatedAt = remote[item.phase][item.playerId]?.updatedAt || null;
          store.conflict = false;
        }
        store.ratings = mergeAccountRatings(store.ratings, remote, store.pending);
        store.cloudReady = true;
        store.failures = 0;
        store.status = Object.keys(store.pending).length ? "Saved here · syncing…" : "Saved to your account";
        store.publish();
        void store.pump();
      } catch {
        if (alive()) { store.status = "Saved here · account connection unavailable"; store.publish(); }
      }
    };
    queueMicrotask(() => {
      if (!alive()) return;
      try {
        const local = readStoredRatings(localStorage.getItem(ratingKey(scope, selected.id)));
        store.ratings = local.ratings;
        store.pending = local.pending;
        store.status = "Saved on this device";
      } catch {
        try {
          const raw = localStorage.getItem(ratingKey(scope, selected.id));
          if (raw) localStorage.setItem(`${ratingKey(scope, selected.id)}:backup:${Date.now()}`, raw);
        } catch { store.canPersist = false; }
        store.status = "Saved ratings could not be read. The original copy is preserved.";
      }
      store.ready = true;
      store.publish();
      void store.hydrate();
    });
    const retry = () => {
      if (!alive() || store.conflict) return;
      store.failures = 0;
      if (store.cloudReady) void store.pump(); else void store.hydrate();
    };
    window.addEventListener("online", retry);
    return () => { store.disposed = true; clearTimeout(store.timer); window.removeEventListener("online", retry); };
  }, [match.id, scope, enabled]);

  function update(phase: Phase, playerId: string, rating: PlayerRating | null) {
    const store = current.current;
    if (!store || store.disposed || !store.ready || store.scope !== scope || store.match.id !== match.id) return;
    const existing = store.ratings[phase][playerId];
    const key = pendingKey(phase, playerId);
    const expectedUpdatedAt = store.pending[key]?.expectedUpdatedAt ?? existing?.updatedAt ?? null;
    if (rating) store.ratings[phase][playerId] = { ...rating, updatedAt: existing?.updatedAt };
    else delete store.ratings[phase][playerId];
    if (scope !== "guest" && match.source === "cloud") {
      store.pending[key] = { phase, playerId, rating, expectedUpdatedAt, revision: ++store.revision };
    }
    store.status = "Saved on this device";
    store.failures = 0;
    store.publish();
    clearTimeout(store.timer);
    store.timer = setTimeout(() => void store.pump(), 600);
  }

  function restore() {
    const store = current.current;
    if (!store || store.disposed || store.scope !== scope || store.match.id !== match.id) return;
    try {
      const guest = scope === "guest" ? null : localStorage.getItem(ratingKey("guest", match.id));
      const old = localStorage.getItem(`nota-blaugrana-ratings-v1:${match.id}`) || localStorage.getItem(`matchday-five-ratings-v2:${match.id}`);
      const older = old ? normalizeRatings(JSON.parse(old), 5) : emptyRatings();
      const newer = guest ? readStoredRatings(guest).ratings : emptyRatings();
      const previous = { ht: { ...older.ht, ...newer.ht }, ft: { ...older.ft, ...newer.ft } };
      const eligible = new Set(match.players.map((player) => player.id));
      for (const phase of ["ht", "ft"] as Phase[]) for (const [id, rating] of Object.entries(previous[phase])) {
        if (eligible.has(id) && !store.ratings[phase][id] && !store.pending[pendingKey(phase, id)]) update(phase, id, rating);
      }
    } catch { store.status = "The earlier copy could not be read. It has been preserved."; store.publish(); }
  }

  function retry(keepDevice = false) {
    const store = current.current;
    if (!store || store.disposed || store.scope !== scope || store.match.id !== match.id) return;
    store.failures = 0;
    if (keepDevice || !store.cloudReady) void store.hydrate(keepDevice);
    else void store.pump();
  }

  const visible = view.scope === scope && view.matchId === match.id && enabled ? view : initial;
  return { ...visible, update, restore, retry };
}
