// Screen code: map drawing, bubbles, panels, sound and the game loop.
import { BASE } from "./data.js";
import { MAP } from "./map-data.js";
import { Sound } from "./sound.js";
import {
  buildData, newGame, step, buy, collect, mods, worldShare, dailyMoney, canBuy,
  rivalDef, copyName, topRival, isBlocked,
} from "./engine.js";
import { applyHard } from "./progress.js";
import {
  isOpen, howToOpen, brandColors, renderHard, finishRun, openTrophies, closeTrophies,
} from "./progress-ui.js";

const $ = (id) => document.getElementById(id);
const SAVE_KEY = "hypeinc.save.v2";
// Brand colours are in data/unlocks.json. Each passes 4.5:1 with dark text.
const COLORS = BASE.unlocks.colors.map((c) => c.hex);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no storage */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* no storage */ } },
};

const sound = new Sound({ base: "./sound/" });
sound.load().catch(() => {});
sound.music("music_menu");
const sfx = (name, opts) => { try { sound.play(name, opts); } catch { /* sound is optional */ } };

// ---------- Map geometry ----------
const W = MAP.cols + 1, H = MAP.rows;
const N = MAP.dots.length / 3;
const dx = new Float32Array(N), dy = new Float32Array(N), dreg = new Uint8Array(N);
const grid = new Int32Array(MAP.cols * MAP.rows).fill(-1);
const regionDots = BASE.regions.map(() => []);
for (let i = 0; i < N; i++) {
  const c = MAP.dots[i * 3], r = MAP.dots[i * 3 + 1], g = MAP.dots[i * 3 + 2];
  dx[i] = c + (r % 2 ? 0.5 : 0) + 0.5;
  dy[i] = r + 0.5;
  dreg[i] = g;
  grid[r * MAP.cols + c] = i;
  regionDots[g].push(i);
}
const centroid = regionDots.map((list) => {
  let x = 0, y = 0;
  for (const i of list) { x += dx[i]; y += dy[i]; }
  return [x / list.length, y / list.length];
});

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// The order in which a region's dots change colour, spreading out from one dot.
const orderCache = new Map();
function dotOrder(g, from, salt) {
  const key = `${g}:${from}:${salt}`;
  if (orderCache.has(key)) return orderCache.get(key);
  const list = regionDots[g];
  let seed;
  if (from >= 0 && from !== g) {
    const [cx, cy] = centroid[from];
    seed = list.reduce((best, i) => ((dx[i] - cx) ** 2 + (dy[i] - cy) ** 2 < (dx[best] - cx) ** 2 + (dy[best] - cy) ** 2 ? i : best), list[0]);
  } else {
    seed = list[Math.floor(hash(salt * 131 + g * 7 + 3) * list.length)];
  }
  const d = list.map((i) => [i, Math.hypot(dx[i] - dx[seed], dy[i] - dy[seed]) + hash(i * 17 + salt) * 5]);
  d.sort((a, b) => a[1] - b[1]);
  const out = Int32Array.from(d, (x) => x[0]);
  orderCache.set(key, out);
  return out;
}

// ---------- State ----------
let data = buildData(BASE, BASE.products[0].id, "kitchen");
let state = null;
let mode = "title"; // title, pick, play, over
let speed = 1, lastSpeed = 1;
let selected = -1;
let acc = 0;
let bubbles = [];
const news = [];
const pick = { product: BASE.products[0].id, scenario: "kitchen", color: COLORS[0], hard: false };
let tab = "product", chosenUpgrade = null;
let firstBubbleHint = true;
let lastMilestone = 0;

// ---------- Icons ----------
const SPRITE = new Set([...document.querySelectorAll("symbol[id^='i-']")].map((s) => s.id.slice(2)));
function icon(id, fallback = "") {
  return SPRITE.has(id) ? `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>` : `<span aria-hidden="true">${fallback}</span>`;
}
// The art set has icons for the soda upgrades. Other products use their emoji.
const upgradeIcon = (u) => (data.product.id === "soda" ? icon(u.id, u.icon) : `<span aria-hidden="true">${u.icon}</span>`);

// ---------- Canvas ----------
const canvas = $("map"), ctx = canvas.getContext("2d");
const stage = $("stage");
const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, wrap: false };
let dirty = true;
let colors = {};

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  colors = { land: v("--land"), landHi: v("--land-hi"), brand: v("--brand"), glow: v("--brand-glow") };
  dirty = true;
}

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const oldCenter = view.w ? ((view.w / 2 - view.ox) / view.s) : null;
  view.w = r.width; view.h = r.height;
  const fit = Math.min(r.width / W, r.height / H);
  view.s = r.width / r.height < 1.4 ? Math.min(r.height / H, (r.width * 2.3) / W) : fit;
  view.s = Math.max(view.s, fit);
  view.wrap = W * view.s > r.width + 1;
  view.oy = (r.height - H * view.s) / 2;
  if (view.wrap) {
    const cx = oldCenter ?? (selected >= 0 ? centroid[selected][0] : W * 0.55);
    view.ox = r.width / 2 - cx * view.s;
  } else view.ox = (r.width - W * view.s) / 2;
  dirty = true;
}

