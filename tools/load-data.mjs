import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url)));

// Same shape as the data object the browser builds in src/data.js.
export function loadData() {
  const u = read("upgrades");
  return {
    regions: read("regions").regions,
    products: read("products").products,
    upgrades: u.upgrades, trees: u.trees,
    events: read("events"),
    rival: read("rival"),
    balance: read("balance"),
  };
}
