import type { MatchData, Phase, Player, PlayerRating } from "@/lib/types";
import { contributionLabel, contributionsFor } from "@/lib/match-events";
import { averageRating, formatRating, ratingBand, RATING_COLORS } from "@/lib/ratings";
import { selectMvpIds } from "@/lib/mvps";
import { playerName } from "@/lib/player-names";
import { seasonComparison, seasonLabel, type SeasonAverage } from "@/lib/season";

export type MatchprintPlayer = { player: Player; rating?: PlayerRating; halfTimeRating?: PlayerRating; seasonAverage?: SeasonAverage };
export type MatchprintInput = { match: MatchData; phase: Phase; players: MatchprintPlayer[]; featuredPlayerIds?: string[]; seasonUnavailable?: boolean };
const INK = "#10243b";
const MUTED = "#536276";
const PAPER = "#f5f2ea";
const FONT = '"Segoe UI", Arial, sans-serif';

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 20, color = INK, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.strokeStyle = "#d6dbe0"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, radius = 12) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}
function fittedText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, size = 22, color = INK, weight = 600) {
  let fitted = size;
  ctx.font = `${weight} ${fitted}px ${FONT}`;
  while (fitted > 14 && ctx.measureText(value).width > maxWidth) { fitted -= 1; ctx.font = `${weight} ${fitted}px ${FONT}`; }
  ctx.fillStyle = color; ctx.fillText(value, x, y, maxWidth);
}
function nameLines(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, width: number, size = 22) {
  const words = playerName(name).split(" ");
  let lines: string[] = [];
  for (let font = size; font >= 15; font--) {
    ctx.font = `600 ${font}px ${FONT}`;
    lines = [""];
    for (const word of words) {
      const next = `${lines[lines.length - 1]} ${word}`.trim();
      if (ctx.measureText(next).width > width && lines[lines.length - 1]) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    if (lines.length <= 2 || font === 15) {
      lines.slice(0, 3).forEach((value, index) => fittedText(ctx, value, x, y + index * (font + 2), width, font));
      break;
    }
  }
}
function badge(ctx: CanvasRenderingContext2D, value: number | null | undefined, x: number, y: number, large = false) {
  const colors = RATING_COLORS[ratingBand(value)];
  const width = large ? 86 : 65;
  const height = large ? 51 : 35;
  panel(ctx, x, y, width, height, colors.background, 7);
  ctx.textAlign = "center";
  text(ctx, formatRating(value), x + width / 2, y + (large ? 36 : 25), large ? 32 : 23, colors.foreground, 600);
  ctx.textAlign = "left";
}
function jersey(ctx: CanvasRenderingContext2D, player: Player, x: number, y: number) {
  // Draw directly into the PNG: no remote kit images, loading race or CORS.
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(-25, 0); ctx.quadraticCurveTo(0, 17, 25, 0);
  ctx.lineTo(65, 24); ctx.lineTo(48, 63); ctx.lineTo(32, 55); ctx.lineTo(30, 141);
  ctx.quadraticCurveTo(0, 149, -30, 141); ctx.lineTo(-32, 55); ctx.lineTo(-48, 63); ctx.lineTo(-65, 24); ctx.closePath();
  ctx.save(); ctx.clip();
  ctx.fillStyle = player.role === "GK" ? "#216b62" : "#15539a"; ctx.fillRect(-70, 0, 140, 150);
  ctx.fillStyle = player.role === "GK" ? "#174c49" : "#982849";
  for (let stripe = -54; stripe < 70; stripe += 36) ctx.fillRect(stripe, 0, 18, 150);
  ctx.restore(); ctx.strokeStyle = "#10243b"; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = "center";
  fittedText(ctx, playerName(player.name).split(" ").at(-1)?.toUpperCase() || "BARÇA", 0, 49, 65, 14, "#fff0b1", 600);
  ctx.font = `600 49px ${FONT}`; ctx.lineWidth = 3; ctx.strokeStyle = "#10243b";
  ctx.strokeText(player.number == null ? "—" : String(player.number), 0, 107);
  text(ctx, player.number == null ? "—" : String(player.number), 0, 107, 49, "#fff0b1", 600);
  ctx.restore();
}
function signature(input: MatchprintInput) {
  const payload = JSON.stringify([input.match.id, input.phase, input.featuredPlayerIds, input.match.homeScore, input.match.awayScore, input.match.events, input.players.map(({ player, rating, seasonAverage }) => [player.id, rating?.overall, rating?.attributes, seasonAverage])]);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index++) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

export function buildMatchprintCanvas(input: MatchprintInput) {
  const { match, phase, players, seasonUnavailable = false } = input;
  const canvas = document.createElement("canvas");
  const rows = Math.ceil(players.length / 2);
  canvas.width = 1080;
  canvas.height = Math.max(1474, 724 + rows * 78 + 125);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const contributions = match.eventsAvailable === false ? {} : contributionsFor(match.events, phase);
  const rated = players.filter((item) => item.rating?.overall != null).sort((a, b) => (b.rating?.overall || 0) - (a.rating?.overall || 0) || a.player.name.localeCompare(b.player.name));
  const leaders = selectMvpIds(rated.map(item=>({id:item.player.id,name:item.player.name,score:item.rating!.overall!})), input.featuredPlayerIds).map(id=>rated.find(item=>item.player.id===id)!);
  const average = averageRating(rated.map((item) => item.rating?.overall));
  const label = phase === "ht" ? "HALF TIME" : match.status === "finished" ? `FULL TIME${["AET", "PEN"].includes(match.statusShort) ? ` · ${match.statusShort}` : ""}` : "FT RATINGS · IN PROGRESS";
  const matchScore = phase === "ht" ? [match.halftimeHomeScore, match.halftimeAwayScore] : [match.homeScore, match.awayScore];
  const contextFor = (item: MatchprintPlayer) => {
    const ga = contributionLabel(contributions[item.player.id]);
    const comparison = phase === "ft" ? seasonUnavailable ? "" : seasonComparison(item.rating?.overall, item.seasonAverage) : "";
    return [ga, comparison].filter(Boolean).join("   ·   ");
  };

  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#091d33"; ctx.fillRect(0, 0, 1080, 278);
  ctx.fillStyle = "#2867ac"; ctx.fillRect(0, 0, 540, 7);
  ctx.fillStyle = "#a6224a"; ctx.fillRect(540, 0, 540, 7);
  text(ctx, "NOTA BLAUGRANA", 64, 63, 25, "#f4f6fb", 600);
  ctx.textAlign = "right"; text(ctx, label, 1016, 62, 18, "#e2bd69", 600); ctx.textAlign = "left";
  fittedText(ctx, match.home.name, 64, 132, 630, 43, "#f4f6fb");
  fittedText(ctx, `vs ${match.away.name}`, 64, 186, 630, 37, "#c1d0e3", 500);
  ctx.textAlign = "right";
  text(ctx, `${matchScore[0] ?? "—"} : ${matchScore[1] ?? "—"}`, 1016, 165, 76, "#f4f6fb", 600);
  text(ctx, phase === "ht" && matchScore.some((score) => score == null) ? "HT score unavailable" : "MATCH SCORE", 1016, 199, 14, "#b5c5d9");
  ctx.textAlign = "left";
  fittedText(ctx, `${match.competition} · ${match.date}`, 64, 245, 952, 19, "#b5c5d9", 400);

  text(ctx, "MY MVPs", 64, 321, 21, INK, 600);
  ctx.textAlign = "right"; text(ctx, `TEAM ${formatRating(average)} / 10`, 1016, 321, 20, INK, 600); ctx.textAlign = "left";
  [64, 390, 716].forEach((x, index) => {
    const item = leaders[index];
    panel(ctx, x, 346, 300, 300, "#fffdf8");
    text(ctx, `0${index + 1}`, x + 18, 376, 15, "#836413", 600);
    if (!item) { text(ctx, "Awaiting a rating", x + 18, 418, 21, MUTED); return; }
    nameLines(ctx, item.player.name, x + 54, 377, 226, 23);
    jersey(ctx, item.player, x + 91, 413);
    badge(ctx, item.rating?.overall, x + 192, 438, true);
    fittedText(ctx, contributionLabel(contributions[item.player.id]) || item.player.roleLabel, x + 18, 594, 264, 21, INK, 600);
    if (phase === "ft") fittedText(ctx, seasonUnavailable ? "" : seasonComparison(item.rating?.overall, item.seasonAverage), x + 18, 625, 264, 17, MUTED, 400);
    else text(ctx, "First-half performance", x + 18, 625, 17, MUTED, 400);
  });

  text(ctx, "PLAYER RATINGS", 64, 697, 21, INK, 600);
  ctx.textAlign = "right"; text(ctx, `${rated.length} / ${players.length} rated${rated.length < players.length ? " · PARTIAL SHEET" : ""}`, 1016, 697, 17, MUTED); ctx.textAlign = "left";
  const list = [...players].sort((a, b) => Number(b.player.starter) - Number(a.player.starter) || (a.player.number ?? 99) - (b.player.number ?? 99));
  list.forEach((item, index) => {
    const column = index < rows ? 0 : 1;
    const row = index % rows;
    const x = column ? 556 : 64;
    const y = 723 + row * 78;
    text(ctx, item.player.number == null ? "—" : String(item.player.number).padStart(2, "0"), x, y + 24, 17, MUTED);
    nameLines(ctx, item.player.name, x + 40, y + 24, 320, 22);
    badge(ctx, item.rating?.overall, x + 395, y + 5);
    fittedText(ctx, contextFor(item) || (item.player.starter ? item.player.roleLabel : `Substitute · on ${item.player.minute ?? "—"}′`), x + 40, y + 62, 420, 15, MUTED, 400);
    line(ctx, x, y + 75, 460);
  });

  const bottom = canvas.height - 97;
  line(ctx, 64, bottom - 13, 952);
  const includesConverted = players.some((item) => item.seasonAverage?.includesConverted || item.rating?.convertedFromFive);
  fittedText(ctx, phase === "ft" ? `${seasonLabel(match.kickoff)} · Personal season averages · Completed FT ratings${includesConverted ? " · Includes converted /5 history" : ""}` : "First-half goals and assists only, including stoppage time.", 64, bottom + 14, 952, 16, MUTED, 400);
  fittedText(ctx, `Goals & assists${seasonUnavailable && phase === "ft" ? " · Season averages unavailable" : ""}${match.eventsAvailable === false ? " · Event data unavailable" : ""}${match.source === "demo" ? " · EXAMPLE DATA" : ""}`, 64, bottom + 43, 750, 16, MUTED, 400);
  text(ctx, "Independent fan ratings · not an official club rating", 64, bottom + 74, 15, MUTED, 400);
  ctx.textAlign = "right"; text(ctx, `NB–${signature(input)}`, 1016, bottom + 73, 15, INK, 600); ctx.textAlign = "left";
  return canvas;
}
