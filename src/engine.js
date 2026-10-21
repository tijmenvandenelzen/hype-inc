// Game rules. No DOM code here, so tools/sim.mjs can run the same rules in Node.

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function newGame(data, { brand, color, start, seed = Date.now() }) {
  const regions = data.regions.map(() => ({
    f: 0, r: 0, reached: false, rivalIn: false,
    entry: -1, rivalEntry: -1, boost: 1, boostDays: 0, freezeDays: 0,
  }));
  const state = {
    version: 1,
    seed, rngState: seed,
    day: 0,
    brand, color,
    product: data.products[0].id,
    cash: data.balance.startCash,
    hp: 2,
    price: "normal",
    owned: {},
    regions,
    rival: { noticed: false, progress: 0 },
    globalBoost: 1, globalBoostDays: 0,
    nextEventDay: 15,
    status: "playing", reason: "",
    stats: { peakShare: 0, hpEarned: 2, spies: 0, revenue: 0 },
    log: [],
  };
  reach(state, start, -1);
  state.regions[start].f = 0.002;
  return state;
}

// Sum the effects of all owned upgrades.
export function mods(state, data) {
  const m = { appeal: 0, social: 0, shops: 0, tv: 0, travel: 0, resist: 0, loyalty: 0,
    patent: 0, costCut: 0, margin: 0, bubbles: 0, autoCollect: 0, upkeep: 0 };
  for (const u of data.upgrades) {
    if (!state.owned[u.id]) continue;
    for (const [k, v] of Object.entries(u.effects)) if (k in m) m[k] += v;
    m.upkeep += u.upkeep;
  }
  return m;
}

export function worldShare(state, data) {
  let fans = 0, total = 0, rival = 0;
  data.regions.forEach((d, i) => {
    total += d.pop; fans += d.pop * state.regions[i].f; rival += d.pop * state.regions[i].r;
  });
  return { share: fans / total, rivalShare: rival / total, fans, total };
}

export function dailyMoney(state, data, m = mods(state, data)) {
  const b = data.balance;
  const price = b.prices[state.price];
  let revenue = 0;
  data.regions.forEach((d, i) => {
    // Fans are in millions and cash is in $k.
    revenue += d.pop * state.regions[i].f * d.wealth * b.margin * price.revenue * (1 + m.margin);
  });
  const costs = (b.baseCost + m.upkeep) * (1 - m.costCut);
  return { revenue, costs, net: revenue - costs };
}

export function growthRate(state, data, i, m = mods(state, data)) {
  const b = data.balance, d = data.regions[i], s = state.regions[i];
  const p = data.products.find((x) => x.id === state.product);
  const appeal = p.appeal + m.appeal;
  const channel = b.wordOfMouth + (p.social + m.social) * d.digital + (p.shops + m.shops) * d.retail + m.tv;
  const resist = d.resist * Math.max(0, 1 - m.resist);
  return b.growth * appeal * channel * (1 - resist) * b.prices[state.price].growth * s.boost * state.globalBoost;
}

export function canBuy(state, data, u) {
  if (state.owned[u.id]) return false;
  if (!u.requires.every((id) => state.owned[id])) return false;
  if (u.requiresAny && !u.requiresAny.some((id) => state.owned[id])) return false;
  return true;
}

export function buy(state, data, id) {
  const u = data.upgrades.find((x) => x.id === id);
  if (!u || !canBuy(state, data, u) || state.hp < u.cost) return false;
  state.hp -= u.cost;
  state.owned[id] = true;
  if (u.effects.setback) {
    state.rival.progress = Math.max(0, state.rival.progress - u.effects.setback);
    state.regions.forEach((s) => { s.r *= 0.6; });
  }
  return true;
}

function reach(state, i, from) {
  const s = state.regions[i];
  if (s.reached) return false;
  s.reached = true;
  s.entry = from; // the UI picks a start dot near the region it came from
  s.f = Math.max(s.f, 0.0005);
  return true;
}

function rng(state) {
  // Store the rng position in the state so a saved game continues the same way.
  const r = makeRng(state.rngState);
  const v = r();
  state.rngState = Math.floor(v * 4294967296) || 1;
  return v;
}

