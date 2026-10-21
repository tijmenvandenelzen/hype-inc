# Hype Inc.

A Plague Inc.-style business game. You make a soda in your kitchen and try to
make the whole world love it before MegaCorp copies it.

It is a web app (PWA). It runs in any browser, and on iPhone and iPad you can
add it to the home screen ("Share" > "Add to Home Screen"). Then it opens full
screen and works offline.

## How to play

1. Name your drink, pick a colour, and pick a region to launch in.
2. Tap the yellow bubbles to get Hype Points. Spend them on upgrades.
3. Watch your cash. Some upgrades cost money every day. At $0 you lose.
4. MegaCorp notices you after a while and starts to build a copy. Tap the
   purple spy bubbles to slow them down. Own 50% of the world market first.

Keys on a Mac: space pauses, 1 2 3 set the speed, U opens upgrades.

## Project layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | The game rules. Pure functions, no DOM. |
| `src/main.js` | Map drawing, bubbles, panels, game loop. |
| `src/data/*.json` | Regions, products, upgrades, events, rival, balance numbers. |
| `src/map-data.js` | The world dot map. Made by `tools/make-map.mjs`. |
| `src/body.html`, `src/style.css` | Screen layout and look. |
| `tools/sim.mjs` | Plays many games with bots to check the balance. |
| `tools/build.mjs` | Builds `dist/` (web app) and `dist-preview/` (one HTML file). |

## Commands

```sh
npm install          # once
npm run build        # build dist/ and dist-preview/
npm run sim          # balance check: win rates for 4 bot players
npx serve dist       # play locally
```

To change the balance, edit `src/data/balance.json` or `src/data/rival.json`,
then run `npm run sim`. Aim for: good bot wins most games, idle bot never wins.

## Deploy

`.github/workflows/pages.yml` builds and publishes to GitHub Pages on each
push to `main`. In the repo settings, set Pages > Source to "GitHub Actions".

Map data: Natural Earth through `world-atlas`.
