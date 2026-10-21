// Tutorial: a guided first game, plus a short tip the first time each screen is used.
// It only reads the page and window.hype. main.js asks tutorialHold() to pause the clock.
import css from "./tutorial.css";

const DONE_KEY = "hypeinc.tutorial.v1";
const TIPS_KEY = "hypeinc.tips.v1";

const $ = (s) => document.querySelector(s);
const shown = (s) => { const el = $(s); return !!el && !el.hidden && el.getClientRects().length > 0; };
const game = () => window.hype?.state || null;
const data = () => window.hype?.data || null;
const brand = () => game()?.brand || "your product";
// The first rival in this game (the one in the copy bar at the top).
const rivalName = () => {
  const r = game()?.rivals?.[0];
  return data()?.rivals?.find((d) => d.id === r?.id)?.name || "A big company";
};
const anyNoticed = () => (game()?.rivals || []).some((r) => r.noticed);
// Some steps end when a number goes up after the card shows.
let mark = 0;
const hpEarned = () => game()?.stats?.hpEarned || 0;
const spies = () => game()?.stats?.spies || 0;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no storage */ } },
};

// ---------- Guided first game ----------
// Each step waits until "when" is true, then shows its card on "target".
// hold: the game clock stops while the card shows.
// next: the card has a button. Without it, the step ends when "done" is true.
const firstBubble = () => document.querySelector("#bubbles .bubble:not(.spy):not(.gone)");
const firstSpy = () => document.querySelector("#bubbles .bubble.spy:not(.gone)");
const playing = () => { const s = game(); return !!s && s.status === "playing" && !shown("#start"); };

const STEPS = [
  {
    id: "pick",
    when: () => !shown("#start") && !game() && shown("#stage"),
    target: () => $("#stage"),
    title: "Pick a place to start",
    text: "Tap any region on the map. Each region is different, so look around.",
    done: () => shown("#launchbtn"),
    skipIf: () => playing(),
  },
  {
    id: "region",
    when: () => shown("#launchbtn"),
    target: () => $("#regioncard"),
    title: "Read the region card",
    text: "Rich regions pay more per fan. Shops and people online help you spread. Red bars mean people there are hard to win. Tap Launch when you like it.",
    done: () => playing(),
    skipIf: () => playing(),
  },
  {
    id: "goal",
    when: playing,
    hold: true,
    target: () => $("#hud .share"),
    title: "Your goal",
    text: () => `Your colour fills this bar when people buy ${brand()}. Get to the goal line to win.`,
    next: "Next",
  },
  {
    id: "cash",
    when: playing,
    hold: true,
    target: () => $("#hud .stats"),
    title: "Cash and Hype",
    text: "Fans pay you every day, and the small number shows how much. Some upgrades cost money each day. At $0 you lose. Hype is what you spend on upgrades.",
    next: "Next",
  },
  {
    id: "bubble",
    when: () => playing() && !!firstBubble(),
    hold: true,
    target: firstBubble,
    title: "A Hype bubble!",
    text: () => `People talk about ${brand()}. Tap the yellow bubble to get Hype. Bubbles fade, so be quick.`,
    start: () => { mark = hpEarned(); },
    done: () => hpEarned() > mark || !firstBubble(),
  },
  {
    id: "save-up",
    when: playing,
    target: () => $("#upbtn"),
    title: "Save up Hype",
    text: "Keep tapping bubbles. When the Upgrades button shakes, you can buy something.",
    done: () => !!$("#upbtn.ready") || shown("#upgrades"),
    small: true,
  },
  {
    id: "open-upgrades",
    when: () => playing() && !!$("#upbtn.ready"),
    hold: true,
    target: () => $("#upbtn"),
    title: "Time to upgrade",
    text: "You have enough Hype. Tap Upgrades.",
    done: () => shown("#upgrades"),
  },
  {
    id: "trees",
    when: () => shown("#upgrades"),
    target: () => $("#tabs"),
    title: "Three upgrade trees",
    text: "Product makes people love it more. Channels get it to more people. Defense protects you from rivals. Bright buttons you can buy now. Dark ones are locked.",
    next: "Next",
  },
  {
    id: "buy",
    when: () => shown("#upgrades"),
    target: () => $("#detail"),
    title: "Buy your first upgrade",
    text: () => {
      const free = (data()?.upgrades || []).filter((u) => !u.upkeep && !(u.requires || []).length && !u.requiresAny).sort((a, b) => a.cost - b.cost)[0];
      return `Pick one and tap Buy. Tip: start with an upgrade that has no daily cost${free ? `, like ${free.name}` : ""}.`;
    },
    done: () => Object.keys(game()?.owned || {}).length > 0,
  },
  {
    id: "close-upgrades",
    when: () => shown("#upgrades"),
    target: () => $("#upclose"),
    title: "Nice!",
    text: "Close this panel and watch your colour spread.",
    done: () => !shown("#upgrades"),
    skipIf: () => !shown("#upgrades"),
  },
  {
    id: "price",
    when: () => playing() && !shown("#upgrades"),
    hold: true,
    target: () => $("#priceseg"),
    title: "Set your price",
    text: "$ is cheap: more fans, but less money per fan. $$$ is premium: fewer fans, but each one pays more. Watch your money per day when you change it.",
    next: "Next",
  },
  {
    id: "speed",
    when: playing,
    hold: true,
    target: () => $("#speedseg"),
    title: "Control time",
    text: "Pause when you need to think. Go faster when things go well.",
    next: "Next",
  },
  {
    id: "rival-intro",
    when: playing,
    hold: true,
    target: () => $("#rivalbox"),
    title: () => `${rivalName()} is watching`,
    text: () => `Big companies copy good ideas. Soon ${rivalName()} starts to build a copy of ${brand()}. If a copy bar gets to 100%, you lose.`,
    next: "Got it",
  },
  {
    id: "rival-noticed",
    when: () => playing() && anyNoticed() && !shown("#alert"),
    hold: true,
    target: () => $("#rivalbox"),
    title: "The race is on",
    text: "Their copy is in progress now. Upgrades in the Defense tree slow them down. Keep growing, so you win first.",
    next: "Next",
  },
  {
    id: "spy",
    when: () => playing() && !!firstSpy(),
    hold: true,
    target: firstSpy,
    title: "A spy!",
    text: "Rivals send spies to learn your secrets. Tap the spy to set their copy back.",
    start: () => { mark = spies(); },
    done: () => spies() > mark || !firstSpy(),
  },
  {
    id: "end",
    when: playing,
    hold: true,
    target: () => null,
    title: "You know the basics",
    text: "Grow, upgrade, and stay ahead of the copycats. Good luck, CEO!",
    next: "Let's go",
  },
];

