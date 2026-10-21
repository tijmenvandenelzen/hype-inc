// Plays many games with simple bots to check the balance.
// Run: node tools/sim.mjs [games per row] [product|all] [scenario|all]
import { buildData, newGame, step, buy, collect, dailyMoney, canBuy } from "../src/engine.js";
import { loadBase } from "./load-data.mjs";

const base = loadBase();
const GAMES = Number(process.argv[2] || 100);
const products = (process.argv[3] && process.argv[3] !== "all") ? [process.argv[3]] : base.products.map((p) => p.id);
const scenarios = !process.argv[4] ? ["kitchen"] : process.argv[4] === "all" ? base.scenarios.map((s) => s.id) : [process.argv[4]];

// order(data) gives the upgrade ids in the order the bot wants them.
const BOTS = {
  good: { collect: 0.8, spy: 0.6, order: (d) => [...d.upgrades].sort((a, b) => a.cost - b.cost).map((u) => u.id) },
  casual: { collect: 0.5, spy: 0.25, order: (d) => d.upgrades.map((u) => u.id) },
  rush: { collect: 0.8, spy: 0.3, order: (d) => d.upgrades.filter((u) => u.tree !== "defense").sort((a, b) => a.cost - b.cost).map((u) => u.id) },
  idle: { collect: 0.8, spy: 0.5, order: () => [] },
};

export function play(data, bot, start, seed) {
  const s = newGame(data, { brand: "Fizzo", color: "#f80", start, seed });
  let rnd = 7 + seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const order = bot.order(data);
  while (s.status === "playing" && s.day < 3000) {
    for (const it of step(s, data)) {
      if (it.type === "bubble" && rand() < bot.collect) collect(s, data, { type: "bubble", value: it.value });
      if (it.type === "spy" && rand() < bot.spy) collect(s, data, { type: "spy", rival: it.rival });
    }
    for (const id of order) {
      const u = data.upgrades.find((x) => x.id === id);
      if (!canBuy(s, data, u)) continue;
      if (s.hp < u.cost) break;
      const net = dailyMoney(s, data).net;
      if (u.upkeep > 0 && s.cash + (net - u.upkeep) * 60 < 0) break;
      buy(s, data, id);
    }
  }
  return s;
}

for (const sc of scenarios) {
  for (const pid of products) {
    const data = buildData(base, pid, sc);
    const row = [];
    for (const [name, bot] of Object.entries(BOTS)) {
      let wins = 0, broke = 0, copied = 0;
      const winDays = [];
      for (let g = 0; g < GAMES; g++) {
        const s = play(data, bot, data.scenario.start ? undefined : g % data.regions.length, 1000 + g);
        if (s.status === "won") { wins++; winDays.push(s.day); }
        else if (s.reason.includes("cash")) broke++;
        else copied++;
      }
      winDays.sort((a, b) => a - b);
      row.push(`${name} ${String(Math.round(100 * wins / GAMES)).padStart(3)}% (b${Math.round(100 * broke / GAMES)} c${Math.round(100 * copied / GAMES)} d${winDays[winDays.length >> 1] ?? "-"})`);
    }
    console.log(`${sc.padEnd(12)} ${pid.padEnd(9)} ${row.join("  ")}`);
  }
}