function centerOn(g) {
  if (!view.wrap || g < 0) return;
  view.ox = view.w / 2 - centroid[g][0] * view.s;
  dirty = true;
}

// Map look from the art workstream: unlit land small, brand dots big with a glow,
// rival dots as rings in the rival's colour.
function draw() {
  dirty = false;
  ctx.clearRect(0, 0, view.w, view.h);
  const owner = new Int8Array(N); // 0 land, 1 mine, 2 + rival index
  if (state) {
    const salt = state.seed % 1000;
    const vis = (x) => Math.pow(Math.max(0, x), 0.75); // small shares show a bit bigger
    data.regions.forEach((_, g) => {
      const s = state.regions[g];
      const list = regionDots[g], n = list.length;
      const mine = s.reached ? Math.max(1, Math.round(vis(s.f) * n)) : 0;
      let theirs = s.rivalIn ? Math.max(1, Math.round(vis(s.r) * n)) : 0;
      if (mine) { const o = dotOrder(g, s.entry, salt); for (let k = 0; k < mine && k < n; k++) owner[o[k]] = 1; }
      if (theirs) {
        const ri = 2 + Math.max(0, state.rivals.findIndex((r) => r.id === s.rivalOwner));
        const o = dotOrder(g, s.rivalEntry === g ? -1 : s.rivalEntry, salt + 500);
        for (let k = 0; k < n && theirs > 0; k++) { if (owner[o[k]] === 0) { owner[o[k]] = ri; theirs--; } }
      }
    });
  }
  const s = view.s;
  const shifts = view.wrap ? [-W * s, 0, W * s] : [0];
  const dots = (test, rad, ring) => {
    for (const sh of shifts) {
      const base = view.ox + sh;
      if (base > view.w || base + W * s < 0) continue;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (!test(i)) continue;
        const x = base + dx[i] * s, y = view.oy + dy[i] * s;
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, Math.PI * 2);
      }
      if (ring) ctx.stroke(); else ctx.fill();
    }
  };
  ctx.shadowBlur = 0;
  ctx.fillStyle = colors.land;
  dots((i) => owner[i] === 0 && dreg[i] !== selected, Math.max(0.8, s * 0.3));
  if (selected >= 0) { ctx.fillStyle = colors.landHi; dots((i) => owner[i] === 0 && dreg[i] === selected, Math.max(0.8, s * 0.34)); }
  if (state) {
    state.rivals.forEach((r, k) => {
      ctx.strokeStyle = rivalDef(data, r.id).color;
      ctx.lineWidth = Math.max(0.7, s * 0.16);
      dots((i) => owner[i] === k + 2, Math.max(0.8, s * 0.3), true);
    });
    ctx.fillStyle = colors.brand;
    if (view.w > 500) { ctx.shadowColor = colors.glow; ctx.shadowBlur = s * 0.9; }
    dots((i) => owner[i] === 1, Math.max(1, s * 0.42));
    ctx.shadowBlur = 0;
  }
  placeBubbles();
}

function toScreen(i) {
  let x = view.ox + dx[i] * view.s;
  if (view.wrap) {
    const span = W * view.s;
    x = ((x % span) + span) % span;
    if (x > view.w + 30) x -= span;
  }
  return [x, view.oy + dy[i] * view.s];
}

function dotAt(px, py) {
  let u = (px - view.ox) / view.s;
  if (view.wrap) u = ((u % W) + W) % W;
  const v = (py - view.oy) / view.s;
  let best = -1, bd = 2.2 * 2.2;
  const r0 = Math.floor(v);
  for (let r = r0 - 2; r <= r0 + 2; r++) {
    if (r < 0 || r >= MAP.rows) continue;
    const c0 = Math.floor(u - (r % 2 ? 0.5 : 0) - 0.5);
    for (let c = c0 - 2; c <= c0 + 2; c++) {
      if (c < 0 || c >= MAP.cols) continue;
      const i = grid[r * MAP.cols + c];
      if (i < 0) continue;
      const d = (dx[i] - u) ** 2 + (dy[i] - v) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

// ---------- Map input: drag to pan, tap to select ----------
let drag = null;
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".bubble, #regioncard, #newslog")) return;
  drag = { x: e.clientX, y: e.clientY, ox: view.ox, moved: false, id: e.pointerId };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const ddx = e.clientX - drag.x;
  if (Math.abs(ddx) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
  if (drag.moved && view.wrap) { view.ox = drag.ox + ddx; stage.classList.add("dragging"); dirty = true; }
});
stage.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  stage.classList.remove("dragging");
  const wasTap = !drag.moved;
  drag = null;
  if (!wasTap) return;
  $("newslog").hidden = true;
  const r = stage.getBoundingClientRect();
  const i = dotAt(e.clientX - r.left, e.clientY - r.top);
  if (i >= 0) sfx("ui_tap");
  selectRegion(i >= 0 ? dreg[i] : -1);
});
stage.addEventListener("pointercancel", () => { drag = null; stage.classList.remove("dragging"); });

