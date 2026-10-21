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

// Make the data for one game: one product and one scenario.
export function buildData(base, productId, scenarioId = "kitchen") {
  const product = base.products.find((p) => p.id === productId) || base.products[0];
  const scenario = base.scenarios.find((s) => s.id === scenarioId) || base.scenarios[0];
  const up = base.upgrades[fileId(product.upgrades)] || base.upgrades.soda;
  const files = (product.events || ["events/common.json"]).map((f) => base.events[fileId(f)]).filter(Boolean);
  const over = scenario.events || {};
  const events = {
    everyDays: (base.events.common || files[0]).everyDays,
    events: files.flatMap((f) => f.events).map((e) => (over[e.id] ? { ...e, ...over[e.id] } : e)),
    headlines: files.flatMap((f) => f.headlines || []),
  };
  return {
    regions: base.regions,
    product, scenario,
    upgrades: up.upgrades, trees: up.trees,
    events,
    rivals: base.rivals,
    balance: { ...base.balance, ...(scenario.balance || {}) },
    // Soda upgrades, to translate scenario upgrade ids to other products.
    sodaUpgrades: base.upgrades.soda.upgrades,
  };
}

function fileId(path) {
  return String(path || "").split("/").pop().replace(/\.json$/, "");
}

export function rivalDef(data, id) {
  return data.rivals.find((r) => r.id === id);
}

export function copyName(def, brand) {
  return def.copyPattern ? def.copyPattern.replace("{brand}", brand) : def.copy;
}

// The rival with the highest copy bar.
// The rival that owns the most people.
function biggestRival(state, data) {
  const pop = {};
  data.regions.forEach((d, i) => { const o = state.regions[i].rivalOwner; if (o) pop[o] = (pop[o] || 0) + d.pop * state.regions[i].r; });
  return state.rivals.reduce((a, r) => ((pop[r.id] || 0) > (pop[a.id] || 0) ? r : a), state.rivals[0]);
}

export function topRival(state) {
  return state.rivals.reduce((a, r) => (r.progress > a.progress ? r : a), state.rivals[0]);
}

export function newGame(data, { brand, color, start, seed = Date.now() }) {
  const sc = data.scenario, b = data.balance;
  const regions = data.regions.map(() => ({
    f: 0, r: 0, reached: false, rivalIn: false, rivalOwner: null,
    entry: -1, rivalEntry: -1, boost: 1, boostDays: 0, freezeDays: 0,
  }));
  const state = {
    version: 2,
    seed, rngState: seed,
    day: 0,
    brand, color,
    product: data.product.id,
    scenario: sc.id,
    cash: sc.startCash ?? data.product.startCash ?? b.startCash,
    hp: sc.hp ?? 2,
    price: "normal",
    owned: {},
    regions,
    rivals: [],
    mods: [],
    globalBoost: 1, globalBoostDays: 0,
    nextEventDay: 15,
    status: "playing", reason: "",
    stats: { peakShare: 0, hpEarned: sc.hp ?? 2, spies: 0, revenue: 0 },
  };
  for (const id of sc.owned || []) {
    const u = sameUpgrade(data, id);
    if (u) state.owned[u.id] = true;
  }
  const ids = data.regions.map((g) => g.id);
  const startIndex = typeof start === "number" ? start : ids.indexOf(sc.start);
  reach(state, startIndex, -1);
  state.regions[startIndex].f = sc.startShare ?? 0.002;

  state.rivals = (sc.rivals || [{ id: "megacorp" }]).map((sr) => {
    const def = rivalDef(data, sr.id);
    for (const rid of sr.seedRegions || []) {
      const i = ids.indexOf(rid);
      if (i >= 0) seedRival(state, i, def.id, 0.02);
    }
    return {
      id: def.id, noticed: !!sr.noticed, progress: sr.progress || 0, rateMult: sr.rateMult || 1,
      nextThink: def.thinkEvery[0], cooldowns: {}, lastReachDay: 0, reachedCount: 0, faded: false, stuckWarned: false,
    };
  });
  return state;
}

// Scenario upgrades use soda ids. Find the upgrade in the same tree cell of this product.
function sameUpgrade(data, id) {
  const own = data.upgrades.find((u) => u.id === id);
  if (own) return own;
  const soda = data.sodaUpgrades.find((u) => u.id === id);
  if (!soda) return null;
  return data.upgrades.find((u) => u.tree === soda.tree && u.pos[0] === soda.pos[0] && u.pos[1] === soda.pos[1]) || null;
}

