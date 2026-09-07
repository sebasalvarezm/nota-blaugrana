import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Exercise pure application rules without starting Next.js or loading any env file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  const file = path.join(root, `${name.replace(/^@\//, "")}.ts`);
  if (modules.has(file)) return modules.get(file);
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  modules.set(file, loaded.exports);
  const require = (id) => id.startsWith("@/") ? load(id) : nativeRequire(id);
  new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename: file })
    .runInThisContext()(require, loaded, loaded.exports);
  return loaded.exports;
}

const { playerName, shortPlayerName } = load("lib/player-names");
assert.equal(playerName("assist by Fermín López"), "Fermín López");
assert.equal(playerName(" Assisted by:  Fermín López "), "Fermín López");
assert.equal(playerName("Fermín López"), "Fermín López");
assert.equal(playerName(null), "");
assert.equal(shortPlayerName("assist by Lamine Yamal"), "Lamine Yamal");
console.log("Player identity checks passed.");

const { contributionsFor, eventPeriod } = load("lib/match-events");
const goal = { id:"g1", type:"goal", playerId:"scorer", assistPlayerId:"helper", detail:"Goal", minute:45, extraMinute:2, period:"first" };
const eventExamples = [goal, goal,
  { ...goal, id:"g2", minute:75, period:"second" },
  { ...goal, id:"own", detail:"Own goal" },
  { ...goal, id:"cancelled", detail:"Goal cancelled" },
  { ...goal, id:"sub", type:"substitution" },
  { ...goal, id:"shootout", period:"shootout" },
];
assert.deepEqual(contributionsFor(eventExamples, "ht"), { scorer:{goals:1, assists:0}, helper:{goals:0, assists:1} });
assert.deepEqual(contributionsFor(eventExamples, "ft"), { scorer:{goals:2, assists:0}, helper:{goals:0, assists:2} });
assert.equal(eventPeriod(null, 45, 3), "first");
assert.equal(eventPeriod("1H", 47), "first");
assert.equal(eventPeriod("PEN", 120), "shootout");
assert.deepEqual(contributionsFor([], "ft"), {});
console.log("Goal/assist and stoppage-time checks passed.");

const { normalizeRatings, validScore, averageRating, ratingBand, formatRating } = load("lib/ratings");
const oldRatings = { ht:{ a:{ overall:4, attributes:{passing:3, defending:null} } }, ft:{ b:{overall:5,attributes:{}} } };
const converted = normalizeRatings(oldRatings, 5);
assert.equal(converted.ht.a.overall, 8);
assert.equal(converted.ht.a.attributes.passing, 6);
assert.equal(converted.ht.a.attributes.defending, null);
assert.equal(converted.ft.b.overall, 10);
assert.deepEqual(normalizeRatings(converted, 10), converted);
assert.equal(normalizeRatings({ft:{a:{overall:4,attributes:{}}}}, 10).ft.a.overall, 4);
assert.equal(normalizeRatings({ht:{a:{overall:99,attributes:{}}}}, 5).ht.a.overall, null);
assert.equal(validScore(8.5), true);
assert.equal(validScore(8.3), false);
assert.equal(validScore(0), false);
assert.equal(averageRating([8, null, 6]), 7);
assert.equal(averageRating([]), null);
assert.equal(ratingBand(5.9), "poor");
assert.equal(ratingBand(6), "steady");
assert.equal(ratingBand(7), "good");
assert.equal(ratingBand(8.5), "excellent");
assert.equal(ratingBand(8.46), "excellent");
assert.equal(formatRating(8.5), "8.5");
console.log("Scale migration, averages and colour boundary checks passed.");

const { mergeAccountRatings, ratingKey } = load("lib/rating-storage");
const local = { ht:{}, ft:{ a:{overall:8,attributes:{}} } };
const remote = { ht:{}, ft:{ a:{overall:7,attributes:{}}, b:{overall:6,attributes:{}} } };
const pending = { "ft:a":{ phase:"ft",playerId:"a",rating:local.ft.a,expectedUpdatedAt:null,revision:1 }, "ft:b":{phase:"ft",playerId:"b",rating:null,expectedUpdatedAt:null,revision:2} };
assert.deepEqual(mergeAccountRatings(local, remote, pending), local);
assert.deepEqual(mergeAccountRatings(local, remote, {}), remote);
assert.notEqual(ratingKey("guest", "m"), ratingKey("account", "m"));
const { seasonStart, seasonComparison } = load("lib/season");
assert.equal(new Date(seasonStart("2026-06-30T23:59:00Z")).toISOString(), "2025-07-01T00:00:00.000Z");
assert.equal(seasonComparison(8, {average:7.5,matches:3}), "Season avg 7.5");
assert.equal(seasonComparison(8, {average:7.5,matches:2}), "Season avg 7.5");
const { halftimeScoreFromEvents } = load("lib/match-events");
assert.deepEqual(halftimeScoreFromEvents([{type:"Goal",time:45,overloadTime:3,newScore:[1,0]},{type:"Goal",time:70,newScore:[2,0]}]), [1,0]);
assert.equal(halftimeScoreFromEvents([{type:"Goal",newScore:[1,0]}]), null);
console.log("Save merge, account separation, season and HT checks passed.");

