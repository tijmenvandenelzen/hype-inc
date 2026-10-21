# Balance sim

Plays many games of Hype Inc. with bot players, for every product and every
scenario, and checks the win rates against `targets.json`. It uses the real
rules in `src/engine.js` and the real data in `src/data/`, so a change to a
JSON file shows up in the next run.

```sh
npm run balance                                   # all products, all scenarios, 100 games each
node sim/run.mjs --games 40 --scenario three-way  # one scenario, faster
node sim/run.mjs --product soda --bots smart,kid
node sim/run.mjs --set "rivals.megacorp.copyBaseRate=0.6;balance.winShare=0.45"
node sim/trace.mjs kid soda tiny-island 1003      # one game, day by day, with all news
```

- `--set` changes numbers in memory only. Use it to try a value, then put the
  value in the JSON file. Path: file name, then the `id` for list files, then
  the field (`products.app.effects.margin=-0.3`,
  `scenarios.head-start.rivals.heritage.progress=20`).
- `--json out.json` and `--md out.md` save the results.
- The exit code is 1 when a target fails. A full run takes about 1 minute per
  scenario. Run the scenarios in parallel if you are in a hurry.

## The bots

| Bot | Plays like |
|---|---|
| `smart` | A player who plans. Taps 85% of Hype bubbles and 75% of spies, buys the upgrade with the best value per point, buys defense when a copy bar goes up, sets Premium price when cash runs low. |
| `kid` | A 12 to 14 year old in the first runs. Taps 70% of bubbles and 35% of spies (60% when a bar is above 60), opens the upgrade screen every 6 to 15 days, buys what looks cool from a favourite tree, does not plan for upkeep, sets Premium only when cash is almost gone. |
| `rush` | Only growth upgrades, no defense. If it wins as often as `smart`, defense does not matter. |
| `idle` | Taps bubbles but buys nothing. It must always lose. |

The old v0.1 `good` bot is in `bots.mjs` too (`--bots good`), to compare with
`tools/sim.mjs`.

The `kid` bot is a guess. The playtest checklist asks you to note what the real
player does, so the bot can be made more like him.

## Targets (`targets.json`)

| Scenario difficulty | smart wins | kid wins |
|---|---|---|
| 1 (Kitchen Start) | 85-100% | 55-85% |
| 2 (Tiny Island, Broke Genius) | 70-92% | 30-65% |
| 3 (They Got There First, Three-Way War) | 50-85% | 20-60% |

Also: `idle` wins 0-5%, the median win of `smart` is on day 200 to 420, and
the gap between the best and the worst product in a scenario is 30 points or
less. `rush` should win at least 5 points less than `smart` (warning only).

## Balance pass 1 (v0.2 data)

### What was wrong

1. **Rivals took the world without the copy bar.** Rival fans grew at 0.06 to
   0.07 per day, about twice the player's speed. In Tiny Island (TrendLab) the
   rival got 90% of the world while its copy bar stayed near 0, so the game
   never ended: 12-33% of games ran past day 3000 and then the player went
   broke. In Three-Way War the three rivals filled the map and the player went
   broke; the smart bot won only 6-64%.
2. **TrendLab and Heritage copy bars did nothing.** Spy taps pushed them back
   faster than they grew (TrendLab: many spies, Heritage: -2 per spy). The bar
   is the main thing the player sees, so the threat must come from it.
3. **Products were far apart.** Video Game won almost every game (lots of
   bubbles), Phone App lost money (very low money per fan).

### What changed

| File | Value | Before | After | Why |
|---|---|---|---|---|
| rivals | `growth` MegaCorp / TrendLab / Heritage | 0.06 / 0.07 / 0.03 | 0.04 / 0.04 / 0.025 | Rival fans grow slower than a player with upgrades |
| rivals | MegaCorp `copyBaseRate`, `copyShareRate`, `spyChance` | 0.34, 1.8, 0.12 | 0.5, 2.2, 0.1 | The copy bar is the threat again |
| rivals | TrendLab `copyBaseRate`, `copyShareRate`, `spyChance` | 0.17, 0.7, 0.25 | 0.6, 1.5, 0.15 | Same; it still fades after day 250 and Better Recipe still slows it |
| rivals | Heritage `copyBaseRate`, `copyShareRate`, `spySetback` | 0.1, 0.5, 2.0 | 0.3, 1.0, 1.0 | Same |
| products | Sneakers `patent` | -0.25 | -0.1 | Still easy to copy, but not hopeless vs MegaCorp |
| products | Phone App `margin`, `loyalty` | -0.5, -0.2 | -0.35, -0.3 | Less broke, fans still switch easily |
| products | Video Game `appeal`, `bubbles`, `costCut` | 0.95, 0.3, -0.2 | 0.9, 0.1, -0.3 | Was the best product everywhere |
| products | Burger `costCut` | -0.3 | -0.2 | Lost 2 of 3 games by cash |
| scenarios | Broke Genius `startCash` | 350 | 250 | Was as easy as Kitchen Start. Pitch text fixed: it said $120k |
| scenarios | They Got There First `hp`, Heritage `progress` | 10, 15 | 8, 20 | Was easier than its difficulty |
| scenarios | Three-Way War `startCash` | 1200 | 1500 | Most losses were cash, not rivals |