const MOD_KEYS = ["appeal", "social", "shops", "tv", "travel", "resist", "loyalty", "patent", "costCut", "margin", "bubbles", "autoCollect"];

// Sum the effects of all owned upgrades and the product itself.
export function mods(state, data) {
  const m = { upkeep: 0 };
  for (const k of MOD_KEYS) m[k] = data.product.effects?.[k] || 0;
  for (const u of data.upgrades) {
    if (!state.owned[u.id]) continue;
    for (const [k, v] of Object.entries(u.effects)) if (k in m) m[k] += v;
    m.upkeep += u.upkeep;
  }
  return m;
}

// Timed effects from rival tactics (state.mods).
function modMult(state, type, i, channel) {
  let m = 1;
  for (const x of state.mods) {
    if (x.type !== type) continue;
    if (x.region !== -1 && x.region !== i) continue;
    if (channel && x.channel !== channel) continue;
    m *= x.mult;
  }
  return m;
}
const modResist = (state, i) => state.mods.reduce((s, x) => (x.type === "resist" && x.region === i ? s + x.add : s), 0);
export const isBlocked = (state, i) => state.mods.some((x) => x.type === "block" && x.region === i);
const bubbleStealChance = (state) => state.mods.reduce((s, x) => (x.type === "bubbleSteal" ? Math.max(s, x.chance) : s), 0);

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
    revenue += d.pop * state.regions[i].f * d.wealth * b.margin * price.revenue * Math.max(0.1, 1 + m.margin) * modMult(state, "income", i);
  });
  const costs = (b.baseCost + m.upkeep) * Math.max(0.2, 1 - m.costCut);
  return { revenue, costs, net: revenue - costs };
}

export function growthRate(state, data, i, m = mods(state, data)) {
  const b = data.balance, d = data.regions[i], s = state.regions[i];
  const p = data.product;
  const appeal = p.appeal + m.appeal;
  const social = (p.social + m.social) * modMult(state, "channel", i, "social");
  const shops = (p.shops + m.shops) * modMult(state, "channel", i, "shops");
  const channel = b.wordOfMouth + social * d.digital + shops * d.retail + m.tv;
  const resist = Math.min(0.95, d.resist * Math.max(0, 1 - m.resist) + modResist(state, i));
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
    const top = topRival(state);
    top.progress = Math.max(0, top.progress - u.effects.setback);
    state.regions.forEach((s) => { if (s.rivalOwner === top.id) s.r *= 0.6; });
  }
  return true;
}

function reach(state, i, from) {
  const s = state.regions[i];
  if (s.reached) return false;
  s.reached = true;
  s.entry = from; // the UI starts the colour near the region it came from
  s.f = Math.max(s.f, 0.0005);
  return true;
}

