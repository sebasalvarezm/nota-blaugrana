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
