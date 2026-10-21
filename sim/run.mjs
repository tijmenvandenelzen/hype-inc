// Balance sim: plays many games with bots for each product and scenario, and
// checks the results against sim/targets.json.
//
// Run:  node sim/run.mjs [--games 100] [--product all|soda,...] [--scenario all|kitchen,...]
//                        [--bots smart,kid,rush,idle] [--json out.json] [--md out.md]
//                        [--set rivals.trendlab.growth=0.04;balance.spread=0.05]
// --set changes numbers in memory only, to try a value before you edit the JSON files.
// Exit code 1 when a target fails, so it can run in CI.
import { readFileSync, writeFileSync } from "node:fs";
import { buildData } from "../src/engine.js";
import { loadBase } from "../tools/load-data.mjs";
import { BOTS } from "./bots.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith("--")) a.push([x.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]);
  return a;
}, []));
const base = loadBase();
if (args.set) for (const pair of String(args.set).split(";")) setValue(base, pair);
const targets = JSON.parse(readFileSync(new URL("./targets.json", import.meta.url)));
const GAMES = Number(args.games || 100);
const list = (v, all) => (!v || v === "all" ? all : String(v).split(","));
const products = list(args.product, base.products.map((p) => p.id));
const scenarios = list(args.scenario, base.scenarios.map((s) => s.id));
const botNames = list(args.bots, ["smart", "kid", "rush", "idle"]);

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const pct = (n, d) => Math.round((100 * n) / d);

function summary(games) {
  const won = games.filter((g) => g.status === "won");
  const reasons = {};
  for (const g of games) reasons[g.reason] = (reasons[g.reason] || 0) + 1;
  return {
    win: pct(won.length, games.length),
    reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, pct(v, games.length)])),
    winDay: median(won.map((g) => g.day)),
    lossDay: median(games.filter((g) => g.status !== "won").map((g) => g.day)),
    // A close win: some copy bar was above 75 at some point.
    closeWins: pct(won.filter((g) => g.maxCopy >= 75).length, Math.max(1, won.length)),
    owned: median(games.map((g) => g.owned)),
    firstBuy: median(games.map((g) => g.firstBuy).filter((d) => d >= 0)),
    premium: pct(games.reduce((a, g) => a + g.priceDays.premium, 0), games.reduce((a, g) => a + g.day, 0)),
  };
}

const rows = [];
for (const sc of scenarios) {
  for (const pid of products) {
    const data = buildData(base, pid, sc);
    const row = { scenario: sc, difficulty: data.scenario.difficulty, product: pid, bots: {} };
    for (const name of botNames) {
      const games = [];
      for (let g = 0; g < GAMES; g++) {
        const start = data.scenario.start ? undefined : g % data.regions.length;
        games.push(BOTS[name](data, start, 1000 + g));
      }
      row.bots[name] = summary(games);
    }
    rows.push(row);
  }
}

// Target checks.
const fails = [], warns = [];
for (const r of rows) {
  const t = targets.win[r.difficulty] || {};
  for (const [name, [lo, hi]] of Object.entries(t)) {
    const b = r.bots[name];
    if (b && (b.win < lo || b.win > hi)) fails.push(`${r.scenario}/${r.product}: ${name} wins ${b.win}%, target ${lo}-${hi}%`);
  }
  const sm = r.bots.smart, ru = r.bots.rush;
  if (sm && ru && ru.win > sm.win - targets.rushBelowSmart) warns.push(`${r.scenario}/${r.product}: rush wins ${ru.win}%, smart ${sm.win}% (defense must matter)`);
  if (sm && sm.winDay != null && (sm.winDay < targets.days[0] || sm.winDay > targets.days[1])) fails.push(`${r.scenario}/${r.product}: smart median win day ${sm.winDay}, target ${targets.days[0]}-${targets.days[1]}`);
}
for (const sc of scenarios) {
  const wins = rows.filter((r) => r.scenario === sc && r.bots.smart).map((r) => r.bots.smart.win);
  if (wins.length > 1 && Math.max(...wins) - Math.min(...wins) > targets.spread) fails.push(`${sc}: smart win rate spread over products is ${Math.max(...wins) - Math.min(...wins)} points, target <= ${targets.spread}`);
}

// Output.
const short = (b) => {
  const loss = Object.entries(b.reasons).filter(([k]) => k !== "won").map(([k, v]) => `${k.replace("copied:", "c:")} ${v}`).join(" ");
  return `${String(b.win).padStart(3)}% d${b.winDay ?? "-"}${loss ? ` (${loss})` : ""}`;
};
for (const r of rows) console.log(`${r.scenario.padEnd(12)} ${r.product.padEnd(9)} ${botNames.map((n) => `${n} ${short(r.bots[n])}`).join(" | ")}`);
if (warns.length) console.log(`\n${warns.length} warning(s):\n  ${warns.join("\n  ")}`);
console.log(fails.length ? `\n${fails.length} target(s) failed:\n  ${fails.join("\n  ")}` : "\nAll targets pass.");

if (args.json) writeFileSync(args.json, JSON.stringify({ games: GAMES, rows, fails, warns }, null, 1));
if (args.md) {
  const head = `| Scenario | Product | ${botNames.join(" | ")} |\n|---|---|${botNames.map(() => "---").join("|")}|\n`;
  const body = rows.map((r) => `| ${r.scenario} | ${r.product} | ${botNames.map((n) => `${r.bots[n].win}% (day ${r.bots[n].winDay ?? "-"})`).join(" | ")} |`).join("\n");
  writeFileSync(args.md, `${head}${body}\n`);
}
process.exitCode = fails.length ? 1 : 0;

// "rivals.trendlab.growth=0.04": file, then an id for list files, then the field path.
function setValue(base, pair) {
  const [path, raw] = pair.split("=");
  const keys = path.split(".");
  let obj = base[keys.shift()];
  if (Array.isArray(obj)) { const id = keys.shift(); obj = obj.find((x) => x.id === id); }
  if (!obj) throw new Error(`--set: no ${path}`);
  while (keys.length > 1) {
    const k = keys.shift();
    obj = Array.isArray(obj) && isNaN(k) ? obj.find((x) => x.id === k) : obj[k];
    if (obj == null) throw new Error(`--set: no ${path}`);
  }
  obj[keys[0]] = JSON.parse(raw);
}