### Results now (100 games per row)

| Scenario | Product | smart | kid | rush | idle | kid loses by |
|---|---|---|---|---|---|---|
| kitchen | soda | 100% (day 256) | 78% (day 267) | 63% | 0% | broke 13%, megacorp 9% |
| kitchen | sneakers | 100% (day 247) | 79% (day 261) | 64% | 0% | megacorp 12%, broke 9% |
| kitchen | app | 99% (day 238) | 80% (day 233) | 73% | 0% | broke 18%, megacorp 2% |
| kitchen | game | 100% (day 226) | 77% (day 253) | 54% | 0% | broke 20%, megacorp 3% |
| kitchen | burger | 100% (day 244) | 84% (day 270) | 57% | 0% | megacorp 4%, broke 12% |
| tiny-island | soda | 68% (day 301) | 33% (day 267) | 18% | 0% | trendlab 63%, broke 4% |
| tiny-island | sneakers | 91% (day 281) | 54% (day 262) | 53% | 0% | trendlab 46% |
| tiny-island | app | 86% (day 246) | 55% (day 231) | 67% | 0% | trendlab 43%, broke 2% |
| tiny-island | game | 99% (day 257) | 64% (day 260) | 52% | 0% | broke 3%, trendlab 33% |
| tiny-island | burger | 79% (day 300) | 63% (day 285) | 24% | 0% | trendlab 25%, broke 12% |
| broke-genius | soda | 93% (day 271) | 48% (day 255) | 39% | 0% | broke 52% |
| broke-genius | sneakers | 96% (day 254) | 50% (day 242) | 59% | 0% | broke 48%, megacorp 2% |
| broke-genius | app | 100% (day 210) | 76% (day 225) | 76% | 0% | broke 19%, megacorp 5% |
| broke-genius | game | 100% (day 232) | 43% (day 240) | 30% | 0% | broke 57% |
| broke-genius | burger | 85% (day 264) | 20% (day 240) | 44% | 0% | broke 80% |
| head-start | soda | 78% (day 301) | 71% (day 278) | 34% | 0% | broke 27%, heritage 2% |
| head-start | sneakers | 89% (day 286) | 74% (day 261) | 62% | 0% | broke 25%, heritage 1% |
| head-start | app | 97% (day 259) | 83% (day 244) | 65% | 0% | broke 16%, heritage 1% |
| head-start | game | 89% (day 312) | 65% (day 266) | 33% | 0% | broke 35% |
| head-start | burger | 74% (day 316) | 61% (day 271) | 57% | 0% | broke 37%, heritage 2% |
| three-way | soda | 64% (day 345) | 30% (day 320) | 32% | 0% | broke 49%, megacorp 21% |
| three-way | sneakers | 65% (day 318) | 46% (day 301) | 43% | 0% | megacorp 27%, broke 26%, trendlab 1% |
| three-way | app | 84% (day 282) | 65% (day 292) | 55% | 0% | megacorp 26%, broke 9% |
| three-way | game | 83% (day 273) | 55% (day 282) | 63% | 0% | broke 32%, megacorp 13% |
| three-way | burger | 80% (day 319) | 54% (day 308) | 55% | 0% | megacorp 12%, broke 34% |

Before this pass (same bots): Three-Way War smart 6-64%, kid 3-29%. Tiny
Island smart 34-99% with up to 33% endless games. No game runs to day 3000
now.

### Still open

- **They Got There First** is still easier than difficulty 3 for the `kid`
  bot (61-83%). Its losses are mostly cash, not Heritage. Wait for the
  playtest before more changes.
- **Broke Genius with Burger** is hard for `kid` (20%). That fits the
  scenario (cash), but watch it in the playtest.
- **Tiny Island with Soda** is the weakest pair (smart 68%): soda has no
  online bonus and TrendLab is an online rival.
- **Run length.** A `smart` win takes about 230-340 days. At speed 1 (1.5 s
  per day) that is 6 to 8.5 minutes; at speed 2 about 3 to 4 minutes. The
  playtest will show if that is too short.
- The `smart` bot is not perfect with cash: in some scenarios `kid` loses less
  often by cash than `smart`. The numbers for the hard scenarios are a rough
  guide, not exact.
