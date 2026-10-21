import regions from "./data/regions.json" with { type: "json" };
import products from "./data/products.json" with { type: "json" };
import upgrades from "./data/upgrades.json" with { type: "json" };
import events from "./data/events.json" with { type: "json" };
import rival from "./data/rival.json" with { type: "json" };
import balance from "./data/balance.json" with { type: "json" };

// Same shape as tools/load-data.mjs.
export const DATA = {
  regions: regions.regions,
  products: products.products,
  upgrades: upgrades.upgrades, trees: upgrades.trees,
  events, rival, balance,
};