let stepIndex = -1;
let active = null; // the step on screen
let tutorialOn = !store.get(DONE_KEY);

/** True while the tutorial wants the game clock stopped. */
export function tutorialHold() {
  return !!(active && active.hold);
}

function finishTutorial() {
  tutorialOn = false;
  active = null;
  store.set(DONE_KEY, true);
  hideCoach();
}

function advance() {
  active = null;
  hideCoach();
  stepIndex++;
  if (stepIndex >= STEPS.length) finishTutorial();
}

function runSteps() {
  if (!tutorialOn) return;
  if (stepIndex < 0) stepIndex = 0;
  // A new game from the title screen restarts the guide at the region pick.
  if (shown("#start")) { if (active && !active.tip) { active = null; hideCoach(); } if (stepIndex > 1) stepIndex = 0; return; }
  const step = STEPS[stepIndex];
  if (!step || active?.tip) return;
  // Alerts and the end screen come first. The guide waits.
  if (shown("#alert") || shown("#end")) { if (active && !active.tip) { active = null; hideCoach(); } return; }
  if (!active) {
    if (step.skipIf && step.skipIf()) { advance(); return; }
    if (!step.when()) return;
    active = step;
    if (step.start) step.start();
    showCoach(step);
  }
  if (active.done && active.done()) advance();
}

// ---------- First-visit tips ----------
// A tip shows once per player, when its screen first shows.
const seen = new Set(store.get(TIPS_KEY) || []);
const TIPS = [
  {
    id: "start",
    when: () => shown("#start") && !!$("#products"),
    target: () => $("#products"),
    title: "Welcome, CEO!",
    text: "Pick what you sell. Each product has strengths and weak spots. Then name it, pick a colour and tap Start.",
  },
  {
    id: "newslog",
    when: () => shown("#newslog"),
    target: () => $("#newslog"),
    title: "News",
    text: "This is what happens in the world. Some news helps you, some hurts. Alerts are red.",
  },
  {
    id: "region-later",
    when: () => playing() && shown("#regioncard"),
    target: () => $("#regioncard"),
    title: "Region details",
    text: "You see your share and the rivals' share here. Tap the sea to close it.",
  },
  {
    id: "tree-channels",
    when: () => shown("#upgrades") && !!$('#tabs [data-t="channels"][aria-selected="true"]'),
    target: () => $("#tree"),
    title: "Channels",
    text: "Channels spread your drink to new regions faster. Many of them cost money each day, so check your cash first.",
  },
  {
    id: "tree-defense",
    when: () => shown("#upgrades") && !!$('#tabs [data-t="defense"][aria-selected="true"]'),
    target: () => $("#tree"),
    title: "Defense",
    text: "These upgrades keep your fans loyal and slow down the rivals. Buy them before a copy bar gets high.",
  },
  {
    id: "locked",
    when: () => shown("#upgrades") && !!$("#detail .why"),
    target: () => $("#detail .why"),
    title: "Not yet",
    text: "The red line tells you what you need first. Lines in the tree show which upgrade opens which.",
  },
  {
    id: "cash-low",
    when: () => playing() && !!$("#cashstat.low"),
    target: () => $("#cashstat"),
    title: "Cash is running low",
    text: "You spend more each day than you earn. Try a higher price, or wait to buy upgrades with a daily cost until you have more fans.",
    hold: true,
  },
  {
    id: "end-screen",
    when: () => shown("#end"),
    target: () => $("#lesson"),
    title: "What did you learn?",
    text: "This box tells you what went well or what to try next time. Each run you get better.",
  },
];

