// Progress between runs: the save file, unlock rules and achievements.
// No DOM code here, so tools/progress-check.mjs can test it in Node.

export const PROGRESS_KEY = "hypeinc.progress.v1";

export function newProgress() {
  return {
    version: 1,
    runs: 0, wins: 0, losses: 0, hardWins: 0,
    productWins: {},   // product id: wins
    scenarioWins: {},  // scenario id: wins
    achievements: {},  // achievement id: day it was earned (YYYY-MM-DD)
    best: {},          // product id: fewest days to win
    lastRun: null,
  };
}

// Make any loaded object safe to use. Unknown or broken fields get defaults.
export function cleanProgress(p) {
  const base = newProgress();
  if (!p || typeof p !== "object" || p.version !== 1) return base;
  for (const k of ["runs", "wins", "losses", "hardWins"]) base[k] = Number.isFinite(p[k]) && p[k] >= 0 ? Math.floor(p[k]) : 0;
  for (const k of ["productWins", "scenarioWins", "achievements", "best"]) {
    if (p[k] && typeof p[k] === "object" && !Array.isArray(p[k])) base[k] = { ...p[k] };
  }
  base.lastRun = p.lastRun && typeof p.lastRun === "object" ? p.lastRun : null;
  return base;
}

// ---------- Unlock rules ----------
// A rule is null (always open) or an object. All keys in the object must be true.
//   runs: n          finish n runs (win or lose)
//   wins: n          win n runs
//   hardWins: n      win n runs in Hard mode
//   productWon: id   win once with this product
//   productsWon: n   win with n different products
//   scenarioWon: id  win this scenario once
//   achievement: id  earn this achievement
export function ruleMet(rule, p) {
  if (!rule) return true;
  const won = Object.keys(p.productWins).filter((k) => p.productWins[k] > 0).length;
  const checks = {
    runs: (n) => p.runs >= n,
    wins: (n) => p.wins >= n,
    hardWins: (n) => p.hardWins >= n,
    productWon: (id) => (p.productWins[id] || 0) > 0,
    productsWon: (n) => won >= n,
    scenarioWon: (id) => (p.scenarioWins[id] || 0) > 0,
    achievement: (id) => !!p.achievements[id],
  };
  return Object.entries(rule).every(([k, v]) => (checks[k] ? checks[k](v) : false));
}

// Short text that tells the player how to open a locked thing.
export function ruleText(rule, data) {
  if (!rule) return "";
  const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const name = (list, id) => (list || []).find((x) => x.id === id)?.name || id;
  const parts = Object.entries(rule).map(([k, v]) => {
    switch (k) {
      case "runs": return `Finish ${plural(v, "run")}`;
      case "wins": return `Win ${plural(v, "run")}`;
      case "hardWins": return `Win ${plural(v, "run")} on Hard`;
      case "productWon": return `Win with ${name(data.products, v)}`;
      case "productsWon": return `Win with ${v} different products`;
      case "scenarioWon": return `Win ${name(data.scenarios, v)}`;
      case "achievement": return `Get "${name(data.achievements, v)}"`;
      default: return k;
    }
  });
  return parts.join(" and ");
}

// Everything the start screen can show, open or locked.
export function unlockState(p, data) {
  const u = data.unlocks;
  const item = (id, rule) => ({ id, open: ruleMet(rule, p), how: ruleText(rule, data) });
  return {
    products: data.products.map((x) => item(x.id, u.products[x.id] ?? null)),
    scenarios: (data.scenarios || []).map((x) => item(x.id, x.unlock ?? null)),
    colors: u.colors.map((c) => ({ ...item(c.id, c.unlock ?? null), hex: c.hex, name: c.name })),
    hard: item("hard", u.hard.unlock),
  };
}

// The ids that are open now. Used to find what a run unlocked.
function openIds(p, data) {
  const s = unlockState(p, data);
  const out = new Set();
  for (const k of ["products", "scenarios", "colors"]) for (const x of s[k]) if (x.open) out.add(`${k}:${x.id}`);
  if (s.hard.open) out.add("hard:hard");
  return out;
}

// ---------- Achievements ----------
// The facts about one finished run that achievements look at.
export function runSummary(state, data, { scenario = "kitchen", hard = false } = {}) {
  const bars = Array.isArray(state.rivals) ? state.rivals.map((r) => r.progress || 0) : [state.rival?.progress || 0];
  return {
    status: state.status,
    product: state.product,
    scenario, hard,
    day: state.day,
    cash: Math.round(state.cash),
    peakShare: state.stats?.peakShare || 0,
    spies: state.stats?.spies || 0,
    upgrades: Object.keys(state.owned || {}).filter((k) => state.owned[k]).length,
    regions: state.regions.filter((r) => r.reached).length,
    allRegions: state.regions.length,
    maxRivalBar: Math.max(0, ...bars),
    price: state.price,
  };
}

