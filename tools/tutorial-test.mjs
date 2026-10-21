// Plays through the tutorial and saves a screenshot per step. Run: node tools/tutorial-test.mjs <url> <outdir>
import { chromium, devices } from "playwright";
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, opts] of [["iphone", devices["iPhone 13"]], ["mac", { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(500);
  if (await page.locator(".coach-card:not([hidden]) .coach-next").count()) { await page.screenshot({ path: `${out}/${name}-00-start.png` }); await page.click(".coach-card:not([hidden]) .coach-next"); }
  await page.click("#newbtn");
  const seen = [];
  let shot = 0;
  for (let t = 0; t < 900; t++) {
    await page.waitForTimeout(200);
    const c = await page.evaluate(() => { const c = document.querySelector(".coach-card"); return c && !c.hidden ? c.querySelector("h3").textContent : null; });
    if (c && !seen.includes(c)) { seen.push(c); await page.screenshot({ path: `${out}/${name}-${String(++shot).padStart(2, "0")}.png` }); }
    if (c === "You know the basics") break;
    if (c === "Pick a place to start") { const [x, y] = await page.evaluate(() => hype.point(0)); await page.mouse.click(x, y); continue; }
    if (await page.locator("#launchbtn:visible").count()) { await page.waitForTimeout(300); await page.click("#launchbtn"); continue; }
    if (await page.locator(".coach-card:not([hidden]) .coach-next").count()) { await page.waitForTimeout(150); await page.click(".coach-card:not([hidden]) .coach-next"); continue; }
    if (await page.locator("#alert:not([hidden])").count()) { await page.click("#alertok"); continue; }
    if (c === "Buy your first upgrade") { await page.click("#tree .node.afford"); await page.click("#buybtn"); continue; }
    if (c === "Nice!") { await page.click("#upclose"); continue; }
    if (c === "Time to upgrade") { await page.click("#upbtn"); continue; }
    const b = page.locator(".bubble:not(.gone)");
    if (await b.count()) await b.first().click({ force: true }).catch(() => {});
    if (t === 5) await page.click('#speedseg [data-speed="3"]').catch(() => {});
  }
  const st = await page.evaluate(() => ({ day: hype.state?.day, done: localStorage.getItem("hypeinc.tutorial.v1") }));
  console.log(name, seen.join(" > "), JSON.stringify(st), errors.length ? "ERRORS " + errors.join(" | ") : "no errors");
  await ctx.close();
}
await browser.close();