function seedRival(state, i, id, share = 0.003) {
  const s = state.regions[i];
  if (s.rivalIn && s.rivalOwner !== id) return false;
  if (!s.rivalIn) s.rivalEntry = i;
  s.rivalIn = true;
  s.rivalOwner = id;
  s.r = Math.max(s.r, share);
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

function rivalCtx(state, data, def, region) {
  return { brand: state.brand, rival: def.name, copy: copyName(def, state.brand), region: region >= 0 ? data.regions[region].name : "" };
}

// Advance one day. Returns a list of things the UI shows: news, bubbles, alerts, end.
export function step(state, data) {
  if (state.status !== "playing") return [];
  const out = [];
  const b = data.balance;
  const m = mods(state, data);
  state.day++;

  // Grow inside each region.
  data.regions.forEach((d, i) => {
    const s = state.regions[i];
    if (!s.reached) return;
    const room = Math.max(0, 1 - s.f - s.r);
    if (s.freezeDays > 0) s.freezeDays--;
    else s.f += growthRate(state, data, i, m) * (s.f + b.seedShare) * room;
    if (s.boostDays > 0 && --s.boostDays === 0) s.boost = 1;
  });
  if (state.globalBoostDays > 0 && --state.globalBoostDays === 0) state.globalBoost = 1;

  // Spread to new regions.
  const travel = Math.max(0.1, 1 + m.travel);
  data.regions.forEach((d, j) => {
    if (state.regions[j].reached || isBlocked(state, j)) return;
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
      out.push({ type: "reached", region: j });
      out.push({ type: "news", kind: "good", text: `${state.brand} arrives in ${d.name}!` });
      out.push({ type: "bubble", region: j, value: 2 });
    }
  });

  // Rivals: notice, copy bar, tactics, spies.
  const ws = worldShare(state, data);
  for (const rs of state.rivals) out.push(...stepRival(rs, state, data, ws.share, m));
  for (const x of state.mods) x.days--;
  state.mods = state.mods.filter((x) => x.days > 0);

  // Rival growth in regions.
  data.regions.forEach((d, i) => {
    const s = state.regions[i];
    if (!s.rivalIn) return;
    const def = rivalDef(data, s.rivalOwner);
    const rs = state.rivals.find((r) => r.id === s.rivalOwner);
    const strength = def.growth * (1 + (rs ? rs.progress : 0) / 100);
    const room = Math.max(0, 1 - s.f - s.r);
    s.r += strength * (s.r + 0.0005) * room;
    const stolen = def.steal * s.r * s.f * Math.max(0, 1 - m.loyalty);
    s.f -= stolen; s.r = Math.min(1 - s.f, s.r + stolen);
  });

  // Money.
  const money = dailyMoney(state, data, m);
  state.cash += money.net;
  state.stats.revenue += money.revenue;

  // Hype bubbles.
  if (rng(state) < b.bubbleChance * Math.max(0.2, 1 + m.bubbles)) {
    const where = pickWeighted(state, data.regions.map((_, i) => i), (i) => state.regions[i].reached ? 0.02 + state.regions[i].f : 0);
    if (where !== null && rng(state) >= bubbleStealChance(state)) out.push({ type: "bubble", region: where, value: rng(state) < 0.2 ? 2 : 1 });
  }

  // News events.
  if (state.day >= state.nextEventDay) {
    const [lo, hi] = data.events.everyDays;
    state.nextEventDay = state.day + lo + Math.floor(rng(state) * (hi - lo));
    const ev = runEvent(state, data);
    if (ev) out.push(ev);
    else if (data.events.headlines.length) out.push({ type: "news", kind: "fun", text: fill(data.events.headlines[Math.floor(rng(state) * data.events.headlines.length)], { brand: state.brand }) });
  }

  // Win and lose.
  const after = worldShare(state, data);
  state.stats.peakShare = Math.max(state.stats.peakShare, after.share);
  // A rival also wins when its copies own most of the world, even if its copy bar is low.
  const done = state.rivals.find((r) => r.progress >= 100) ||
    (after.rivalShare >= (b.rivalLoseShare ?? 0.6) ? biggestRival(state, data) : null);
  if (after.share >= b.winShare) {
    const def = rivalDef(data, topRival(state).id);
    end(state, "won", `${state.brand} is loved all over the world. ${fill(def.lines.win, rivalCtx(state, data, def, -1))}`);
  } else if (done) {
    const def = rivalDef(data, done.id);
    end(state, "lost", fill(def.lines.lose, rivalCtx(state, data, def, -1)));
    state.lostTo = done.id;
  } else if (state.cash < 0) end(state, "lost", `You ran out of cash. ${state.brand} had to close down.`);
  if (state.status !== "playing") out.push({ type: "end", status: state.status });
  return out;
}