const { contributionLabel } = load("lib/match-events");
assert.equal(contributionLabel({goals:2,assists:1}), "2 Goals · 1 Assist");
assert.equal(contributionLabel({goals:1,assists:2}), "1 Goal · 2 Assists");
assert.equal(contributionLabel({goals:0,assists:0}), "");
const { movePlayer, positionId } = load("lib/lineup-positions");
const wings = [{id:"gordon",role:"WING",roleLabel:"Winger",x:82,y:20,starter:true}, {id:"yamal",role:"WING",roleLabel:"Winger",x:18,y:20,starter:true}];
const switched = movePlayer(wings,"gordon","LW");
assert.equal(positionId(switched[0]), "LW");
assert.equal(positionId(switched[1]), "RW");
assert.equal(switched[0].id,"gordon");
assert.equal(switched[1].id,"yamal");
assert.equal(wings[0].x,82);
assert.equal(movePlayer(wings,"gordon","invalid"),wings);
assert.equal(movePlayer(wings,"unknown","RW"),wings);
assert.equal(movePlayer(wings,"gordon","ST")[0].role,"ST");
console.log("Owner position swaps and goal/assist wording checks passed.");
const { includeCurrentMatch, localSeasonAverages } = load("lib/season");
assert.equal(seasonComparison(8, undefined), "");
assert.equal(seasonComparison(8, {average:7,matches:0}), "");
assert.equal(seasonComparison(8, {average:7,matches:1}), "Season avg 7.0");
const seasonMatch = {id:"current",source:"cloud",status:"finished",kickoff:"2026-09-06T12:00:00Z",players:[{id:"p"}]};
const previousSeason = {p:{average:6,matches:1,includesConverted:false}};
assert.deepEqual(includeCurrentMatch(previousSeason,seasonMatch,{p:{overall:8,attributes:{}}}), {p:{average:7,matches:2,includesConverted:false}});
assert.deepEqual(includeCurrentMatch(previousSeason,seasonMatch,{p:{overall:10,attributes:{}}}), {p:{average:8,matches:2,includesConverted:false}});
assert.equal(previousSeason.p.matches,1);
assert.deepEqual(includeCurrentMatch({},seasonMatch,{p:{overall:8,attributes:{}}}), {p:{average:8,matches:1,includesConverted:false}});
assert.deepEqual(includeCurrentMatch(previousSeason,{...seasonMatch,status:"live"},{p:{overall:8,attributes:{}}}),previousSeason);
assert.deepEqual(includeCurrentMatch({},seasonMatch,{}),{});
const historyRecords = new Map();
for (const [id,scope,kickoff,score] of [["earlier","me","2026-08-01",6],["current","me","2026-09-06T12:00:00Z",8],["other-account","other","2026-08-02",10],["last-season","me","2026-06-01",10]]) {
 historyRecords.set(ratingKey(scope,id),JSON.stringify({version:3,scale:10,ratings:{ht:{p:{overall:10,attributes:{}}},ft:{p:{overall:score,attributes:{}}}},pending:{},match:{id,kickoff,status:"finished",source:"cloud"}}));
}
const historyStorage = {length:historyRecords.size,key:index=>[...historyRecords.keys()][index],getItem:key=>historyRecords.get(key)};
const priorHistory = localSeasonAverages(historyStorage,"me",seasonMatch);
assert.equal(priorHistory.p.matches,1);
assert.equal(includeCurrentMatch(priorHistory,seasonMatch,{p:{overall:8,attributes:{}}}).p.matches,2);
assert.equal(includeCurrentMatch(priorHistory,seasonMatch,{p:{overall:8,attributes:{}}}).p.average,7);
const { selectMvpIds, replaceMvp } = load("lib/mvps");
const tieCandidates = ["a","b","c","d"].map(id=>({id,name:id,score:9}));
assert.deepEqual(selectMvpIds(tieCandidates,["d","c","b"]),["d","c","b"]);
assert.deepEqual(selectMvpIds([...tieCandidates,{id:"lower",name:"lower",score:8}],["lower","d","c"]),["d","c","a"]);
assert.deepEqual(selectMvpIds([{id:"winner",name:"winner",score:10},...tieCandidates],["d","c","b"]),["winner","d","c"]);
assert.deepEqual(replaceMvp(["a","b","c"],0,"c"),["c","b","a"]);
assert.deepEqual(replaceMvp(["a","b","c"],1,"d"),["a","d","c"]);
assert.deepEqual(selectMvpIds([]),[]);
console.log("One/two-match season averages, no duplicate current match, and tied MVP selection passed.");