// A check is an object. All keys must be true for the run (and career after it).
//   status, product, scenario, hard   must be equal
//   maxDay, maxUpgrades               run value must be at most this
//   minSpies, minUpgrades, minCash, minRivalBar, minPeakShare   at least this
//   allRegions: true                  reach every region
//   careerRuns, careerWins, careerProductsWon, careerHardWins   totals after this run
export function checkMet(check, run, p) {
  const productsWon = Object.keys(p.productWins).filter((k) => p.productWins[k] > 0).length;
  const t = {
    status: (v) => run.status === v,
    product: (v) => run.product === v,
    scenario: (v) => run.scenario === v,
    hard: (v) => run.hard === v,
    maxDay: (v) => run.day <= v,
    maxUpgrades: (v) => run.upgrades <= v,
    minUpgrades: (v) => run.upgrades >= v,
    minSpies: (v) => run.spies >= v,
    minCash: (v) => run.cash >= v,
    minRivalBar: (v) => run.maxRivalBar >= v,
    minPeakShare: (v) => run.peakShare >= v,
    allRegions: (v) => !v || run.regions >= run.allRegions,
    careerRuns: (v) => p.runs >= v,
    careerWins: (v) => p.wins >= v,
    careerProductsWon: (v) => productsWon >= v,
    careerHardWins: (v) => p.hardWins >= v,
  };
  return Object.entries(check).every(([k, v]) => (t[k] ? t[k](v) : false));
}

// Add a finished run to the progress. Returns the new progress (the old one is
// not changed), the achievements earned in this run and the things it unlocked.
export function recordRun(progress, data, run, today = new Date().toISOString().slice(0, 10)) {
  const p = cleanProgress(JSON.parse(JSON.stringify(progress)));
  const before = openIds(p, data);
  p.runs++;
  if (run.status === "won") {
    p.wins++;
    if (run.hard) p.hardWins++;
    p.productWins[run.product] = (p.productWins[run.product] || 0) + 1;
    p.scenarioWins[run.scenario] = (p.scenarioWins[run.scenario] || 0) + 1;
    if (!(p.best[run.product] <= run.day)) p.best[run.product] = run.day;
  } else p.losses++;
  p.lastRun = run;

  const earned = [];
  for (const a of data.achievements) {
    if (p.achievements[a.id] || !checkMet(a.check, run, p)) continue;
    p.achievements[a.id] = today;
    earned.push(a);
  }

  const after = openIds(p, data);
  const unlocked = [...after].filter((x) => !before.has(x)).map((key) => {
    const [kind, id] = key.split(":");
    return { kind, id, name: unlockName(kind, id, data) };
  });
  return { progress: p, earned, unlocked };
}

function unlockName(kind, id, data) {
  if (kind === "hard") return "Hard mode";
  if (kind === "colors") return `${data.unlocks.colors.find((c) => c.id === id)?.name || id} brand colour`;
  const list = kind === "products" ? data.products : data.scenarios;
  return list?.find((x) => x.id === id)?.name || id;
}

// ---------- Hard mode ----------
// Hard mode changes the numbers, not the rules. Give it the data from
// engine.buildData() and the "hard" object from unlocks.json.
//   cashMult   x start cash (scenario, product and balance)
//   balance    keys of balance.json, x this value
//   rival      keys of each rival, x this value
export function applyHard(data, hard) {
  if (!hard) return data;
  const mult = (obj, m) => {
    const out = { ...obj };
    for (const [k, v] of Object.entries(m || {})) if (typeof out[k] === "number") out[k] *= v;
    return out;
  };
  const cash = { startCash: hard.cashMult ?? 1 };
  return {
    ...data,
    balance: mult(mult(data.balance, hard.balance), cash),
    scenario: mult(data.scenario, cash),
    product: mult(data.product, cash),
    rivals: data.rivals.map((r) => mult(r, hard.rival)),
    hard: true,
  };
}

// ---------- Save export ----------
// A short text the player can copy to keep the save or move it to a new device.
export function exportProgress(p) {
  const json = JSON.stringify(p);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json).toString("base64");
  return `HYPE1:${b64}`;
}

export function importProgress(text) {
  const m = /^HYPE1:([A-Za-z0-9+/=]+)$/.exec(String(text).trim());
  if (!m) return null;
  try {
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(m[1]))) : Buffer.from(m[1], "base64").toString();
    const p = JSON.parse(json);
    return p && p.version === 1 ? cleanProgress(p) : null;
  } catch { return null; }
}