// One day for one rival. Based on the rivals workstream's rival-ai.js.
function stepRival(rs, state, data, share, m) {
  const def = rivalDef(data, rs.id);
  const ctx = (region = -1) => rivalCtx(state, data, def, region);
  const out = [];
  const reachedNow = state.regions.filter((r) => r.reached).length;
  if (reachedNow > rs.reachedCount) { rs.reachedCount = reachedNow; rs.lastReachDay = state.day; }

  if (!rs.noticed) {
    if (share >= def.noticeShare || state.day >= def.noticeDay) {
      rs.noticed = true;
      rs.nextThink = state.day + def.thinkEvery[0];
      // Start in the player's biggest region, or the rival's home region.
      let top = 0;
      state.regions.forEach((s, i) => { if (s.f * data.regions[i].pop > state.regions[top].f * data.regions[top].pop) top = i; });
      if (!seedRival(state, top, def.id)) seedRival(state, data.regions.findIndex((g) => g.id === def.home), def.id);
      out.push({ type: "alert", rival: def.id, title: `${def.name} noticed you!`, text: fill(def.lines.notice, ctx()) });
    }
    return out;
  }

  // Copy bar.
  let rate = def.copyBaseRate + def.copyShareRate * share;
  rate *= Math.max(0.1, 1 - m.patent);
  if (def.appealSlows) rate *= 1 - Math.min(0.6, m.appeal * def.appealSlows);
  if (def.fade && state.day >= def.fade.afterDay) {
    rate *= def.fade.mult;
    if (!rs.faded) { rs.faded = true; out.push({ type: "news", kind: "good", text: fill(def.fade.text, ctx()) }); }
  }
  if (def.stuck && state.day - rs.lastReachDay >= def.stuck.days && reachedNow < state.regions.length) {
    rate += def.stuck.rate;
    if (!rs.stuckWarned) { rs.stuckWarned = true; out.push({ type: "news", kind: "bad", text: fill(def.stuck.text, ctx()) }); }
  } else rs.stuckWarned = false;
  const before = rs.progress;
  rs.progress = Math.min(100, rs.progress + rate * rs.rateMult);
  if (before < 50 && rs.progress >= 50) out.push({ type: "news", kind: "bad", text: fill(def.lines.half, ctx()) });
  if (before < 85 && rs.progress >= 85) out.push({ type: "alert", rival: def.id, title: "Almost too late!", text: fill(def.lines.almost, ctx()) });

  // Enter more of the player's regions.
  state.regions.forEach((s, i) => {
    if (s.reached && !s.rivalIn && rng(state) < def.spreadChance) seedRival(state, i, def.id);
  });

  // Tactics.
  if (state.day >= rs.nextThink) {
    const [lo, hi] = def.thinkEvery;
    rs.nextThink = state.day + lo + Math.floor(rng(state) * (hi - lo + 1));
    const ok = def.tactics.filter((t) => (rs.cooldowns[t.id] ?? -Infinity) <= state.day && whenOk(t.when, state, share));
    const t = pickWeighted(state, ok, (x) => x.weight);
    if (t) {
      const ri = pickTarget(t.target, def, state, data);
      if (t.target === "none" || ri >= 0) {
        const c = t.counter ? Math.min(0.9, (m[t.counter.key] || 0) * t.counter.cut) : 0;
        applyTactic(t, rs, def, state, ri, 1 - c);
        rs.cooldowns[t.id] = state.day + t.cooldown;
        const text = c >= 0.5 && t.counterText ? t.counterText : t.text;
        out.push({ type: "news", kind: c >= 0.5 ? "good" : "bad", rival: def.id, region: ri, text: fill(text, ctx(ri)) });
      }
    }
  }

  // Spy bubbles.
  if (rng(state) < def.spyChance) {
    const where = pickWeighted(state, data.regions.map((_, i) => i), (i) => (state.regions[i].rivalOwner === def.id ? state.regions[i].r : 0));
    if (where !== null) out.push({ type: "spy", region: where, rival: def.id });
  }
  return out;
}

function whenOk(when, state, share) {
  if (!when) return true;
  if (when.minDay != null && state.day < when.minDay) return false;
  if (when.playerShare != null && share < when.playerShare) return false;
  if (when.owns != null && !state.owned[when.owns]) return false;
  if (when.playerUpgrades != null && Object.keys(state.owned).length < when.playerUpgrades) return false;
  if (when.playerRegions != null && state.regions.filter((r) => r.reached).length < when.playerRegions) return false;
  return true;
}

function pickTarget(target, def, state, data) {
  const regs = data.regions;
  const all = regs.map((_, i) => i);
  const reached = all.filter((i) => state.regions[i].reached);
  const best = (list, score) => list.reduce((a, i) => (a < 0 || score(i) > score(a) ? i : a), -1);
  switch (target) {
    case "playerTop": return best(reached, (i) => state.regions[i].f * regs[i].pop);
    case "richestReached": return best(reached, (i) => regs[i].wealth);
    case "mostDigitalReached": return best(reached, (i) => regs[i].digital);
    case "playerNext": {
      const next = all.filter((i) => !state.regions[i].reached &&
        regs[i].neighbors.some((n) => reached.includes(regs.findIndex((g) => g.id === n))));
      const pool = next.length ? next : all.filter((i) => !state.regions[i].reached);
      const key = def.prefers || "pop";
      return best(pool, (i) => (regs[i][key] ?? 0) + rng(state) * 0.2);
    }
    default: return -1;
  }
}

