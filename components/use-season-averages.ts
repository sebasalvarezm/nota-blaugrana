"use client";
import { useEffect, useState } from "react";
import type { MatchData } from "@/lib/types";
import { localSeasonAverages, type SeasonAverage } from "@/lib/season";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export function useSeasonAverages(match: MatchData, scope: string, enabled: boolean) {
  const key = `${scope}:${match.id}`;
  const [state, setState] = useState<{ key: string; averages: Record<string, SeasonAverage>; unavailable: boolean }>({ key: "", averages: {}, unavailable: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    async function load() {
      const supabase = getBrowserSupabase();
      if (!supabase || scope === "guest" || match.source !== "cloud") {
        let averages = {};
        try { averages = localSeasonAverages(localStorage, scope, match); } catch { /* Storage is optional for guests. */ }
        if (!cancelled) setState({ key, averages, unavailable: false });
        return;
      }
      try {
        const { data, error } = await supabase.rpc("personal_season_averages", { expected_user_id: scope, target_match_id: match.id }).abortSignal(controller.signal);
        if (error) throw error;
        const averages = Object.fromEntries((data || []).map((row: { player_id: string; average: number; match_count: number; includes_converted: boolean }) =>
          [row.player_id, { average: Number(row.average), matches: Number(row.match_count), includesConverted: row.includes_converted }]));
        if (!cancelled) setState({ key, averages, unavailable: false });
      } catch { if (!cancelled) setState({ key, averages: {}, unavailable: true }); }
      finally { clearTimeout(timer); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [key, scope, enabled, match]);
  return state.key === key ? { ...state, loading: false } : { key, averages: {}, unavailable: false, loading: enabled };
}