function selectRegion(g) {
  selected = g;
  dirty = true;
  renderRegionCard();
}

const pips = (v, bad) => `<span class="pips${bad ? " bad" : ""}">${[0, 1, 2, 3, 4].map((k) => `<i class="${v * 5 > k + 0.3 ? "on" : ""}"></i>`).join("")}</span>`;

function renderRegionCard() {
  const card = $("regioncard");
  if (selected < 0) { card.hidden = true; return; }
  const d = data.regions[selected];
  let status = "";
  if (state) {
    const s = state.regions[selected];
    const notes = [];
    if (isBlocked(state, selected)) notes.push("Blocked by a rival deal");
    if (!s.reached) status = `<div class="sub">${esc(state.brand)} is not here yet.${notes.length ? " " + notes.join(" · ") : ""}</div>`;
    else {
      if (s.freezeDays > 0) notes.push(`No growth for ${s.freezeDays} days`);
      if (s.boost > 1) notes.push(`Boost x${s.boost} for ${s.boostDays} days`);
      if (s.boost < 1) notes.push(`Slowed x${s.boost} for ${s.boostDays} days`);
      const rv = s.rivalOwner ? rivalDef(data, s.rivalOwner) : null;
      status = `<div class="sub">You <b style="color:var(--brand)">${pct(s.f)}</b>${rv ? ` · ${esc(rv.name)} <b style="color:${rv.color}">${pct(s.r)}</b>` : ""}${notes.length ? " · " + notes.join(" · ") : ""}</div>`;
    }
  }
  card.innerHTML = `
    <button class="close" type="button" aria-label="Close">${icon("close", "✕")}</button>
    <h3>${esc(d.name)}</h3>
    <div class="sub">${fmtPeople(d.pop)} people</div>
    ${status}
    <div class="traits">
      <span>Money per fan</span>${pips(d.wealth)}
      <span>Online a lot</span>${pips(d.digital)}
      <span>Lots of shops</span>${pips(d.retail)}
      <span>Hard to sell</span>${pips(d.resist * 2, true)}
    </div>
    ${mode === "pick" ? `<button class="btn launch" type="button" id="launchbtn">Launch in ${esc(d.name)}</button>` : ""}`;
  card.hidden = false;
  card.querySelector(".close").onclick = () => { sfx("ui_back"); selectRegion(-1); };
  const lb = $("launchbtn");
  if (lb) lb.onclick = () => launch(selected);
}

// ---------- Bubbles ----------
function spawnBubble(region, value, type, rivalId) {
  if (bubbles.length > 14) return;
  const s = state.regions[region];
  const list = regionDots[region];
  let i;
  if (type === "spy") i = list[Math.floor(Math.random() * list.length)];
  else {
    const o = dotOrder(region, s.entry, state.seed % 1000);
    const lit = Math.max(1, Math.min(list.length, Math.round(Math.pow(s.f, 0.75) * list.length)));
    i = o[Math.floor(Math.random() * lit)];
  }
  const el = document.createElement("button");
  el.type = "button";
  el.className = "bubble" + (type === "spy" ? " spy" : "");
  let life = data.balance.bubbleLifeMs;
  if (type === "spy") {
    const def = rivalDef(data, rivalId);
    el.style.setProperty("--rc", def.color);
    el.innerHTML = icon("spy", "SPY");
    el.setAttribute("aria-label", `Catch the ${def.name} spy`);
    life = def.spyLifeMs;
  } else {
    el.textContent = `+${value}`;
    el.setAttribute("aria-label", `Collect ${value} Hype`);
  }
  const b = { el, dot: i, value, type, rival: rivalId, age: 0, life };
  el.addEventListener("pointerdown", (e) => { e.stopPropagation(); pop(b); });
  $("bubbles").appendChild(el);
  bubbles.push(b);
  placeBubble(b);
}

function placeBubble(b) {
  const [x, y] = toScreen(b.dot);
  b.el.style.left = `${x}px`;
  b.el.style.top = `${y - 10}px`;
}
function placeBubbles() { bubbles.forEach(placeBubble); }

function pop(b, auto = false) {
  if (b.done) return;
  b.done = true;
  if (b.type === "spy") { collect(state, data, { type: "spy", rival: b.rival }); sfx("spy_caught"); }
  else {
    collect(state, data, { type: "bubble", value: b.value });
    if (auto) sfx("coin", { volume: 0.6, pitchVariance: 0.06 }); else sfx("bubble_pop", { pitchVariance: 0.12 });
  }
  firstBubbleHint = false;
  if ($("banner").dataset.hint === "bubble") hideBanner();
  b.el.classList.add("gone");
  const f = document.createElement("div");
  f.className = "floater" + (b.type === "spy" ? " spy" : "");
  f.textContent = b.type === "spy" ? `-${rivalDef(data, b.rival).spySetback}%` : `+${b.value}`;
  f.style.left = b.el.style.left; f.style.top = b.el.style.top;
  if (auto) f.style.opacity = "0.7";
  $("bubbles").appendChild(f);
  setTimeout(() => { b.el.remove(); f.remove(); }, 900);
  bubbles = bubbles.filter((x) => x !== b);
  updateHud();
}

