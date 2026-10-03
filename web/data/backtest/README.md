# Backtest data and results

Written by `scripts/backtest.mjs`. Read by `src/lib/backtest.ts` and shown at `/backtest` (Track record).

```
node scripts/backtest.mjs                 # seasons 2022 to 2025, reuses <season>/ digests when present
SEASONS=2024 node scripts/backtest.mjs    # one season
REFETCH=1 node scripts/backtest.mjs       # pull everything from CollegeFootballData again
SKIP_NFL=1 node scripts/backtest.mjs      # skip the nflverse download
```

## Files

| Path | What it is |
| --- | --- |
| `<season>/players.json` | Same shape as `data/generated/players.json`: every roster player with a stat line, a recruiting grade, or an upperclass key-position spot. Full regular season. |
| `<season>/teams.json` | Same shape as `data/generated/teams.json`: FBS advanced stats for offense and defense, full regular season. |
| `<season>/advWeeks.json` | `{ "1": [teams...], "2": [...], ... }`. The same team digest but with stats through that week only (`endWeek` on the CFBD call). Team game counts come from the completed schedule through that week. This is what makes the walk-forward replay honest. |
| `<season>/games.json` | Regular-season games where at least one side is FBS or FCS. Compact: id, week, kickoff, neutral, conference game, completed, home, away, classifications, points, pregame Elo, excitement index. |
| `<season>/lines.json` | One row per game that had a spread: median across books of the closing spread (home, negative = home favored) and total, rounded to the half point, same as the live slate; opens when listed; book count. |
| `<season>/draft.json` | Same shape as `data/generated/draft.json`, for drafts season-4 through season+1. The first five are the demand table; season+1 is the draft being tested. |
| `<season>/meta.json` | Counts and the weeks that have walk-forward tables. |
| `nflverse_draft_picks.csv` | Public nflverse file with career approximate value per drafted player. Downloaded once. |
| `results.json` | Every metric below, per season and overall. |
| `../weights.json` | Recommended projection weights with the evidence in a comment. Not applied unless `USE_FITTED_WEIGHTS=1`. |

## What is replayed

The models are ported one for one into `scripts/lib/models.mjs` from `src/lib/radar.ts`, `forecast.ts`, `tendencies.ts`, and `projection.ts`. Differences from the live code are listed in `results.json` under `drift` and shown at the bottom of `/backtest`.

### Projection, two modes

`walkForward` (the honest one). For each completed FBS vs FBS regular-season game from week 4 on, the margin is computed from the pregame Elo on the game row and the unit edges built from advanced stats through the week before the game. Weeks 1 to 3 are skipped because the tables are too thin. Market comparisons use the closing line on the same games.

`projection` (comparison only, flagged `leaky: true`). Same grid using end-of-season stats for every game. Each game's own result is inside its inputs, so edge-heavy blends look better than they are. Do not quote these numbers.

Both modes grade a grid of blends in two forms (`form` on every grid row):

- `additive` (live since October 2026): `margin = eloMargin + (1 - eloWeight) * net / edgeDivisor`, with `eloWeight` in 0.4, 0.5, 0.6, 0.7, 0.8, 1 and `edgeDivisor` in 20, 30, 40, 60. The full Elo margin is always kept; `eloWeight = 1` adds no edge term and is Elo only.
- `weighted` (live before that): `margin = eloWeight * eloMargin + (1 - eloWeight) * net / edgeDivisor`, with `eloWeight` in 0, 0.2, 0.4, 0.6, 0.8, 1. This form shrinks the Elo estimate, which compressed big favorites. Kept for comparison.

The live site runs the additive form at 0.6 and 40. `(1 - eloWeight) / edgeDivisor` is points per percentile point of net edge in both forms. Rows with `net: "raw"` use all eight signed edge gaps instead of the live rule (four largest, gaps under 20 count as zero). `best` is the additive row with the lowest margin error; `bestCover` is the additive row with the best four-point-lean cover rate among rows with at least 500 such leans; `bestWeighted` is the best weighted row.

The model total is graded twice: `total` at the live league average of 25.6 points per team, `totalOld` at the previous 28.5. `bias` is the mean of model total minus real total, so a positive number means it runs hot.

### Projection metrics

