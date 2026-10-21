// Plays the game in a headless browser and saves screenshots. Run: node tools/smoke.mjs <url> <outdir>
import { chromium, devices } from "playwright";
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, opts] of [["mac", { viewport: { width: 1440, height: 900 } }], ["iphone", devices["iPhone 13"]], ["ipad", { ...devices["iPad (gen 7) landscape"] }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}-1-start.png` });
  await page.click("#newbtn");
  const [px, py] = await page.evaluate(() => hype.point(0));
  await page.mouse.click(px, py);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}-2-pick.png` });
  const lb = page.locator("#launchbtn");
  if (await lb.count()) await lb.click();
  else console.log(name, "no launch button");
  await page.click('#speedseg [data-speed="3"]');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const b = page.locator(".bubble:not(.gone)");
    if (await b.count()) await b.first().click({ force: true }).catch(() => {});
    if (await page.locator("#alert:not([hidden])").count()) await page.click("#alertok");
  }
  await page.screenshot({ path: `${out}/${name}-3-play.png` });
  await page.click("#upbtn");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-4-upgrades.png` });
  const info = await page.evaluate(() => ({ day: hype.state.day, hp: hype.state.hp, cash: Math.round(hype.state.cash), reached: hype.state.regions.filter((r) => r.reached).length }));
  console.log(name, JSON.stringify(info), errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
  await ctx.close();
}
await browser.close();
