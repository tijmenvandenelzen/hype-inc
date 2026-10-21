// Prints one game day by day, to see why a bot wins or loses.
// Run: node sim/trace.mjs <bot> <product> <scenario> [seed] [start] [every]
import { buildData, worldShare, dailyMoney } from "../src/engine.js";
import { loadBase } from "../tools/load-data.mjs";
import { BOTS } from "./bots.mjs";

const [bot = "smart", product = "soda", scenario = "kitchen", seed = "1000", start = "0", every = "25"] = process.argv.slice(2);
const data = buildData(loadBase(), product, scenario);
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const res = BOTS[bot](data, data.scenario.start ? undefined : Number(start), Number(seed), {
  event: (s, it) => console.log(`  day ${s.day} ${it.kind || it.type}: ${it.text}`),
  day(s) {
    if (s.day % Number(every)) return;
    const ws = worldShare(s, data), mo = dailyMoney(s, data);
    const bars = s.rivals.map((r) => `${r.id} ${r.noticed ? r.progress.toFixed(0) : "-"}`).join(" ");
    console.log(`day ${s.day} share ${pc(ws.share)} rival ${pc(ws.rivalShare)} | ${bars} | cash ${s.cash.toFixed(0)} net ${mo.net.toFixed(2)} (rev ${mo.revenue.toFixed(2)} cost ${mo.costs.toFixed(2)}) ${s.price} | hp ${s.hp} owned ${Object.keys(s.owned).join(",")} | regions ${s.regions.filter((r) => r.reached).length}`);
  },
});
console.log(res);
