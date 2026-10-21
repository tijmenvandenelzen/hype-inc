import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../src/data/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir)));
const folder = (name) => Object.fromEntries(readdirSync(new URL(`${name}/`, dir))
  .filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), read(`${name}/${f.slice(0, -5)}`)]));

// Same shape as BASE in src/data.js.
export function loadBase() {
  return {
    regions: read("regions").regions,
    products: read("products").products,
    upgrades: folder("upgrades"),
    events: folder("events"),
    rivals: read("rivals").rivals,
    scenarios: read("scenarios").scenarios,
    balance: read("balance"),
  };
}
