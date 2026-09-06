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