function clearBubbles() {
  bubbles.forEach((b) => b.el.remove());
  bubbles = [];
}

// ---------- HUD ----------
function esc(t) { return String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }
function pct(x) { return x <= 0 ? "0%" : x < 0.001 ? "<0.1%" : x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`; }
function fmtCash(k) {
  const sign = k < 0 ? "-" : "", a = Math.abs(k);
  if (a < 1000) return `${sign}$${Math.round(a)}k`;
  if (a < 1e6) return `${sign}$${(a / 1000).toFixed(a < 1e4 ? 2 : 1)}M`;
  return `${sign}$${(a / 1e6).toFixed(2)}B`;
}
function fmtPeople(m) {
  if (m < 1) return `${Math.round(m * 1000)}k`;
  if (m < 1000) return `${Math.round(m)} million`;
  return `${(m / 1000).toFixed(1)} billion`;
}

function buildRivalBars() {
  const box = $("rivalbox");
  box.classList.toggle("many", state.rivals.length > 1);
  box.innerHTML = state.rivals.map((r) => {
    const def = rivalDef(data, r.id);
    return `<div class="rival" id="rv-${r.id}" style="--rc:${def.color}">
      <div class="rival-top"><span><b>${esc(copyName(def, state.brand))}</b> <span class="txt"></span></span><span class="pct"></span></div>
      <div class="meter"><div class="copy"></div></div></div>`;
  }).join("");
}

function updateHud() {
  if (!state) return;
  const ws = worldShare(state, data);
  const money = dailyMoney(state, data);
  const goal = data.balance.winShare;
  $("day").textContent = `Day ${state.day}`;
  $("sharepct").textContent = pct(ws.share);
  $("goalpct").textContent = `${Math.round(goal * 100)}%`;
  $("goalmark").style.left = `${goal * 100}%`;
  $("sharebar").style.width = `${Math.min(100, ws.share * 100)}%`;
  $("rivalsharebar").style.width = `${Math.min(100, ws.rivalShare * 100)}%`;
  $("cash").textContent = fmtCash(state.cash);
  const net = $("net");
  net.textContent = `${money.net >= 0 ? "+" : ""}${fmtCash(money.net)}/day`;
  net.className = "net " + (money.net >= 0 ? "up" : "down");
  $("cashstat").classList.toggle("low", money.net < 0 && state.cash < -money.net * 20);
  $("hp").textContent = state.hp;
  $("upbadge").textContent = state.hp;
  const affordable = data.upgrades.some((u) => canBuy(state, data, u) && state.hp >= u.cost);
  $("upbtn").classList.toggle("ready", affordable);
  for (const r of state.rivals) {
    const el = $(`rv-${r.id}`);
    if (!el) continue;
    const def = rivalDef(data, r.id);
    el.querySelector(".copy").style.width = `${r.progress}%`;
    el.querySelector(".pct").textContent = r.noticed ? `${Math.floor(r.progress)}%` : "";
    el.querySelector(".txt").textContent = r.noticed ? `copy by ${def.name}` : `${def.name} has not noticed you yet`;
    el.classList.toggle("danger", r.progress >= 75);
  }
  document.querySelectorAll("#priceseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.price === state.price)));
}

function setSpeed(v) {
  if (v > 0) lastSpeed = v;
  speed = v;
  document.querySelectorAll("#speedseg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed)));
}

function pushNews(item) {
  news.unshift({ day: state.day, ...item });
  news.length = Math.min(news.length, 40);
  const t = $("ticker");
  t.className = `gutter ${item.kind || ""}`;
  t.querySelector(".tag").textContent = item.kind === "bad" ? "Alert" : item.kind === "good" ? "News" : "World";
  const text = $("tickertext");
  text.textContent = item.text;
  text.classList.remove("fresh");
  void text.offsetWidth;
  text.classList.add("fresh");
  if (!$("newslog").hidden) renderNewsLog();
}

function renderNewsLog() {
  $("newslog").innerHTML = news.length
    ? news.slice(0, 14).map((n) => `<p class="${n.kind || ""}"><span>Day ${n.day}</span>${esc(n.text)}</p>`).join("")
    : "<p>No news yet.</p>";
}
$("ticker").onclick = () => {
  const log = $("newslog");
  log.hidden = !log.hidden;
  sfx(log.hidden ? "ui_close" : "ui_open");
  if (!log.hidden) renderNewsLog();
};

function showBanner(text, hint = "") {
  const b = $("banner");
  b.textContent = text;
  b.dataset.hint = hint;
  b.hidden = false;
}
function hideBanner() { $("banner").hidden = true; $("banner").dataset.hint = ""; }

// ---------- Sound button ----------
function renderMute() {
  const m = sound.muted;
  const b = $("mutebtn");
  b.setAttribute("aria-pressed", String(m));
  b.setAttribute("aria-label", m ? "Sound on" : "Sound off");
  b.innerHTML = `<span aria-hidden="true">${m ? "🔇" : "🔊"}</span>`;
}
$("mutebtn").onclick = () => { sound.toggleMute(); renderMute(); };

// ---------- Overlays ----------
const overlays = ["start", "upgrades", "alert", "end", "trophies"];
function modalOpen() { return overlays.some((id) => !$(id).hidden); }

function showAlert(title, text, tip = "") {
  $("alerttitle").textContent = title;
  $("alerttext").textContent = text;
  $("alerttip").textContent = tip;
  $("alerttip").hidden = !tip;
  $("alert").hidden = false;
  $("alertok").focus();
}
$("alertok").onclick = () => { sfx("ui_close"); $("alert").hidden = true; };

// ---------- Start ----------
// Unlocks between runs are in progress.js and progress-ui.js.
const unlocked = (sc) => isOpen("scenarios", sc.id);
const unlockText = (sc) => `${howToOpen("scenarios", sc.id)} to unlock.`;
const gameData = (product, scenario, hard) => applyHard(buildData(BASE, product, scenario), hard ? BASE.unlocks.hard : null);

function setBrandColor(c) {
  pick.color = c;
  const root = document.documentElement.style;
  root.setProperty("--brand", c);
  root.setProperty("--brand-glow", `${c}73`);
  document.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.c === c)));
  readColors();
}

function renderStart() {
  const p = BASE.products.find((x) => x.id === pick.product);
  $("products").innerHTML = BASE.products.map((x) => isOpen("products", x.id)
    ? `<button type="button" class="prod" data-p="${x.id}" aria-pressed="${x.id === pick.product}">${icon(x.id, "•")}<span>${esc(x.name)}</span></button>`
    : `<button type="button" class="prod locked" data-p="${x.id}" aria-disabled="true" aria-label="${esc(x.name)}, locked"><span class="lock" aria-hidden="true">🔒</span><span>${esc(x.name)}</span></button>`).join("");
  $("products").querySelectorAll(".prod").forEach((b) => (b.onclick = () => {
    if (b.classList.contains("locked")) {
      sfx("denied");
      $("productinfo").innerHTML = `<div class="lockinfo">🔒 ${esc(howToOpen("products", b.dataset.p))} to unlock ${esc(BASE.products.find((x) => x.id === b.dataset.p).name)}.</div>`;
      return;
    }
    sfx("ui_tap");
    const old = BASE.products.find((x) => x.id === pick.product);
    pick.product = b.dataset.p;
    const input = $("brandinput");
    if (!input.value.trim() || input.value === old.defaultBrand) input.value = BASE.products.find((x) => x.id === pick.product).defaultBrand;
    renderStart();
  }));
  $("productinfo").innerHTML = `<div>${esc(p.pitch)}</div>
    <div class="pros">${(p.strengths || []).map((t) => `<span>+ ${esc(t)}</span>`).join("")}</div>
    <div class="cons">${(p.weakSpots || []).map((t) => `<span>− ${esc(t)}</span>`).join("")}</div>`;
  $("scenarios").innerHTML = BASE.scenarios.map((sc) => {
    const open = unlocked(sc);
    return `<button type="button" class="scen" data-s="${sc.id}" aria-pressed="${sc.id === pick.scenario}" ${open ? "" : "disabled"}>
      <span class="em" aria-hidden="true">${open ? sc.icon : "🔒"}</span><b>${esc(sc.name)}</b>
      <span class="diff" aria-label="Difficulty ${sc.difficulty} of 3">${[1, 2, 3].map((k) => `<i class="${k <= sc.difficulty ? "on" : ""}"></i>`).join("")}</span>
      <small>${open ? esc(sc.pitch) : esc(unlockText(sc))}</small></button>`;
  }).join("");
  $("scenarios").querySelectorAll(".scen").forEach((b) => (b.onclick = () => { sfx("ui_tap"); pick.scenario = b.dataset.s; renderStart(); }));
  renderHard($("hardbox"), pick.hard, (v) => { sfx("ui_tap"); pick.hard = v; renderStart(); });
  const sc = BASE.scenarios.find((x) => x.id === pick.scenario);
  $("newbtn").textContent = sc.start ? `Start ${sc.name}` : "Choose where to launch";
}

function buildStart() {
  const sw = $("swatches");
  sw.innerHTML = brandColors().map((c) => c.open
    ? `<button type="button" class="swatch" data-c="${c.hex}" style="background:${c.hex};color:${c.hex}" aria-label="${esc(c.name)}"></button>`
    : `<button type="button" class="swatch locked" data-how="${esc(c.how)}" aria-label="${esc(c.name)}, locked. ${esc(c.how)}" title="${esc(c.how)}"><span aria-hidden="true">🔒</span></button>`).join("");
  sw.querySelectorAll(".swatch").forEach((b) => (b.onclick = () => {
    if (b.classList.contains("locked")) { sfx("denied"); $("colorhint").textContent = `🔒 ${b.dataset.how} to unlock this colour.`; return; }
    sfx("ui_tap"); $("colorhint").textContent = ""; setBrandColor(b.dataset.c);
  }));
  if (!brandColors().some((c) => c.open && c.hex === pick.color)) pick.color = COLORS[0];
  setBrandColor(pick.color);
  if (!BASE.scenarios.find((s) => s.id === pick.scenario && unlocked(s))) pick.scenario = "kitchen";
  if (!isOpen("products", pick.product)) pick.product = BASE.products[0].id;
  if (!isOpen("hard")) pick.hard = false;
  $("brandinput").value = BASE.products.find((x) => x.id === pick.product).defaultBrand;
  renderStart();
  const save = store.get(SAVE_KEY);
  const cont = $("continuebtn");
  if (save && save.status === "playing" && save.version === 2) {
    cont.hidden = false;
    cont.textContent = `Continue ${save.brand} (day ${save.day})`;
  } else cont.hidden = true;
  sound.music("music_menu");
}

$("newbtn").onclick = () => {
  sfx("ui_tap");
  const p = BASE.products.find((x) => x.id === pick.product);
  const name = $("brandinput").value.trim().slice(0, 14) || p.defaultBrand;
  $("brandinput").value = name;
  $("brandname").textContent = name;
  data = gameData(pick.product, pick.scenario, pick.hard);
  $("start").hidden = true;
  state = null;
  clearBubbles();
  if (data.scenario.start) { launch(data.regions.findIndex((g) => g.id === data.scenario.start)); return; }
  mode = "pick";
  showBanner(`Tap a region to launch ${name}`);
  selectRegion(-1);
};

$("continuebtn").onclick = () => {
  const save = store.get(SAVE_KEY);
  if (!save) return;
  sfx("ui_tap");
  data = gameData(save.product, save.scenario, save.hard);
  state = save;
  setBrandColor(state.color);
  $("brandname").textContent = state.brand;
  $("start").hidden = true;
  mode = "play";
  news.length = 0;
  buildRivalBars();
  pushNews({ kind: "good", text: `Welcome back. ${state.brand} is waiting for you.` });
  setSpeed(0);
  updateHud();
  centerOn(state.regions.findIndex((r) => r.reached));
  sound.music("music_game");
  dirty = true;
};

function launch(g) {
  const brand = $("brandname").textContent;
  state = newGame(data, { brand, color: pick.color, start: g, seed: Math.floor(Math.random() * 1e9) });
  state.hard = !!data.hard;
  mode = "play";
  firstBubbleHint = true;
  lastMilestone = 0;
  news.length = 0;
  selectRegion(-1);
  centerOn(g);
  hideBanner();
  buildRivalBars();
  pushNews({ kind: "good", text: `${brand} goes on sale in ${data.regions[g].name}. Day one!` });
  setSpeed(1);
  acc = 0;
  updateHud();
  save();
  sound.music("music_game");
  if (data.scenario.id !== "kitchen" && data.scenario.tip) showAlert(data.scenario.name, data.scenario.pitch, data.scenario.tip);
  dirty = true;
}

function save() { if (state && state.status === "playing") store.set(SAVE_KEY, state); }

// ---------- Upgrades ----------
function openUpgrades() {
  if (mode !== "play") return;
  sfx("ui_open");
  $("upgrades").hidden = false;
  renderUpgrades();
}
function closeUpgrades() { sfx("ui_close"); $("upgrades").hidden = true; updateHud(); }
$("upbtn").onclick = openUpgrades;
$("upclose").onclick = closeUpgrades;
$("upgrades").addEventListener("pointerdown", (e) => { if (e.target.id === "upgrades") closeUpgrades(); });

function renderUpgrades() {
  $("uphp").textContent = `${state.hp} Hype`;
  $("tabs").innerHTML = data.trees.map((t) => {
    const owned = data.upgrades.filter((u) => u.tree === t.id && state.owned[u.id]).length;
    return `<button type="button" role="tab" data-t="${t.id}" aria-selected="${t.id === tab}">${esc(t.name)} ${owned}/5</button>`;
  }).join("");
  $("tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { sfx("ui_tap"); tab = b.dataset.t; chosenUpgrade = null; renderUpgrades(); }));
  const tree = data.trees.find((t) => t.id === tab);
  $("blurb").textContent = tree.blurb;
  const list = data.upgrades.filter((u) => u.tree === tab);
  if (!chosenUpgrade || !list.find((u) => u.id === chosenUpgrade)) {
    chosenUpgrade = (list.find((u) => canBuy(state, data, u)) || list[0]).id;
  }
  const el = $("tree");
  el.innerHTML = `<svg aria-hidden="true"></svg>` + list.map((u) => {
    const owned = state.owned[u.id];
    const open = canBuy(state, data, u);
    const cls = owned ? "owned" : open ? (state.hp >= u.cost ? "afford" : "") : "locked";
    return `<button type="button" class="node ${cls}" data-u="${u.id}" aria-pressed="${u.id === chosenUpgrade}" style="grid-column:${u.pos[0] + 1};grid-row:${u.pos[1] + 1}">
      <span class="ic">${upgradeIcon(u)}</span><span class="nm">${esc(u.name)}</span><span class="cost">${u.cost}</span></button>`;
  }).join("");
  el.querySelectorAll(".node").forEach((b) => (b.onclick = () => { sfx("ui_tap"); chosenUpgrade = b.dataset.u; renderUpgrades(); }));
  requestAnimationFrame(() => drawTreeLines(list));
  renderDetail();
}

function drawTreeLines(list) {
  const el = $("tree"), svg = el.querySelector("svg");
  if (!svg) return;
  const box = el.getBoundingClientRect();
  const center = (id) => {
    const n = el.querySelector(`[data-u="${id}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
  };
  let out = "";
  for (const u of list) {
    const to = center(u.id);
    for (const [ids, any] of [[u.requires, false], [u.requiresAny || [], true]]) {
      for (const id of ids) {
        const from = center(id);
        if (!from || !to) continue;
        const on = state.owned[id] && state.owned[u.id];
        out += `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" class="${on ? "on" : ""} ${any ? "any" : ""}"/>`;
      }
    }
  }
  svg.innerHTML = out;
}

