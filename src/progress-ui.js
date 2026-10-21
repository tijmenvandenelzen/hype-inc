// Screen code for progress between runs: locks on the start screen, the
// Trophies sheet, the end screen summary and the save code.
import { BASE } from "./data.js";
import {
  PROGRESS_KEY, newProgress, cleanProgress, unlockState, recordRun, runSummary,
  exportProgress, importProgress,
} from "./progress.js";

const OLD_BEST_KEY = "hypeinc.best.v1";
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

// v0.2 kept only {wins, won, fastest}. Keep those wins, so no challenge locks again.
function migrate() {
  const old = read(OLD_BEST_KEY);
  const p = newProgress();
  if (!old || !old.wins) return p;
  p.runs = p.wins = old.wins;
  for (const id of old.won || []) p.scenarioWins[id] = 1;
  // v0.2 had no product pick before this, so count the wins as soda wins.
  p.productWins.soda = old.wins;
  if (old.fastest) p.best.soda = old.fastest;
  return p;
}

let progress = (() => {
  const saved = read(PROGRESS_KEY);
  return saved ? cleanProgress(saved) : migrate();
})();
let locks = unlockState(progress, BASE);
let onChange = () => {};

function set(p) {
  progress = p;
  locks = unlockState(progress, BASE);
  write(PROGRESS_KEY, progress);
  onChange();
}

// ---------- Start screen ----------
const find = (kind, id) => locks[kind].find((x) => x.id === id);
export const isOpen = (kind, id) => (kind === "hard" ? locks.hard.open : !!find(kind, id)?.open);
export const howToOpen = (kind, id) => (kind === "hard" ? locks.hard.how : find(kind, id)?.how || "");
export const brandColors = () => locks.colors;
export const getProgress = () => progress;
export function onProgressChange(fn) { onChange = fn; }

// The Hard switch on the start screen. Returns a function that reads it.
export function renderHard(el, value, onToggle) {
  const h = BASE.unlocks.hard;
  const open = locks.hard.open;
  el.innerHTML = `<button type="button" class="hardbtn" role="switch" aria-checked="${open && value}" ${open ? "" : "disabled"}>
      <span class="em" aria-hidden="true">${open ? "🔥" : "🔒"}</span>
      <b>${esc(h.label)} mode</b>
      <span class="knob" aria-hidden="true"></span>
      <small>${esc(open ? h.desc : `${locks.hard.how} to unlock.`)}</small>
    </button>`;
  el.querySelector("button").onclick = () => onToggle(!value);
}

// ---------- End screen ----------
// Add the finished run to the save. Returns HTML for the end screen.
export function finishRun(state, data) {
  const run = runSummary(state, data, { scenario: state.scenario, hard: !!state.hard });
  const oldBest = progress.best[run.product];
  const r = recordRun(progress, BASE, run);
  set(r.progress);
  const parts = [];
  if (run.status === "won") {
    if (!oldBest) parts.push(`<p class="rec">First win with ${esc(data.product.name)}!</p>`);
    else if (run.day < oldBest) parts.push(`<p class="rec">New record! Your old best with ${esc(data.product.name)} was ${oldBest} days.</p>`);
  }
  for (const a of r.earned) {
    parts.push(`<div class="got ach"><span class="em" aria-hidden="true">${a.icon}</span><span><small>Achievement</small><b>${esc(a.name)}</b> ${esc(a.desc)}</span></div>`);
  }
  for (const u of r.unlocked) {
    const label = { products: "New product", scenarios: "New challenge", colors: "New colour", hard: "New mode" }[u.kind];
    const sw = u.kind === "colors" ? `<span class="dotc" style="background:${BASE.unlocks.colors.find((c) => c.id === u.id).hex}"></span>` : `<span class="em" aria-hidden="true">🔓</span>`;
    parts.push(`<div class="got unl">${sw}<span><small>${label}</small><b>${esc(u.name)}</b></span></div>`);
  }
  if (!r.unlocked.length) {
    const next = nextGoal();
    if (next) parts.push(`<p class="next">Next unlock: <b>${esc(next.name)}</b>. ${esc(next.how)}.</p>`);
  }
  return { html: parts.join(""), earned: r.earned, unlocked: r.unlocked };
}

// The first locked thing, so the player always has a next goal.
function nextGoal() {
  const named = (list, kind) => list.filter((x) => !x.open).map((x) => ({ ...x, name: nameOf(kind, x.id) }));
  const all = [...named(locks.products, "products"), ...(locks.hard.open ? [] : [{ ...locks.hard, name: "Hard mode" }]),
    ...named(locks.scenarios, "scenarios"), ...named(locks.colors, "colors")];
  return all[0] || null;
}
function nameOf(kind, id) {
  if (kind === "colors") return `${BASE.unlocks.colors.find((c) => c.id === id).name} colour`;
  return (kind === "products" ? BASE.products : BASE.scenarios).find((x) => x.id === id).name;
}

// ---------- Trophies sheet ----------
export function openTrophies(sfx = () => {}) {
  const p = progress;
  const got = BASE.achievements.filter((a) => p.achievements[a.id]).length;
  const best = BASE.products.filter((x) => p.best[x.id]).map((x) => `${esc(x.name)} ${p.best[x.id]} day${p.best[x.id] === 1 ? "" : "s"}`).join(" · ");
  $("trophybody").innerHTML = `
    <div class="endstats">
      <div><small>Runs</small><b>${p.runs}</b></div>
      <div><small>Wins</small><b>${p.wins}</b></div>
      <div><small>Trophies</small><b>${got}/${BASE.achievements.length}</b></div>
    </div>
    ${best ? `<p class="bests">Fastest wins: ${best}</p>` : ""}
    <ul class="achs">${BASE.achievements.map((a) => {
      const on = !!p.achievements[a.id];
      return `<li class="${on ? "on" : ""}"${on ? ` title="Earned ${esc(p.achievements[a.id])}"` : ""}><span class="em" aria-hidden="true">${on ? a.icon : "🔒"}</span><span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></li>`;
    }).join("")}</ul>
    <details class="savecode">
      <summary>Save code</summary>
      <p>Copy this code to keep your progress, or to move it to another device. Paste a code below to load it.</p>
      <textarea id="savecodetext" rows="3" spellcheck="false" autocomplete="off"></textarea>
      <div class="row">
        <button class="btn ghost" id="savecopy" type="button">Copy my code</button>
        <button class="btn ghost" id="saveload" type="button">Load code</button>
      </div>
      <p class="msg" id="savemsg" aria-live="polite"></p>
    </details>`;
  const box = $("savecodetext"), msg = $("savemsg");
  box.value = exportProgress(p);
  $("savecopy").onclick = async () => {
    sfx("ui_tap");
    box.value = exportProgress(progress);
    box.select();
    try { await navigator.clipboard.writeText(box.value); msg.textContent = "Copied."; }
    catch { msg.textContent = "Select the code and copy it."; }
  };
  $("saveload").onclick = () => {
    const p2 = importProgress(box.value);
    if (!p2) { sfx("denied"); msg.textContent = "That code does not work. Check that you copied all of it."; return; }
    sfx("upgrade_buy");
    set(p2);
    openTrophies(sfx);
    $("trophybody").querySelector(".savecode").open = true;
    $("savemsg").textContent = `Loaded: ${p2.wins} wins, ${Object.keys(p2.achievements).length} trophies.`;
  };
  $("trophies").hidden = false;
  $("trophyclose").focus();
}
export function closeTrophies() { $("trophies").hidden = true; }
