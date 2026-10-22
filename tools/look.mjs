// Plays the built game on phone, tablet and laptop sizes and saves a screenshot of each screen.
// It also lists buttons that are too small to tap and text that does not fit.
// Run: node tools/look.mjs <url> <outdir> [size names...]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [url, out, ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const touch = { isMobile: true, hasTouch: true };
const SIZES = [
  ["iphone-se", { ...devices["iPhone SE"] }],
  ["iphone", { ...devices["iPhone 13"] }],
  ["iphone-land", { ...devices["iPhone 13 landscape"] }],
  ["ipad", { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, ...touch }],
  ["ipad-land", { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, ...touch }],
  ["mac", { viewport: { width: 1440, height: 900 } }],
  ["mac-small", { viewport: { width: 1280, height: 720 } }],
].filter(([n]) => !only.length || only.includes(n));

// Finds buttons under 40 px and text that is cut off or runs out of its box.
const audit = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[hidden]"); };
  const small = [], cut = [];
  const top = [...document.querySelectorAll(".overlay:not([hidden])")].pop() || document;
  for (const el of top.querySelectorAll("button, input, summary, [role=tab]")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) small.push(`${el.id || el.className || el.tagName}:${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of top.querySelectorAll("b, span, small, h2, h3, p, button")) {
    if (!vis(el) || el.children.length > 2) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") cut.push(`${el.id || el.className || el.tagName}:${el.textContent.trim().slice(0, 24)}`);
  }
  const wide = document.documentElement.scrollWidth > innerWidth + 1;
  return { small: [...new Set(small)].slice(0, 14), cut: [...new Set(cut)].slice(0, 10), wide };
};

const browser = await chromium.launch();
for (const [name, opts] of SIZES) {
  const errors = [];
  const report = [];
  const shot = async (page, step) => {
    await page.screenshot({ path: `${out}/${name}-${step}.png` });
    const a = await page.evaluate(audit);
    if (a.small.length || a.cut.length || a.wide) report.push(`  ${step}: ${a.wide ? "PAGE TOO WIDE " : ""}${a.small.length ? "small: " + a.small.join(", ") : ""}${a.cut.length ? " | cut: " + a.cut.join(", ") : ""}`);
  };

  // First visit: the tutorial is on.
  let ctx = await browser.newContext(opts);
  let page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(800);
  await shot(page, "00-first-visit");
  await ctx.close();

  // Later visits: tutorial done, all tips seen.
  ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => {
    localStorage.setItem("hypeinc.tutorial.v1", "true");
    localStorage.setItem("hypeinc.tips.v1", JSON.stringify(["start", "newslog", "region-later", "tree-channels", "tree-defense", "locked", "cash-low", "end-screen"]));
  });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(600);
  await shot(page, "01-start");
  await page.evaluate(() => { const o = document.getElementById("start"); o.scrollTop = o.scrollHeight; });
  await page.waitForTimeout(200);
  await shot(page, "02-start-bottom");
  await page.click("#newbtn");
  await page.waitForTimeout(300);
  await shot(page, "03-pick");
  const [px, py] = await page.evaluate(() => hype.point(2));
  await page.mouse.click(px, py);
  await page.waitForTimeout(300);
  await shot(page, "04-region");
  await page.click("#launchbtn");
  await page.waitForTimeout(400);
  if (await page.locator("#alert:not([hidden])").count()) await page.click("#alertok");
  await shot(page, "05-day1");
  await page.click('#speedseg [data-speed="3"]');
  let alertShot = false;
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(200);
    if (await page.locator("#alert:not([hidden])").count()) {
      if (!alertShot) { alertShot = true; await page.waitForTimeout(350); await shot(page, "06-alert"); }
      await page.click("#alertok");
    }
    const b = page.locator(".bubble:not(.gone)");
    if (await b.count()) await b.first().click({ force: true, timeout: 500 }).catch(() => {});
  }
  await page.click('#speedseg [data-speed="0"]');
  await page.evaluate(() => { hype.state.hp += 40; });
  await page.waitForTimeout(100);
  await shot(page, "07-play");
  await page.click("#ticker");
  await page.waitForTimeout(300);
  await shot(page, "08-news");
  await page.click("#ticker");
  const [qx, qy] = await page.evaluate(() => hype.point(hype.state.regions.findIndex((r) => r.reached)));
  await page.mouse.click(qx, qy);
  await page.waitForTimeout(300);
  await shot(page, "09-region-play");
  await page.click("#upbtn");
  await page.waitForTimeout(400);
  await shot(page, "10-upgrades");
  await page.click('#tabs [data-t="defense"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => { const o = document.getElementById("upgrades"); o.scrollTop = o.scrollHeight; });
  await shot(page, "11-upgrades-defense");
  await page.click("#upclose");
  // Win the game to see the end screen.
  await page.evaluate(() => hype.state.regions.forEach((r) => { r.reached = true; r.f = 0.7; }));
  await page.click('#speedseg [data-speed="1"]');
  await page.waitForTimeout(2500);
  await shot(page, "12-end");
  await page.evaluate(() => { const o = document.getElementById("end"); o.scrollTop = o.scrollHeight; });
  await shot(page, "13-end-bottom");
  await page.click("#againbtn");
  await page.click("#trophybtn");
  await page.waitForTimeout(400);
  await shot(page, "14-trophies");
  console.log(name, errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
  if (report.length) console.log(report.join("\n"));
  await ctx.close();
}
await browser.close();