// strength is 0 to 1: lower when the player owns the counter upgrade.
function applyTactic(t, rs, def, state, ri, strength) {
  const e = t.effects;
  const reg = ri >= 0 ? state.regions[ri] : null;
  const soften = (x) => 1 - (1 - x) * strength;
  if (e.copy) rs.progress = Math.min(100, rs.progress + e.copy * strength);
  if (reg && e.boost) { reg.boost = soften(e.boost.mult); reg.boostDays = e.boost.days; }
  if (reg && e.freeze) reg.freezeDays = Math.max(reg.freezeDays || 0, Math.round(e.freeze * strength));
  if (reg && e.rivalSeed) seedRival(state, ri, def.id, 0.01);
  if (reg && e.steal && (!reg.rivalIn || reg.rivalOwner === def.id)) {
    const moved = reg.f * e.steal * strength;
    reg.f -= moved;
    seedRival(state, ri, def.id);
    reg.r = Math.min(1, reg.r + moved);
  }
  const mod = (type, extra) => state.mods.push({ type, rival: def.id, region: ri, ...extra });
  if (e.incomeMult) mod("income", { mult: soften(e.incomeMult.mult), days: e.incomeMult.days });
  if (e.resist && ri >= 0) mod("resist", { add: e.resist.add * strength, days: e.resist.days });
  if (e.block && ri >= 0) mod("block", { days: Math.round(e.block * strength) });
  if (e.channel) {
    for (const ch of ["social", "shops"]) {
      if (e.channel[ch] != null) mod("channel", { channel: ch, region: -1, mult: soften(e.channel[ch]), days: e.channel.days });
    }
  }
  if (e.bubbleSteal) mod("bubbleSteal", { region: -1, chance: e.bubbleSteal.chance * strength, days: e.bubbleSteal.days });
}

function runEvent(state, data) {
  const noticed = state.rivals.filter((r) => r.noticed);
  const rs = noticed.length ? noticed.reduce((a, r) => (r.progress > a.progress ? r : a)) : state.rivals[0];
  const def = rivalDef(data, rs.id);
  const ok = data.events.events.filter((e) => state.day >= e.minDay && (!e.needsRival || noticed.length));
  for (let tries = 0; tries < 5; tries++) {
    const e = pickWeighted(state, ok, (x) => x.weight);
    if (!e) return null;
    let region = -1;
    if (e.target !== "none") {
      const pool = data.regions.map((_, i) => i).filter((i) => {
        const s = state.regions[i];
        if (e.target === "reached" && !s.reached) return false;
        if (e.target === "unreached" && (s.reached || isBlocked(state, i))) return false;
        if (e.hotOnly && !data.regions[i].hot) return false;
        return true;
      });
      if (!pool.length) continue;
      region = pool[Math.floor(rng(state) * pool.length)];
    }
    const ctx = rivalCtx(state, data, def, region);
    if (e.skipIf && state.owned[e.skipIf]) return { type: "news", kind: "good", text: fill(e.skipText, ctx) };
    const fx = e.effects;
    if (fx.hp) { state.hp += fx.hp; state.stats.hpEarned += fx.hp; }
    if (fx.cash) state.cash += fx.cash;
    if (fx.copy) rs.progress = Math.max(0, Math.min(99, rs.progress + fx.copy));
    if (fx.boost) {
      if (fx.boost.all) { state.globalBoost = fx.boost.mult; state.globalBoostDays = fx.boost.days; }
      else { state.regions[region].boost = fx.boost.mult; state.regions[region].boostDays = fx.boost.days; }
    }
    if (fx.freeze) state.regions[region].freezeDays = fx.freeze;
    if (fx.reach) reach(state, region, -1);
    if (fx.rivalSeed && seedRival(state, region, rs.id)) {
      const g = state.regions[region];
      g.r = Math.min(1 - g.f, g.r + 0.01);
    }
    const bad = fx.freeze || fx.cash < 0 || fx.copy > 0 || fx.rivalSeed || (fx.boost && fx.boost.mult < 1);
    return { type: "news", kind: bad ? "bad" : "good", text: fill(e.text, ctx), region, cash: fx.cash || 0 };
  }
  return null;
}

function end(state, status, reason) {
  state.status = status;
  state.reason = reason;
}

export function collect(state, data, bubble) {
  if (bubble.type === "spy") {
    const rs = state.rivals.find((r) => r.id === bubble.rival) || topRival(state);
    rs.progress = Math.max(0, rs.progress - rivalDef(data, rs.id).spySetback);
    state.stats.spies++;
  } else {
    state.hp += bubble.value;
    state.stats.hpEarned += bubble.value;
  }
}
