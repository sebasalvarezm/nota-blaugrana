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
  const module = { exports: {} };
  modules.set(file, module.exports);
  const require = (id) => id.startsWith("@/") ? load(id) : nativeRequire(id);
  new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename: file })
    .runInThisContext()(require, module, module.exports);
  return module.exports;
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
