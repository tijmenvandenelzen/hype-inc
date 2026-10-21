// Bot players for the balance sim. Each bot is a function that plays one game.
// The bots use only the public engine functions, the same as the UI.
import { newGame, step, buy, collect, dailyMoney, canBuy } from "../src/engine.js";

// Small rng for bot choices. It is separate from the game rng, so the game is
// the same for every bot with the same seed.
function botRng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// What one game gives back to the report.
function result(s, extra) {
  const maxCopy = Math.max(...s.rivals.map((r) => r.peak || 0));
  return {
    status: s.status,
    reason: s.status === "won" ? "won" : s.lostTo ? `copied:${s.lostTo}` : s.day >= 3000 ? "timeout" : "broke",
    day: s.day,
    owned: Object.keys(s.owned).length,
    peakShare: s.stats.peakShare,
    maxCopy,
    hpEarned: s.stats.hpEarned,
    firstBuy: extra.firstBuy ?? -1,
    minCash: extra.minCash,
    priceDays: extra.priceDays,
  };
}

// The common game loop. bot.onItem decides on bubbles, bot.think buys and sets the price.
function run(data, bot, start, seed, trace) {
  const s = newGame(data, { brand: "Fizzo", color: "#f80", start, seed });
  const rand = botRng(seed + bot.salt);
  const extra = { firstBuy: null, minCash: s.cash, priceDays: { cheap: 0, normal: 0, premium: 0 } };
  const startOwned = Object.keys(s.owned).length;
  while (s.status === "playing" && s.day < 3000) {
    for (const it of step(s, data)) {
      if (trace && (it.type === "news" || it.type === "alert")) trace.event(s, it);
      if (it.type === "bubble" && rand() < bot.collect(s, data)) collect(s, data, { type: "bubble", value: it.value });
      if (it.type === "spy" && rand() < bot.spy(s, data, it)) collect(s, data, { type: "spy", rival: it.rival });
    }
    for (const r of s.rivals) r.peak = Math.max(r.peak || 0, r.progress);
    if (s.status !== "playing") break;
    bot.think(s, data, rand);
    if (extra.firstBuy === null && Object.keys(s.owned).length > startOwned) extra.firstBuy = s.day;
    extra.minCash = Math.min(extra.minCash, s.cash);
    extra.priceDays[s.price]++;
    if (trace) trace.day(s);
  }
  return result(s, extra);
}

// Days of cash left at the current daily net. Infinity when net is not negative.
function runway(s, data) {
  const net = dailyMoney(s, data).net;
  return net >= 0 ? Infinity : s.cash / -net;
}

// Buy upgrades in list order. Stop at the first one that is too expensive (save for it).
// safeDays: do not buy an upgrade with upkeep if the cash would run out in that many days.
function buyInOrder(s, data, order, safeDays) {
  for (const id of order) {
    const u = data.upgrades.find((x) => x.id === id);
    if (!u || !canBuy(s, data, u)) continue;
    if (s.hp < u.cost) return;
    if (u.upkeep > 0 && safeDays > 0) {
      const net = dailyMoney(s, data).net - u.upkeep;
      if (net < 0 && s.cash + net * safeDays < 0) continue;
    }
    buy(s, data, id);
  }
}

const sumKey = (u, k) => u.effects[k] || 0;

// Value of an upgrade for the smart bot, per Hype Point. Higher is better.
function smartValue(s, data, u) {
  const noticed = s.rivals.some((r) => r.noticed);
  const top = Math.max(...s.rivals.map((r) => r.progress));
  const growth = 2.0 * sumKey(u, "appeal") + sumKey(u, "social") * 0.8 + sumKey(u, "shops") * 0.8 + sumKey(u, "tv") * 1.2 +
    sumKey(u, "travel") * 0.35 + sumKey(u, "resist") * 1.2 + sumKey(u, "bubbles") * 0.6;
  const money = sumKey(u, "costCut") * 2 + sumKey(u, "margin") * 1.5;
  const danger = noticed ? 0.5 + top / 50 : 0.15;
  const defense = (sumKey(u, "loyalty") * 1.5 + sumKey(u, "patent") * 3 + (sumKey(u, "setback") / 10) + sumKey(u, "autoCollect") * 0.8) * danger;
  const upkeepCost = u.upkeep * (runway(s, data) < 120 ? 0.3 : 0.08);
  return (growth + money + defense - upkeepCost) / u.cost;
}

