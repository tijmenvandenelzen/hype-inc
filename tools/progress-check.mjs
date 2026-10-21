// Checks the unlock rules and achievements with fake runs.
// Run: node tools/progress-check.mjs
import assert from "node:assert/strict";
import { loadBase } from "./load-data.mjs";
import { buildData } from "../src/engine.js";
import { newProgress, recordRun, unlockState, ruleText, applyHard, exportProgress, importProgress, cleanProgress } from "../src/progress.js";

const data = loadBase();

// Every id in the unlock data must exist.
const ids = (list) => new Set((list || []).map((x) => x.id));
const products = ids(data.products), scenarios = ids(data.scenarios), achievements = ids(data.achievements);
for (const id of Object.keys(data.unlocks.products)) assert.ok(products.has(id), `unlocks.json: no product ${id}`);
for (const p of data.products) assert.ok(p.id in data.unlocks.products, `unlocks.json: product ${p.id} has no rule`);
const refs = [...data.unlocks.colors.map((c) => c.unlock), data.unlocks.hard.unlock, ...Object.values(data.unlocks.products), ...(data.scenarios || []).map((s) => s.unlock)];
for (const r of refs.filter(Boolean)) {
  if (r.achievement) assert.ok(achievements.has(r.achievement), `no achievement ${r.achievement}`);
  if (r.productWon) assert.ok(products.has(r.productWon), `no product ${r.productWon}`);
  if (r.scenarioWon) assert.ok(scenarios.has(r.scenarioWon), `no scenario ${r.scenarioWon}`);
}
for (const a of data.achievements) if (a.check.scenario) assert.ok(scenarios.has(a.check.scenario), `achievement ${a.id}: no scenario ${a.check.scenario}`);
assert.equal(achievements.size, data.achievements.length, "achievement ids are not unique");

// A new player has only the open things.
let p = newProgress();
let u = unlockState(p, data);
assert.deepEqual(u.products.filter((x) => x.open).map((x) => x.id), ["soda"]);
assert.equal(u.hard.open, false);
assert.equal(u.colors.filter((c) => c.open).length, 5);

const run = (over) => ({ status: "lost", product: "soda", scenario: "kitchen", hard: false, day: 300, cash: 100,
  peakShare: 0.1, spies: 3, upgrades: 8, regions: 5, allRegions: 12, maxRivalBar: 100, price: "normal", ...over });

// Run 1: a loss. Sneakers and a colour open.
let r = recordRun(p, data, run());
assert.deepEqual(r.earned.map((a) => a.id), ["lesson"]);
assert.ok(r.unlocked.some((x) => x.kind === "products" && x.id === "sneakers"));
assert.ok(r.unlocked.some((x) => x.kind === "colors" && x.id === "coral"));
assert.equal(p.runs, 0, "recordRun must not change the old progress");
p = r.progress;

// Run 2: a fast win with few upgrades.
r = recordRun(p, data, run({ status: "won", day: 190, upgrades: 6, maxRivalBar: 40 }));
assert.deepEqual(r.earned.map((a) => a.id).sort(), ["first-win", "lean", "speedrun"]);
assert.ok(r.unlocked.some((x) => x.kind === "hard"));
assert.ok(r.unlocked.some((x) => x.id === "app"));
p = r.progress;
assert.equal(p.best.soda, 190);

// The same win again gives nothing new.
r = recordRun(p, data, run({ status: "won", day: 190, upgrades: 6, maxRivalBar: 40 }));
assert.equal(r.earned.length, 0);
p = r.progress;

// Win with every product: Business Empire and the Chrome colour.
for (const id of ["sneakers", "app", "game", "burger"]) p = recordRun(p, data, run({ status: "won", product: id, maxRivalBar: 50 })).progress;
assert.ok(p.achievements.empire);
u = unlockState(p, data);
assert.ok(u.products.every((x) => x.open));
assert.ok(u.colors.find((c) => c.id === "chrome").open);

// Rule text.
assert.equal(ruleText({ wins: 1 }, data), "Win 1 run");
assert.equal(ruleText({ runs: 2 }, data), "Finish 2 runs");

// Hard mode makes the rivals faster and leaves the normal data alone.
for (const sc of data.scenarios) {
  const game = buildData(data, "soda", sc.id);
  const hard = applyHard(game, data.unlocks.hard);
  assert.ok(hard.rivals[0].copyBaseRate > game.rivals[0].copyBaseRate);
  const cash = (d) => d.scenario.startCash ?? d.product.startCash ?? d.balance.startCash;
  assert.ok(cash(hard) < cash(game), `${sc.id}: Hard must start with less cash`);
  assert.equal(applyHard(game, null), game);
}
assert.equal(data.rivals[0].copyBaseRate, buildData(data, "soda", "kitchen").rivals[0].copyBaseRate);

// Save export and import.
const text = exportProgress(p);
assert.deepEqual(importProgress(text), cleanProgress(p));
assert.equal(importProgress("garbage"), null);
assert.equal(importProgress("HYPE1:!!!"), null);
assert.deepEqual(cleanProgress({ version: 1, runs: -5, wins: "x" }).runs, 0);

console.log(`progress check OK: ${data.achievements.length} achievements, ${data.unlocks.colors.length} colours, ${data.products.length} products`);
