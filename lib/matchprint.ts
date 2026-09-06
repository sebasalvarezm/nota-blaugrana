import type { MatchData, Phase, Player, PlayerRating } from "@/lib/types";

export type MatchprintPlayer = {
  player: Player;
  rating?: PlayerRating;
  halfTimeRating?: PlayerRating;
};

type MatchprintInput = {
  match: MatchData;
  phase: Phase;
  players: MatchprintPlayer[];
  featuredPlayerIds?: string[];
};

const COLORS = {
  paper: "#eee8da",
  ink: "#07182b",
  blue: "#19558f",
  blueLight: "#79aace",
  garnet: "#981d42",
  garnetLight: "#ca526c",
  gold: "#d6a817",
  quiet: "#706f69",
};

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function scoreLabel(score: number | null) {
  return score == null ? "–" : String(score);
}

function scoreOf(rating?: PlayerRating) {
  return rating?.overall ?? null;
}

function attributeAverage(rating?: PlayerRating) {
  const values = Object.values(rating?.attributes || {}).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : rating?.overall ?? 0;
}

function fitSans(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, weight = 750) {
  let size = startSize;
  ctx.font = `${weight} ${size}px Manrope, "Segoe UI", Arial, sans-serif`;
  while (size > 11 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px Manrope, "Segoe UI", Arial, sans-serif`;
  }
  return size;
}

function fitSerif(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, style = "700") {
  let size = startSize;
  while (size > 17) {
    ctx.font = `${style} ${size}px Georgia, "Times New Roman", serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function trackedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  let cursor = x;
  for (const character of text) {
    ctx.fillText(character, cursor, y);
    cursor += ctx.measureText(character).width + spacing;
  }
}

function ratingPayload(players: MatchprintPlayer[]) {
  return players.map(({ player, rating }) => [
    player.id,
    rating?.overall ?? 0,
    ...Object.entries(rating?.attributes || {}).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value ?? 0),
  ].join(":"));
}

function metallicGold(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, "#76520a");
  gradient.addColorStop(0.18, "#e2bd45");
  gradient.addColorStop(0.38, "#fff0a6");
  gradient.addColorStop(0.52, "#b77f08");
  gradient.addColorStop(0.72, "#f4d86c");
  gradient.addColorStop(1, "#825b0c");
  return gradient;
}

function drawMatchprint(ctx: CanvasRenderingContext2D, players: MatchprintPlayer[], seed: number) {
  const random = randomFrom(seed);
  const centerX = 770;
  const centerY = 409;
  const ratedPlayers = players.filter(({ rating }) => scoreOf(rating) != null);
  const source = ratedPlayers.length ? ratedPlayers : players.slice(0, 11);
  const count = Math.max(source.length, 9);

  ctx.save();
  ctx.beginPath();
  ctx.rect(38, 184, 1004, 472);
  ctx.clip();
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(38, 184, 1004, 472);

  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = COLORS.paper;
  for (let radius = 128; radius <= 418; radius += 72) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI * 0.92, Math.PI * 2.14);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let index = 0; index < count; index += 1) {
    const item = source[index % source.length];
    const overall = scoreOf(item?.rating) ?? 2.5;
    const detail = attributeAverage(item?.rating) || overall;
    const angle = -Math.PI * 0.84 + (index / Math.max(count - 1, 1)) * Math.PI * 1.66;
    const jitter = (random() - 0.5) * 0.13;
    const inner = 68 + detail * 7;
    const outer = 214 + overall * 38 + random() * 29;
    const width = 13 + detail * 4;
    const colorCycle = [COLORS.blue, COLORS.garnet, COLORS.gold, COLORS.blueLight, COLORS.garnetLight];
    const startX = centerX + Math.cos(angle + jitter) * inner;
    const startY = centerY + Math.sin(angle + jitter) * inner;
    const endX = centerX + Math.cos(angle - jitter * 0.35) * outer;
    const endY = centerY + Math.sin(angle - jitter * 0.35) * outer;
    const bend = (random() - 0.5) * 94 + (detail - 3) * 20;

    ctx.strokeStyle = index % 5 === 2 ? metallicGold(ctx, startX, startY, endX - startX, endY - startY) : colorCycle[index % colorCycle.length];
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo((startX + endX) / 2 + bend, (startY + endY) / 2 - bend * 0.42, endX, endY);
    ctx.stroke();

    ctx.fillStyle = COLORS.paper;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(endX, endY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.translate(centerX, centerY);
  ctx.rotate((seed % 360) * Math.PI / 180);
  ctx.strokeStyle = metallicGold(ctx, -112, -112, 224, 224);
  ctx.lineWidth = 8;
  ctx.setLineDash([25, 13, 8, 15]);
  ctx.beginPath();
  ctx.arc(0, 0, 109, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawEditionCorner(ctx: CanvasRenderingContext2D, phase: Phase) {
  const x = 774;
  const y = 38;
  const width = 268;
  const height = 112;
  ctx.fillStyle = metallicGold(ctx, x, y, width, height);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + 30, y + height);
  ctx.lineTo(x, y + height - 30);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.56)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 17, y + 11);
  ctx.lineTo(x + width - 14, y + 11);
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.font = '760 15px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText(phase === "ht" ? "INTERVAL EDITION" : "FINAL EDITION", x + 31, y + 47);
  ctx.font = '700 12px "DM Sans", "Segoe UI", Arial, sans-serif';
  ctx.fillText(phase === "ht" ? "NOT FINAL · 45 MINUTES" : "FULL-TIME RATINGS", x + 31, y + 76);
}