| Key | Meaning |
| --- | --- |
| `winnerRate` | Share of graded games where the sign of the model margin matched the real margin. Ties excluded. |
| `mae` | Mean absolute error of the model margin in points. `rmse` is the root mean square. |
| `coverRate` | Model side against the closing spread. If the model margin is on the home side of the market margin, the model side is home; it is right when home covers. Every game counts, including near-agreements, so this is a weak signal by design. Pushes excluded. |
| `lean2CoverRate`, `lean4CoverRate` | Same, only on games where the model and the market differ by at least 2 or 4 points. `lean2Graded` and `lean4Graded` are the counts. |
| `market.winnerRate`, `market.mae` | The closing line graded the same way, on the same games. The benchmark. |
| `market.favoriteCoverRate` | How often the closing favorite covered. Context for cover rates. |
| `total.leanRate` | Model total (efficiency and pace, no weather) against the closing total. A lean is a gap of at least 2.5 points. Right when the real total landed on the lean's side. `overRate` and `underRate` split it. |
| `total.modelMae`, `total.marketMae` | Error of the model total and the posted total against the real total. |
| `calibration` | Games bucketed by the live blend's stated win probability for its pick, against how often the pick won. |
| `counts` | `fbsCompleted` games considered, `graded` games with Elo and charts, and why the rest dropped. |

### Draft forecast

For season S the radar is built from that season's `players.json` with next draft S+1, the demand table from drafts S-4 to S, and the forecast board exactly as `forecast.ts` builds it, with no declarations file (every junior stays in the pool). Real picks are the S+1 draft from CFBD. Players are matched by CFBD college athlete id first, then by normalized name plus college, then by a unique name. Specialists are excluded.

| Key | Meaning |
| --- | --- |
| `total.r1HitRate` | Recall. Of the real round-one picks, the share the forecast had in "Round 1 range". |
| `total.top100HitRate` | Of the real top-100 picks, the share in "Round 1 range" or "Day 2 range". |
| `total.onRadarRate` | Of all draftees, the share that appeared on the radar at any tier. `inPoolRate` is the share in the forecast pool (Eligible or Sleeper, right class). |
| `total.rankCorrelation` | Spearman rank correlation between the forecast board position and the real overall pick, among draftees who were on the board. 1 is perfect order, 0 is random. |
| `bands[]` | Precision. For each band, how many names the forecast put there and how many were drafted, went in round one, or in the top 100. |
| `byGroup` | The same metrics per position group. |
| `matchedById`, `matchedByName` | How the join happened. Name matches are rarer and less certain. |

### Excitement sanity check

CollegeFootballData's `excitementIndex` (0 to 10, from win probability swings) against two Scout Score inputs that can be rebuilt for past games: competitive expectation from the closing spread (or Elo gap when there is no line, same rule as `slate.ts`), and style contrast from `tendencies.ts`. Pearson and Spearman correlations, plus average excitement by competitive bucket. The other Scout Score inputs (draft talent, direct matchups, availability, storylines) depend on broadcast data and curated prospect files that are not replayed.

### NFL outcomes

`draft_picks.csv` from the nflverse-data GitHub releases gives `w_av` (weighted approximate value), `car_av`, and the last season played (`to`). Joined on normalized name plus draft year, with college or pick number as a tie-breaker. Value is `w_av` (falling back to `car_av`) divided by seasons played, so a 2023 pick and a 2025 pick are compared on the same footing. Reported: Spearman correlation of each radar input (production percentile, pedigree, usage, radar score) with that value, and the real draft slot as the benchmark, overall and by position group with at least 8 players. Careers of one to three seasons are mostly noise. Read the sign and the relative order, not the size.

## Caveats, in order of importance

1. Four seasons is a small sample for game-level rates. A two-point swing between seasons is noise.
2. Walk-forward uses stats through the prior week, but the Elo is CFBD's own pregame rating, which already encodes the schedule to date. It is the best public pregame rating available and the live site uses the same field.
3. The full-season replay is leaky and only there to show how much the leak inflates things.
4. The radar replay uses full-season stats. In season the radar sees partial stats, so in-season radar tiers are noisier than the draft hit rates here suggest.
5. Juniors who returned to school are left in the pool. That lowers precision (names in a band who were not drafted) but does not affect recall.
6. Lines are CFBD's listed closing numbers across the books it tracks. They are not the number any one person could bet.
7. The weather tilt is not replayed (no historical forecasts), so the total lean here is the pure efficiency-and-pace model.
