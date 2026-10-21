// Plays many games with simple bots to check the balance.
// Run: node tools/sim.mjs [games]
import { newGame, step, buy, collect, worldShare, dailyMoney, canBuy } from "../src/engine.js";
import { loadData } from "./load-data.mjs";

const data = loadData();
const GAMES = Number(process.argv[2] || 200);

const BOTS = {
  // Collects most bubbles and buys a sensible mix.
  good: { collect: 0.8, spy: 0.6, order: ["social", "recipe", "shops", "loyalty", "factory", "influence", "patent", "can", "shipping", "zero", "fanclub", "lawyers", "tv", "limited", "local"] },
  // Collects fewer bubbles and buys in the list order.
  casual: { collect: 0.5, spy: 0.25, order: data.upgrades.map((u) => u.id) },
  // Only growth, no defense.
  rush: { collect: 0.8, spy: 0.3, order: ["social", "recipe", "shops", "influence", "can", "shipping", "tv", "limited", "zero", "local"] },
  // Does nothing but collect.
  idle: { collect: 0.8, spy: 0.5, order: [] },
};

for (const [name, bot] of Object.entries(BOTS)) {
  let wins = 0, broke = 0, copied = 0, days = 0, winDays = [];
  const startCounts = {};
  for (let g = 0; g < GAMES; g++) {
    const start = g % data.regions.length;
    const s = newGame(data, { brand: "Fizzo", color: "#f80", start, seed: 1000 + g });
    let rnd = 7 + g;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    while (s.status === "playing" && s.day < 3000) {
      for (const it of step(s, data)) {
        if (it.type === "bubble" && rand() < bot.collect) collect(s, { type: "bubble", value: it.value });
        if (it.type === "spy" && rand() < bot.spy) collect(s, { type: "spy", setback: data.rival.spySetback });
      }
      for (const id of bot.order) {
        const u = data.upgrades.find((x) => x.id === id);
        if (!canBuy(s, data, u)) continue;
        if (s.hp < u.cost) break;
        const net = dailyMoney(s, data).net;
        if (u.upkeep > 0 && s.cash + (net - u.upkeep) * 60 < 0) break;
        buy(s, data, id);
      }
    }
    days += s.day;
    if (s.status === "won") { wins++; winDays.push(s.day); startCounts[start] = (startCounts[start] || 0) + 1; }
    else if (s.reason.includes("cash")) broke++;
    else copied++;
  }
  winDays.sort((a, b) => a - b);
  console.log(`${name.padEnd(7)} win ${(100 * wins / GAMES).toFixed(0).padStart(3)}%  broke ${(100 * broke / GAMES).toFixed(0).padStart(3)}%  copied ${(100 * copied / GAMES).toFixed(0).padStart(3)}%  avg days ${(days / GAMES).toFixed(0)}  median win day ${winDays[winDays.length >> 1] ?? "-"}`);
  if (process.env.STARTS) console.log("  wins by start:", data.regions.map((r, i) => `${r.id}:${startCounts[i] || 0}`).join(" "));
}

// One sample game, to see the curve.
if (process.env.TRACE) {
  const s = newGame(data, { brand: "Fizzo", color: "#f80", start: 0, seed: 5 });
  const bot = BOTS.good;
  while (s.status === "playing") {
    for (const it of step(s, data)) {
      if (it.type === "bubble") collect(s, { type: "bubble", value: it.value });
      if (it.type === "spy" && Math.random() < 0.6) collect(s, { type: "spy", setback: data.rival.spySetback });
      if (it.type === "news" && process.env.TRACE === "news") console.log(`  day ${s.day}: ${it.text}`);
    }
    for (const id of bot.order) {
      const u = data.upgrades.find((x) => x.id === id);
      if (!canBuy(s, data, u)) continue;
      if (s.hp < u.cost) break;
      buy(s, data, id);
    }
    if (s.day % 25 === 0) {
      const ws = worldShare(s, data), mo = dailyMoney(s, data);
      console.log(`day ${s.day} share ${(ws.share * 100).toFixed(1)}% rival ${(ws.rivalShare * 100).toFixed(1)}% copy ${s.rival.progress.toFixed(0)} cash ${s.cash.toFixed(0)} net ${mo.net.toFixed(1)} hp ${s.hp} owned ${Object.keys(s.owned).length} regions ${s.regions.filter((r) => r.reached).length}`);
    }
  }
  console.log(s.status, s.day, s.reason);
}