function pickWeighted(state, items, weight) {
  const total = items.reduce((a, x) => a + weight(x), 0);
  if (total <= 0) return null;
  let t = rng(state) * total;
  for (const x of items) { t -= weight(x); if (t <= 0) return x; }
  return items[items.length - 1];
}

function fill(text, ctx) {
  return text.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? "");
}

// Advance one day. Returns a list of things the UI shows: news, bubbles, end.
export function step(state, data) {
  if (state.status !== "playing") return [];
  const out = [];
  const b = data.balance, rv = data.rival;
  const m = mods(state, data);
  state.day++;

  // Grow inside each region.
  data.regions.forEach((d, i) => {
    const s = state.regions[i];
    if (!s.reached) return;
    const room = Math.max(0, 1 - s.f - s.r);
    if (s.freezeDays > 0) s.freezeDays--;
    else {
      const g = growthRate(state, data, i, m);
      s.f += g * (s.f + b.seedShare) * room;
    }
    if (s.boostDays > 0 && --s.boostDays === 0) s.boost = 1;
  });
  if (state.globalBoostDays > 0 && --state.globalBoostDays === 0) state.globalBoost = 1;

  // Spread to new regions.
  const travel = 1 + m.travel;
  data.regions.forEach((d, j) => {
    if (state.regions[j].reached) return;
    let push = 0, best = -1, bestF = 0;
    data.regions.forEach((e, i) => {
      const s = state.regions[i];
      if (!s.reached) return;
      const w = e.neighbors.includes(d.id) ? 1 : b.farSpread;
      push += s.f * w;
      if (s.f * w > bestF) { bestF = s.f * w; best = i; }
    });
    if (rng(state) < b.spread * travel * push) {
      reach(state, j, best);
      out.push({ type: "news", kind: "good", text: `${state.brand} arrives in ${d.name}!` });
      out.push({ type: "bubble", region: j, value: 2 });
    }
  });

  // The rival.
  const ws = worldShare(state, data);
  if (!state.rival.noticed && (ws.share >= rv.noticeShare || state.day >= rv.noticeDay)) {
    state.rival.noticed = true;
    let top = 0;
    state.regions.forEach((s, i) => { if (s.f * data.regions[i].pop > state.regions[top].f * data.regions[top].pop) top = i; });
    seedRival(state, top);
    out.push({ type: "news", kind: "bad", text: `${rv.name} has noticed ${state.brand}. They start work on ${rv.copy}!` });
    out.push({ type: "alert", text: `${rv.name} wants to copy you. Win before their ${rv.copy} is ready.` });
  }
  if (state.rival.noticed) {
    const before = state.rival.progress;
    const rate = (rv.copyBaseRate + rv.copyShareRate * ws.share) * Math.max(0.1, 1 - m.patent);
    state.rival.progress = Math.min(100, before + rate);
    for (const mark of [25, 50, 75, 90]) {
      if (before < mark && state.rival.progress >= mark) out.push({ type: "news", kind: "bad", text: `${rv.copy} is ${mark}% ready.` });
    }
    const strength = rv.growth * (1 + state.rival.progress / 100);
    data.regions.forEach((d, i) => {
      const s = state.regions[i];
      if (!s.rivalIn) {
        if (s.reached && rng(state) < rv.spreadChance) seedRival(state, i);
        return;
      }
      const room = Math.max(0, 1 - s.f - s.r);
      s.r += strength * (s.r + 0.0005) * room;
      const stolen = rv.steal * s.r * s.f * Math.max(0, 1 - m.loyalty);
      s.f -= stolen; s.r += stolen;
    });
    if (rng(state) < rv.spyChance) {
      const where = pickWeighted(state, data.regions.map((_, i) => i), (i) => state.regions[i].r);
      if (where !== null) out.push({ type: "spy", region: where });
    }
  }

  // Money.
  const money = dailyMoney(state, data, m);
  state.cash += money.net;
  state.stats.revenue += money.revenue;

  // Hype bubbles.
  if (rng(state) < b.bubbleChance * (1 + m.bubbles)) {
    const where = pickWeighted(state, data.regions.map((_, i) => i), (i) => state.regions[i].reached ? 0.02 + state.regions[i].f : 0);
    if (where !== null) out.push({ type: "bubble", region: where, value: rng(state) < 0.2 ? 2 : 1 });
  }

  // News events.
  if (state.day >= state.nextEventDay) {
    const [lo, hi] = data.events.everyDays;
    state.nextEventDay = state.day + lo + Math.floor(rng(state) * (hi - lo));
    const ev = runEvent(state, data, m);
    if (ev) out.push(ev);
    else out.push({ type: "news", kind: "fun", text: data.events.headlines[Math.floor(rng(state) * data.events.headlines.length)] });
  }

  // Win and lose.
  const after = worldShare(state, data);
  state.stats.peakShare = Math.max(state.stats.peakShare, after.share);
  if (after.share >= b.winShare) end(state, "won", `${state.brand} is the most loved drink on Earth.`);
  else if (state.rival.progress >= 100) end(state, "lost", `${rv.name} launched ${rv.copy} everywhere at once. It was cheaper and your fans left.`);
  else if (state.cash < 0) end(state, "lost", `You ran out of cash. ${state.brand} had to close the factory.`);
  if (state.status !== "playing") out.push({ type: "end", status: state.status });
  return out;
}

