// Renders icons/*.png from tools/icon.html. Run: node tools/make-icons.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = new URL("../icons/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto(new URL("icon.html", import.meta.url).href);
await page.waitForTimeout(800);
for (const [name, size, mask] of [["icon-512", 512], ["icon-192", 192], ["icon-180", 180], ["icon-maskable-512", 512, true]]) {
  await page.evaluate((m) => document.getElementById("icon").classList.toggle("mask", m), !!mask);
  await page.setViewportSize({ width: 512, height: 512 });
  const buf = await page.locator("#icon").screenshot();
  if (size === 512) { const { writeFileSync } = await import("node:fs"); writeFileSync(`${out}${name}.png`, buf); continue; }
  // Scale down in the browser.
  const small = await page.evaluate(async ([b64, s]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = c.height = s;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, s, s);
    return c.toDataURL("image/png").split(",")[1];
  }, [buf.toString("base64"), size]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${out}${name}.png`, Buffer.from(small, "base64"));
}
await browser.close();
console.log("Icons written to icons/");