function renderDetail() {
  const u = data.upgrades.find((x) => x.id === chosenUpgrade);
  const owned = state.owned[u.id];
  const open = canBuy(state, data, u);
  const name = (id) => data.upgrades.find((x) => x.id === id).name;
  let why = "";
  if (!owned && !open) {
    const miss = u.requires.filter((id) => !state.owned[id]).map(name);
    if (miss.length) why = `Buy ${miss.join(" and ")} first.`;
    else if (u.requiresAny) why = `Buy ${u.requiresAny.map(name).join(" or ")} first.`;
  } else if (!owned && state.hp < u.cost) why = `You need ${u.cost - state.hp} more Hype. Tap the yellow bubbles on the map.`;
  const upkeep = u.upkeep ? `<span class="down">Costs ${fmtCash(u.upkeep)} per day</span>` : `<span>No daily cost</span>`;
  $("detail").innerHTML = `
    <h3>${upgradeIcon(u)}${esc(u.name)}</h3>
    <p>${esc(u.desc)}</p>
    <div class="facts"><span>${u.cost} Hype</span>${upkeep}</div>
    ${why ? `<div class="why">${esc(why)}</div>` : ""}
    <button class="btn${!owned && (!open || state.hp < u.cost) ? " dim" : ""}" type="button" id="buybtn" ${owned ? "disabled" : ""}>${owned ? "Owned" : `Buy for ${u.cost} Hype`}</button>`;
  $("buybtn").onclick = () => {
    if (!buy(state, data, u.id)) { sfx("denied"); return; }
    sfx("upgrade_buy");
    pushNews({ kind: "good", text: `${state.brand} gets ${u.name}!` });
    if (u.effects.setback) {
      const def = rivalDef(data, topRival(state).id);
      pushNews({ kind: "good", text: `The lawyers win. ${copyName(def, state.brand)} loses ${u.effects.setback}% progress.` });
    }
    save();
    renderUpgrades();
    updateHud();
    dirty = true;
  };
}