function seedRival(state, i) {
  const s = state.regions[i];
  if (s.rivalIn) return;
  s.rivalIn = true;
  s.rivalEntry = i;
  s.r = Math.max(s.r, 0.003);
}

function runEvent(state, data, m) {
  const rv = data.rival;
  const ok = data.events.events.filter((e) => state.day >= e.minDay && (!e.needsRival || state.rival.noticed));
  for (let tries = 0; tries < 5; tries++) {
    const e = pickWeighted(state, ok, (x) => x.weight);
    if (!e) return null;
    let region = -1;
    if (e.target !== "none") {
      const pool = data.regions.map((_, i) => i).filter((i) => {
        const s = state.regions[i];
        if (e.target === "reached" && !s.reached) return false;
        if (e.target === "unreached" && s.reached) return false;
        if (e.hotOnly && !data.regions[i].hot) return false;
        return true;
      });
      if (!pool.length) continue;
      region = pool[Math.floor(rng(state) * pool.length)];
    }
    const ctx = { brand: state.brand, region: region >= 0 ? data.regions[region].name : "", rival: rv.name, copy: rv.copy };
    if (e.skipIf && state.owned[e.skipIf]) return { type: "news", kind: "good", text: fill(e.skipText, ctx) };
    const fx = e.effects;
    if (fx.hp) { state.hp += fx.hp; state.stats.hpEarned += fx.hp; }
    if (fx.cash) state.cash += fx.cash;
    if (fx.copy) state.rival.progress = Math.max(0, Math.min(99, state.rival.progress + fx.copy));
    if (fx.boost) {
      if (fx.boost.all) { state.globalBoost = fx.boost.mult; state.globalBoostDays = fx.boost.days; }
      else { state.regions[region].boost = fx.boost.mult; state.regions[region].boostDays = fx.boost.days; }
    }
    if (fx.freeze) state.regions[region].freezeDays = fx.freeze;
    if (fx.reach) reach(state, region, -1);
    if (fx.rivalSeed) { seedRival(state, region); state.regions[region].r += 0.01; }
    const bad = fx.freeze || fx.cash < 0 || fx.copy > 0 || fx.rivalSeed || (fx.boost && fx.boost.mult < 1);
    return { type: "news", kind: bad ? "bad" : "good", text: fill(e.text, ctx), region };
  }
  return null;
}

function end(state, status, reason) {
  state.status = status;
  state.reason = reason;
}

export function collect(state, bubble) {
  if (bubble.type === "spy") {
    state.rival.progress = Math.max(0, state.rival.progress - bubble.setback);
    state.stats.spies++;
  } else {
    state.hp += bubble.value;
    state.stats.hpEarned += bubble.value;
  }
}
