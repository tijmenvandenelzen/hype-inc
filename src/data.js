import up_app from "./data/upgrades/app.json" with { type: "json" };
import up_burger from "./data/upgrades/burger.json" with { type: "json" };
import up_game from "./data/upgrades/game.json" with { type: "json" };
import up_sneakers from "./data/upgrades/sneakers.json" with { type: "json" };
import up_soda from "./data/upgrades/soda.json" with { type: "json" };
import ev_app from "./data/events/app.json" with { type: "json" };
import ev_burger from "./data/events/burger.json" with { type: "json" };
import ev_common from "./data/events/common.json" with { type: "json" };
import ev_game from "./data/events/game.json" with { type: "json" };
import ev_sneakers from "./data/events/sneakers.json" with { type: "json" };
import ev_soda from "./data/events/soda.json" with { type: "json" };
import regions from "./data/regions.json" with { type: "json" };
import products from "./data/products.json" with { type: "json" };
import rivals from "./data/rivals.json" with { type: "json" };
import scenarios from "./data/scenarios.json" with { type: "json" };
import balance from "./data/balance.json" with { type: "json" };

// Same shape as tools/load-data.mjs. engine.buildData() turns it into the data for one game.
export const BASE = {
  regions: regions.regions,
  products: products.products,
  upgrades: { app: up_app, burger: up_burger, game: up_game, sneakers: up_sneakers, soda: up_soda },
  events: { app: ev_app, burger: ev_burger, common: ev_common, game: ev_game, sneakers: ev_sneakers, soda: ev_soda },
  rivals: rivals.rivals,
  scenarios: scenarios.scenarios,
  balance,
};