// ---------- Controls ----------
document.querySelectorAll("#speedseg button").forEach((b) => (b.onclick = () => { sfx("tick"); setSpeed(Number(b.dataset.speed)); }));
document.querySelectorAll("#priceseg button").forEach((b) => (b.onclick = () => {
  if (!state) return;
  sfx("tick");
  state.price = b.dataset.price;
  const p = data.balance.prices[state.price];
  pushNews({ kind: "fun", text: `Price set to ${p.label}. Growth x${p.growth}, money per fan x${p.revenue}.` });
  updateHud();
  save();
}));

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") { if (e.key === "Enter") $("newbtn").click(); return; }
  if (e.key === "Escape") {
    if (!$("upgrades").hidden) closeUpgrades();
    else if (!$("trophies").hidden) closeTrophies();
    else if (!$("alert").hidden) $("alert").hidden = true;
    else selectRegion(-1);
  }
  if (mode !== "play") return;
  if (e.key === " ") { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed); }
  if (e.key >= "1" && e.key <= "3") setSpeed(Number(e.key));
  if (e.key === "u" || e.key === "U") { if ($("upgrades").hidden) openUpgrades(); else closeUpgrades(); }
});

// ---------- End ----------
function showEnd() {
  mode = "over";
  clearBubbles();
  store.del(SAVE_KEY);
  const won = state.status === "won";
  sound.music(null, { fade: 0.4 });
  sfx(won ? "win" : "lose");
  const ws = worldShare(state, data);
  $("endcard").className = `card end ${state.status}`;
  $("endtitle").textContent = (won ? "You win!" : "Game over") + (state.hard ? " (Hard)" : "");
  $("endtext").textContent = state.reason;
  const bought = Object.keys(state.owned).length;
  $("endstats").innerHTML = [
    ["Days", state.day],
    ["World share", pct(ws.share)],
    ["Fans", fmtPeople(ws.fans)],
    ["Cash", fmtCash(state.cash)],
    ["Upgrades", `${bought}/${data.upgrades.length}`],
    ["Spies caught", state.stats.spies],
  ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("");
  let lesson;
  if (won) lesson = "You grew fast and kept your fans. Try another product or a harder challenge next.";
  else if (state.cash < 0) lesson = "Cash flow matters. Upgrades with a daily cost only pay off once enough fans buy. Start with cheap upgrades and grow first.";
  else {
    const def = rivalDef(data, state.lostTo || topRival(state).id);
    lesson = def.tips?.[1] || def.tips?.[0] || "Big companies copy good ideas. Defense upgrades and catching spies buy you time.";
  }
  $("lesson").textContent = lesson;
  const rec = $("record");
  const run = finishRun(state, data);
  rec.innerHTML = run.html;
  rec.hidden = !run.html;
  if (run.earned.length || run.unlocked.length) setTimeout(() => sfx("milestone"), 900);
  $("end").hidden = false;
}
$("trophybtn").onclick = () => { sfx("ui_open"); openTrophies(sfx); };
$("trophyclose").onclick = () => { sfx("ui_close"); closeTrophies(); };
$("trophies").addEventListener("pointerdown", (e) => { if (e.target.id === "trophies") closeTrophies(); });

$("againbtn").onclick = () => {
  sfx("ui_tap");
  $("end").hidden = true;
  $("alert").hidden = true;
  state = null;
  mode = "title";
  selected = -1;
  dirty = true;
  renderRegionCard();
  $("rivalbox").innerHTML = "";
  buildStart();
  $("start").hidden = false;
};

// ---------- Loop ----------
function tick() {
  for (const it of step(state, data)) {
    if (it.type === "news") {
      pushNews(it);
      if (it.cash > 0) sfx("cash_in");
      else if (it.kind === "bad") sfx("news_bad");
      else if (it.kind === "good" && !it.text.includes("arrives in")) sfx("news_good");
    } else if (it.type === "reached") sfx("country_reached");
    else if (it.type === "bubble") spawnBubble(it.region, it.value, "hype");
    else if (it.type === "spy") spawnBubble(it.region, 0, "spy", it.rival);
    else if (it.type === "alert") {
      const noticed = it.title.includes("noticed");
      sfx(noticed ? "rival_alert" : "warning");
      const def = rivalDef(data, it.rival);
      showAlert(it.title, it.text, noticed ? def.tips?.[0] || "" : "");
    } else if (it.type === "end") { updateHud(); dirty = true; setTimeout(showEnd, 600); }
  }
  const share = worldShare(state, data).share;
  for (const m of [0.1, 0.25, 0.4]) {
    if (share >= m && lastMilestone < m) { lastMilestone = m; sfx("milestone"); pushNews({ kind: "good", text: `${state.brand} reaches ${m * 100}% of the world market!` }); }
  }
  if (firstBubbleHint && bubbles.some((b) => b.type === "hype") && state.day > 2) showBanner("Tap the yellow bubbles to get Hype!", "bubble");
  if (state.day % 5 === 0) save();
  if (selected >= 0) renderRegionCard();
  updateHud();
  dirty = true;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  const running = mode === "play" && state && state.status === "playing" && speed > 0 && !modalOpen();
  if (running) {
    acc += dt;
    const len = data.balance.dayMs[speed];
    let n = 0;
    while (acc >= len && n < 4 && state.status === "playing") { acc -= len; tick(); n++; }
    const auto = mods(state, data).autoCollect > 0;
    for (const b of [...bubbles]) {
      b.age += dt;
      if (auto && b.type === "hype" && b.age > data.balance.autoCollectMs) pop(b, true);
      else if (b.age > b.life) { b.done = true; b.el.classList.add("gone"); setTimeout(() => b.el.remove(), 300); bubbles = bubbles.filter((x) => x !== b); }
      else b.el.classList.toggle("fading", b.age > b.life * 0.75);
    }
  }
  if (dirty) draw();
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(stage);

// For tests and debugging in the console.
window.hype = {
  get state() { return state; }, get data() { return data; }, BASE,
  // Screen point (relative to the page) of a dot near the middle of region g.
  point(g) {
    centerOn(g);
    const [cx, cy] = centroid[g];
    const i = regionDots[g].reduce((b, k) => ((dx[k] - cx) ** 2 + (dy[k] - cy) ** 2 < (dx[b] - cx) ** 2 + (dy[b] - cy) ** 2 ? k : b));
    const [x, y] = toScreen(i);
    const r = stage.getBoundingClientRect();
    return [r.left + x, r.top + y];
  },
};

readColors();
renderMute();
buildStart();
setSpeed(1);
resize();
requestAnimationFrame(frame);