// A player who plans: grows first, defends when a rival is close, watches cash.
export function smart(data, start, seed, trace) {
  return run(data, {
    salt: 1,
    collect: () => 0.85,
    spy: () => 0.75,
    think(s, data) {
      // Price: premium when cash runs low, normal again when it is safe.
      const left = runway(s, data);
      if (left < 50) s.price = "premium";
      else if (s.price === "premium" && left > 200) s.price = "normal";
      // Upgrades: buy the best value that is affordable now. Save for a better one if it is close.
      for (let n = 0; n < 4; n++) {
        const open = data.upgrades.filter((u) => canBuy(s, data, u));
        if (!open.length) return;
        const safe = open.filter((u) => {
          if (!u.upkeep) return true;
          const net = dailyMoney(s, data).net - u.upkeep;
          return net >= 0 || s.cash + net * 120 > 0;
        });
        safe.sort((a, b) => smartValue(s, data, b) - smartValue(s, data, a));
        const best = safe[0];
        if (!best || s.hp < best.cost) return;
        buy(s, data, best.id);
      }
    },
  }, start, seed, trace);
}

// A first-time player of about 12 to 14 years old. Taps most bubbles, opens the
// upgrade screen now and then, buys what looks cool and is affordable, and
// reacts to cash only when it is already low.
export function kid(data, start, seed, trace) {
  let nextLook = 8;
  let fav = null;
  return run(data, {
    salt: 2,
    collect: () => 0.7,
    spy: (s) => (s.rivals.some((r) => r.progress > 60) ? 0.6 : 0.35),
    think(s, data, rand) {
      if (s.cash < 120 && dailyMoney(s, data).net < 0) s.price = "premium";
      else if (s.price === "premium" && s.cash > 400) s.price = "normal";
      if (s.day < nextLook) return;
      nextLook = s.day + 6 + Math.floor(rand() * 10);
      if (!fav) fav = data.trees[Math.floor(rand() * data.trees.length)].id;
      for (let n = 0; n < 3; n++) {
        const open = data.upgrades.filter((u) => canBuy(s, data, u) && u.cost <= s.hp);
        if (!open.length) return;
        // A kid does not plan for upkeep, but stops buying it when cash is clearly low.
        const ok = s.cash < 150 ? open.filter((u) => !u.upkeep) : open;
        if (!ok.length) return;
        // Likes the favourite tree and big upgrades, but picks with some chance.
        const w = (u) => (u.tree === fav ? 2 : 1) * (0.5 + u.cost / 10);
        const total = ok.reduce((a, u) => a + w(u), 0);
        let t = rand() * total, pick = ok[ok.length - 1];
        for (const u of ok) { t -= w(u); if (t <= 0) { pick = u; break; } }
        // Sometimes saves for a bigger one instead.
        if (pick.cost < 5 && rand() < 0.25) return;
        buy(s, data, pick.id);
      }
    },
  }, start, seed, trace);
}

// The old v0.1 bots, kept to compare with earlier numbers.
export function good(data, start, seed, trace) {
  const order = [...data.upgrades].sort((a, b) => a.cost - b.cost).map((u) => u.id);
  return run(data, { salt: 3, collect: () => 0.8, spy: () => 0.6, think: (s, d) => buyInOrder(s, d, order, 60) }, start, seed, trace);
}

export function rush(data, start, seed, trace) {
  const order = data.upgrades.filter((u) => u.tree !== "defense").sort((a, b) => a.cost - b.cost).map((u) => u.id);
  return run(data, { salt: 4, collect: () => 0.8, spy: () => 0.3, think: (s, d) => buyInOrder(s, d, order, 60) }, start, seed, trace);
}

export function idle(data, start, seed, trace) {
  return run(data, { salt: 5, collect: () => 0.8, spy: () => 0.5, think() {} }, start, seed, trace);
}

export const BOTS = { smart, kid, good, rush, idle };