function runTips() {
  if (active) return;
  for (const tip of TIPS) {
    if (seen.has(tip.id) || !tip.when()) continue;
    // During the guided game, skip tips the guide already covers.
    if (tutorialOn && tip.id === "region-later") continue;
    seen.add(tip.id);
    store.set(TIPS_KEY, [...seen]);
    active = { ...tip, tip: true, next: "Got it" };
    showCoach(active);
    return;
  }
}

// ---------- Coach card ----------
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

const ring = document.createElement("div");
ring.className = "coach-ring";
ring.hidden = true;
const card = document.createElement("div");
card.className = "coach-card";
card.setAttribute("role", "dialog");
card.setAttribute("aria-live", "polite");
card.hidden = true;
document.body.append(ring, card);

const val = (v) => (typeof v === "function" ? v() : v);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function showCoach(step) {
  card.className = `coach-card${step.small ? " small" : ""}${step.tip ? " tip" : ""}`;
  card.innerHTML = `
    <div class="coach-top">${step.tip ? "Tip" : "Tutorial"}</div>
    <h3>${esc(val(step.title))}</h3>
    <p>${esc(val(step.text))}</p>
    <div class="coach-row">
      ${step.tip ? "" : `<button type="button" class="coach-skip">Skip tutorial</button>`}
      ${step.next ? `<button type="button" class="coach-next">${esc(step.next)}</button>` : ""}
    </div>`;
  const nx = card.querySelector(".coach-next");
  if (nx) nx.onclick = () => { if (step.tip) { active = null; hideCoach(); } else advance(); };
  const sk = card.querySelector(".coach-skip");
  if (sk) sk.onclick = finishTutorial;
  card.hidden = false;
  ring.classList.toggle("dim", !!step.hold);
  place();
}

function hideCoach() {
  card.hidden = true;
  ring.hidden = true;
}

// Put the ring around the target and the card next to it.
function place() {
  if (!active) return;
  const el = active.target && active.target();
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = Math.min(320, vw - 32);
  card.style.width = `${cw}px`;
  const ch = card.offsetHeight;
  let x, y;
  if (el && el.getClientRects().length) {
    const r = el.getBoundingClientRect();
    // A big target (the map) gets no ring. The card goes at its bottom, so the top stays free to tap.
    const big = r.height > vh * 0.5;
    ring.hidden = big;
    const pad = 6;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    x = Math.max(16, Math.min(vw - cw - 16, r.left + r.width / 2 - cw / 2));
    if (big) y = r.bottom - ch - 16;
    else if (r.bottom + pad + 12 + ch < vh - 8) y = r.bottom + pad + 12;
    else y = Math.max(8, r.top - pad - 12 - ch);
  } else {
    ring.hidden = !active.hold;
    if (active.hold) Object.assign(ring.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: "0px", height: "0px" });
    x = (vw - cw) / 2;
    y = (vh - ch) / 2;
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}

// ---------- Replay button on the title screen ----------
function addReplay() {
  const row = $("#start .row");
  if (!row || $("#replaytut")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.id = "replaytut";
  b.className = "coach-replay";
  b.textContent = "Play the tutorial again";
  b.onclick = () => {
    tutorialOn = true;
    stepIndex = 0;
    seen.clear();
    store.set(TIPS_KEY, []);
    store.set(DONE_KEY, false);
    $("#newbtn").click();
  };
  row.after(b);
}

function loop() {
  runSteps();
  runTips();
  if (!$("#replaytut")) addReplay();
  const r = $("#replaytut");
  if (r) r.hidden = tutorialOn;
}

setInterval(loop, 150);
window.addEventListener("resize", place);
(function follow() { if (active && !card.hidden) place(); requestAnimationFrame(follow); })();