function jerseyPath(ctx: CanvasRenderingContext2D, centerX: number, top: number, scale: number) {
  ctx.beginPath();
  ctx.moveTo(centerX - 42 * scale, top + 15 * scale);
  ctx.quadraticCurveTo(centerX, top + 38 * scale, centerX + 42 * scale, top + 15 * scale);
  ctx.lineTo(centerX + 103 * scale, top + 51 * scale);
  ctx.lineTo(centerX + 76 * scale, top + 111 * scale);
  ctx.lineTo(centerX + 53 * scale, top + 101 * scale);
  ctx.lineTo(centerX + 49 * scale, top + 224 * scale);
  ctx.quadraticCurveTo(centerX, top + 239 * scale, centerX - 49 * scale, top + 224 * scale);
  ctx.lineTo(centerX - 53 * scale, top + 101 * scale);
  ctx.lineTo(centerX - 76 * scale, top + 111 * scale);
  ctx.lineTo(centerX - 103 * scale, top + 51 * scale);
  ctx.closePath();
}

function drawJersey(ctx: CanvasRenderingContext2D, item: MatchprintPlayer | undefined, rank: number, centerX: number, top: number) {
  const scale = 0.84;
  const darkBlue = "#071f43";
  const brightBlue = "#246ba8";
  const deepGarnet = "#92183c";
  const mineralYellow = "#e7c64a";
  ctx.save();
  jerseyPath(ctx, centerX, top, scale);
  ctx.clip();
  if (item) {
    const stripeWidth = 31;
    [darkBlue, brightBlue, deepGarnet, darkBlue, deepGarnet, brightBlue, darkBlue].forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(centerX - 109 + index * stripeWidth, top, stripeWidth + 1, 212);
    });
  } else {
    ctx.fillStyle = "rgba(7,24,43,.055)";
    ctx.fillRect(centerX - 100, top, 200, 212);
  }

  if (item) {
    const shine = ctx.createLinearGradient(centerX - 80, top + 5, centerX + 78, top + 210);
    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(0.38, "rgba(255,255,255,.2)");
    shine.addColorStop(0.51, "rgba(255,255,255,.025)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(centerX - 110, top, 220, 215);
  }
  ctx.restore();

  jerseyPath(ctx, centerX, top, scale);
  ctx.strokeStyle = item ? "#04172f" : "rgba(7,24,43,.18)";
  ctx.lineWidth = item ? 5 : 2;
  ctx.stroke();

  ctx.strokeStyle = item ? "#06182f" : "rgba(7,24,43,.13)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(centerX, top + 14, 23, 0.08 * Math.PI, 0.92 * Math.PI);
  ctx.stroke();

  if (item) {
    ctx.strokeStyle = "#06182f";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(centerX - 86, top + 50);
    ctx.lineTo(centerX - 65, top + 91);
    ctx.moveTo(centerX + 86, top + 50);
    ctx.lineTo(centerX + 65, top + 91);
    ctx.stroke();

    for (let index = 0; index < 5; index += 1) {
      ctx.fillStyle = index % 2 ? "#a91f3f" : mineralYellow;
      ctx.fillRect(centerX - 12.5 + index * 5, top + 29, 5, 5);
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = item ? mineralYellow : "rgba(7,24,43,.24)";
  ctx.font = '780 14px Manrope, "Segoe UI", Arial, sans-serif';
  const surname = item?.player.short.toUpperCase().slice(0, 13) || "YOUR PICK";
  ctx.strokeStyle = item ? "rgba(2,14,30,.8)" : "transparent";
  ctx.lineWidth = 4;
  if (item) ctx.strokeText(surname, centerX, top + 75);
  ctx.fillText(surname, centerX, top + 75);
  ctx.font = '860 73px Manrope, "Segoe UI", Arial, sans-serif';
  const shirtNumber = item?.player.number == null ? "—" : String(item.player.number);
  if (item) ctx.strokeText(shirtNumber, centerX, top + 151);
  ctx.fillText(shirtNumber, centerX, top + 151);

  ctx.fillStyle = item ? mineralYellow : "rgba(7,24,43,.2)";
  ctx.font = '730 8px Manrope, "Segoe UI", Arial, sans-serif';
  trackedText(ctx, item ? "BARÇA" : "", centerX - 16, top + 177, 0.4);

  ctx.fillStyle = metallicGold(ctx, centerX - 44, top + 188, 88, 40);
  ctx.beginPath();
  ctx.roundRect(centerX - 43, top + 188, 86, 37, 19);
  ctx.fill();
  ctx.fillStyle = COLORS.ink;
  ctx.font = '820 18px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText(item ? Number(scoreOf(item.rating)).toFixed(1) : "N/A", centerX, top + 213);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '720 16px Manrope, "Segoe UI", Arial, sans-serif';
  fitSans(ctx, item?.player.name || `MVP ${rank}`, 220, 16, 720);
  ctx.fillText(item ? `#${rank}  ${item.player.name}` : `MVP ${rank}`, centerX, top + 251);
  ctx.textAlign = "left";
}

function drawSquadRatings(
  ctx: CanvasRenderingContext2D,
  players: MatchprintPlayer[],
  leaders: MatchprintPlayer[],
  average: number | null,
) {
  const leaderIds = new Set(leaders.map(({ player }) => player.id));
  const squad = players.filter(({ player }) => !leaderIds.has(player.id));
  const columns = 2;
  const rows = Math.max(1, Math.ceil(squad.length / columns));
  const rowHeight = Math.min(31, 192 / rows);
  const columnX = [104, 555];

  ctx.fillStyle = COLORS.ink;
  ctx.font = '820 19px Manrope, "Segoe UI", Arial, sans-serif';
  trackedText(ctx, "SQUAD RATINGS", 104, 1062, 1.4);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.quiet;
  ctx.font = '680 13px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText(`TEAM ${average?.toFixed(1) || "N/A"}`, 1006, 1061);
  ctx.textAlign = "left";

  squad.forEach((item, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = columnX[column];
    const y = 1094 + row * rowHeight;
    const score = scoreOf(item.rating);
    const name = item.player.short || item.player.name;

    ctx.fillStyle = COLORS.quiet;
    ctx.font = '650 12px Manrope, "Segoe UI", Arial, sans-serif';
    ctx.fillText(item.player.number == null ? "—" : String(item.player.number).padStart(2, "0"), x, y);
    ctx.fillStyle = COLORS.ink;
    fitSans(ctx, name, 250, 16, 670);
    ctx.fillText(name, x + 38, y);

    ctx.textAlign = "right";
    ctx.fillStyle = score != null && score >= 4 ? COLORS.gold : score == null ? COLORS.quiet : COLORS.ink;
    ctx.font = `${score != null && score >= 4 ? 780 : 680} 15px Manrope, "Segoe UI", Arial, sans-serif`;
    ctx.fillText(score == null ? "N/A" : score.toFixed(1), x + 397, y);
    ctx.textAlign = "left";
    if (score != null && score >= 4) drawSmallStar(ctx, x + 350, y - 5, 6);
  });
}

function chooseLeaders(rated: MatchprintPlayer[], ids: string[] = []) {
  const leaders: MatchprintPlayer[] = [];
  for (const id of ids) {
    const item = rated.find(({ player }) => player.id === id);
    if (item && !leaders.some(({ player }) => player.id === id)) leaders.push(item);
  }
  for (const item of rated) {
    if (leaders.length >= 3) break;
    if (!leaders.some(({ player }) => player.id === item.player.id)) leaders.push(item);
  }
  return leaders.slice(0, 3);
}

function drawSmallStar(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, radius: number) {
  ctx.save();
  ctx.fillStyle = metallicGold(ctx, centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const pointRadius = point % 2 === 0 ? radius : radius * 0.44;
    const x = centerX + Math.cos(angle) * pointRadius;
    const y = centerY + Math.sin(angle) * pointRadius;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function buildMatchprintCanvas({ match, phase, players, featuredPlayerIds }: MatchprintInput) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const payload = [match.id, match.homeScore, match.awayScore, phase, ...(featuredPlayerIds || []), ...ratingPayload(players)].join("|");
  const seed = hashText(payload);
  const random = randomFrom(seed);
  const signature = seed.toString(36).toUpperCase().padStart(7, "0").slice(-7);
  const rated = players
    .filter(({ rating }) => scoreOf(rating) != null)
    .sort((a, b) => (scoreOf(b.rating) || 0) - (scoreOf(a.rating) || 0) || a.player.name.localeCompare(b.player.name));
  const leaders = chooseLeaders(rated, featuredPlayerIds);
  const average = rated.length ? rated.reduce((sum, item) => sum + (scoreOf(item.rating) || 0), 0) / rated.length : null;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = COLORS.ink;
  for (let index = 0; index < 260; index += 1) {
    const size = random() * 1.6 + 0.3;
    ctx.beginPath();
    ctx.arc(random() * canvas.width, random() * canvas.height, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(38, 38, 13, 1274);
  ctx.fillStyle = COLORS.garnet;
  ctx.fillRect(51, 38, 13, 1274);
  ctx.fillStyle = metallicGold(ctx, 64, 38, 7, 1274);
  ctx.fillRect(64, 38, 7, 1274);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '820 27px Manrope, "Segoe UI", Arial, sans-serif';
  trackedText(ctx, "NOTA BLAUGRANA", 102, 89, 2.1);
  ctx.fillStyle = COLORS.quiet;
  ctx.font = '680 13px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText(`NB–${signature}`, 103, 120);
  drawEditionCorner(ctx, phase);

  drawMatchprint(ctx, players, seed);

  ctx.fillStyle = "rgba(7,24,43,.88)";
  ctx.beginPath();
  ctx.moveTo(88, 232);
  ctx.lineTo(483, 232);
  ctx.lineTo(532, 278);
  ctx.lineTo(504, 557);
  ctx.lineTo(88, 557);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = metallicGold(ctx, 116, 253, 250, 32);
  ctx.font = '700 14px "DM Sans", "Segoe UI", Arial, sans-serif';
  ctx.fillText(match.competition, 121, 277);
  ctx.fillStyle = COLORS.paper;
  fitSerif(ctx, match.home.name, 350, 42);
  ctx.fillText(match.home.name, 121, 337);
  ctx.fillStyle = COLORS.blueLight;
  ctx.font = 'italic 18px Georgia, "Times New Roman", serif';
  ctx.fillText("versus", 121, 375);
  ctx.fillStyle = COLORS.paper;
  fitSerif(ctx, match.away.name, 350, 42);
  ctx.fillText(match.away.name, 121, 426);
  ctx.font = '700 94px Georgia, "Times New Roman", serif';
  ctx.fillStyle = COLORS.paper;
  ctx.fillText(`${scoreLabel(match.homeScore)}:${scoreLabel(match.awayScore)}`, 116, 523);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '840 38px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText("MVPs", 104, 710);
  ctx.fillStyle = metallicGold(ctx, 104, 724, 82, 7);
  ctx.fillRect(104, 724, 82, 7);

  [270, 540, 810].forEach((centerX, index) => drawJersey(ctx, leaders[index], index + 1, centerX, 742));

  drawSquadRatings(ctx, players, leaders, average);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '600 12px "DM Sans", "Segoe UI", Arial, sans-serif';
  ctx.fillText(`${match.date}${match.venue ? ` · ${match.venue}` : ""}`.slice(0, 92), 103, 1294);

  ctx.fillStyle = metallicGold(ctx, 837, 1270, 170, 39);
  ctx.beginPath();
  ctx.roundRect(837, 1270, 170, 39, 20);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.ink;
  ctx.font = '760 13px Manrope, "Segoe UI", Arial, sans-serif';
  ctx.fillText(`NB–${signature}`, 922, 1295);
  ctx.textAlign = "left";

  return canvas;
}
