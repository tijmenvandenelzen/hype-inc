# Hype Inc.

A Plague Inc.-style business game. You make something at home (a soda,
sneakers, a phone app, a video game or a burger stand) and try to make the
whole world love it before the big companies copy it.

It is a web app (PWA). It runs in any browser, and on iPhone and iPad you can
add it to the home screen ("Share" > "Add to Home Screen"). Then it opens full
screen and works offline.

## How to play

1. Pick a product, name it, pick a colour and a challenge, then pick a region
   to launch in.
2. Tap the yellow bubbles to get Hype Points. Spend them on upgrades.
3. Watch your cash. Some upgrades cost money every day. At $0 you lose.
4. Rivals (MegaCorp, TrendLab, Heritage Brands) notice you and start to build
   a copy. Tap their spy bubbles to slow them down. Own 50% of the world
   market before any copy is ready.

Winning games unlocks harder challenges.

Keys on a Mac: space pauses, 1 2 3 set the speed, U opens upgrades.

## Project layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | The game rules. Pure functions, no DOM. |
| `src/main.js` | Map drawing, bubbles, panels, sound, game loop. |
| `src/data/regions.json`, `balance.json` | The 12 regions and the main numbers. |
| `src/data/products.json` | 5 products. Each names its upgrades file and event files. |
| `src/data/upgrades/<product>.json` | 15 upgrades in 3 trees per product. |
| `src/data/events/*.json` | News events: `common.json` plus one file per product. |
| `src/data/rivals.json`, `scenarios.json` | 3 rivals with tactics, 5 start challenges. |
| `src/sound.js`, `public/sound/` | Sound player and the sound files (CC0). |
| `src/art/`, `public/fonts/`, `public/icons/` | Icon sprite, fonts and app icons. |
| `src/map-data.js` | The world dot map. Made by `tools/make-map.mjs`. |
| `tools/sim.mjs` | Plays many games with bots to check the balance. |
| `tools/build.mjs` | Builds `dist/` (web app) and `dist-preview/` (one HTML file). |
| `tools/smoke.mjs` | Plays the built game in a headless browser and saves screenshots. |

## Code entry points

- `buildData(BASE, productId, scenarioId)` makes the data for one game.
- `newGame(data, { brand, color, start, seed })` makes the state. `start` is
  a region index; a scenario with a fixed start region ignores it.
- `step(state, data)` runs one day and returns UI items: `news`, `bubble`,
  `spy`, `reached`, `alert`, `end`.
- `buy(state, data, id)`, `collect(state, data, { type, value | rival })`.
- In the browser, `window.hype` gives `state`, `data` and `BASE` for tests.

## Commands

```sh
npm install          # once
npm run build        # build dist/ and dist-preview/
npm run sim          # balance check: win rates for 4 bots, all products
npm run sim -- 40 soda all   # one product, all challenges
npx serve dist       # play locally
```

To change the balance, edit `src/data/balance.json` or `src/data/rival.json`,
then run `npm run sim`. Aim for: good bot wins most games, idle bot never wins.

## Deploy

`.github/workflows/pages.yml` builds and publishes to GitHub Pages on each
push to `main`. In the repo settings, set Pages > Source to "GitHub Actions".

Map data: Natural Earth through `world-atlas`. Fonts: Bungee and Bricolage
Grotesque (SIL OFL). Sound: made from code, CC0.

Live: https://tijmenvandenelzen.github.io/hype-inc/
