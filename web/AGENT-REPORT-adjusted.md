# Agent report: opponent-adjusted production, weekly snapshots, risers

Round 2, items 4 and 5. The radar now knows who a player did it against, and it remembers last week.

## What I built

### 1. Opponent-adjusted production
- `scripts/ingest-gamelogs.mjs` pulls CFBD `/games/players` for every week played (FBS and FCS, sequential, 1.2 s pause, 429 backoff) and writes `data/generated/gamelogs.json` (7.2 MB): per player id, an array of game lines `{g, wk, st, t, opp, ha, s}` with the same compact stat keys as `scripts/lib/digest.mjs`. Only players in `players.json` are kept. First run: 659 games, 14,814 players, 45,371 lines, weeks 1 to 5. `npm run ingest:gamelogs`.
- `src/lib/adjusted.ts`: per-game production (same weights as the season formula, efficiency terms damped on tiny samples), weighted by the opponent's season rank on the axis that matters:
  - RB: opponent rush-defense success rate
  - QB, WR, TE: opponent pass-defense success rate and explosiveness allowed (averaged)
  - DL, EDGE, LB, CB, S: opponent offensive line yards
  - Weight: 1.0 for an average unit, 1.5 for the best, 0.6 for the worst. FCS opponent of an FBS team with no advanced stats: 0.6. FCS vs FCS: neutral 1.0 and not counted toward the schedule label (free tier has no FCS advanced stats).
  - Averages divide by the team's games played, not only games with a line, so a one-catch cameo does not read like a star. The same volume gates as the raw formula apply (QB 40 att, RB 20 car, WR/TE 5 rec), otherwise the adjustment is not applied and the player keeps his raw percentile.
  - Exports: `adjustedProduction(playerId, group)` (rows, rawAvg, adjAvg, ratio), `qualityOfCompetition(playerId)` (average opponent percentile faced, label soft / average / tough / unmeasured, thresholds 38 and 62), `adjustedIndex()` for the radar, `gameLineText`.
- `src/lib/radar.ts`: production = round(0.5 raw percentile + 0.5 adjusted percentile) when a game log exists, else raw. New RadarPlayer fields: `rawProduction`, `adjustedProduction`, `qoc`, `qocLabel`, `delta`. Memo key includes the gamelogs mtime and the snapshot stamp.

### 2. Weekly snapshots and movement
- `scripts/snapshot.mjs` (runs `scripts/lib/snapshot-run.mts` through tsx, which calls `src/lib/snapshot.ts`) writes `data/snapshots/<YYYY-MM-DD>/radar.json` (every radar player: score, tier, production, pedigree, usage, draftClass, group, classification) and `forecast.json` (every forecast entry: band, overall, posRank, estPick, adjusted, decision). `npm run snapshot`. First snapshot taken 2026-10-03: 6,012 radar players, 2,448 forecast entries.
- `src/lib/movement.ts`: `movementFor(playerId)` (score delta, production/pedigree/usage deltas, tier, band and overall change, declaration change, a reason), `biggestMoves(n)` (risers and fallers by score delta and by forecast overall change, Division I only), `scoreSeries(id)` for sparklines, `listSnapshots()`, `movementStamp()`. Reason in code: declaration change first, then whichever of production / pedigree / usage moved most, then tier, then "board moved around him".
- Monday cron (PM2), after the game logs refresh:
  ```
  pm2 start "npm run ingest:gamelogs && npm run snapshot" --name scout-snapshot --cron "30 6 * * 1" --no-autorestart --cwd C:\Users\derek\OneDrive\Desktop\ASTRA_TESTING\college-game-scout\web
  ```
  Cron string `30 6 * * 1` is 6:30 AM Monday in the box's local time. Run `npm run ingest` first if the season stats should be fresh too (not in the cron because of the rate limit note in the brief).

### 3. UI
- `src/components/MovementBits.tsx` (no data imports, safe in client trees): `DeltaArrow`, `Sparkline`.
- `src/components/Movement.tsx` (server only): `StockPanel` (sparkline plus "This week +N" chip), `GameLog` (opponent, their rank on his axis, his line, raw / adjusted), `BiggestMoves` (draft page section with risers, fallers, forecast board moves and the reason).
- ProspectCard: delta arrow next to the radar score when a previous snapshot exists; "vs tough schedule, avg opponent 66th pct" line when the label is tough or soft. Both additive.
- Player page: delta arrow under the big score, Production meter note shows raw vs adjusted, Stock panel, "Game log vs opponent quality" table with the schedule chip.
- Draft page: "Biggest moves this week" above Round 1 range.
- Radar page: "Risers" sort option, with a notice when there is only one snapshot.
- All of it says plainly "First snapshot taken Oct 3. Movement appears after the next weekly snapshot." until a second snapshot exists.

### 4. Telegram
- `stockDigest(moves, base)` in `src/lib/digests.ts`. Pure: takes the result of `biggestMoves(5)` (from `src/lib/movement.ts`, server side) and returns Telegram HTML. With one snapshot it returns the honest one-liner. Suggested bot wiring: a `/stock` command and a Monday 7 AM push after the snapshot cron. I messaged the telegram agent.

## Files touched
New: `scripts/ingest-gamelogs.mjs`, `scripts/snapshot.mjs`, `scripts/lib/snapshot-run.mts`, `scripts/adjusted-check.mts`, `scripts/adjusted-impact.mts`, `src/lib/adjusted.ts`, `src/lib/movement.ts`, `src/lib/snapshot.ts`, `src/components/Movement.tsx`, `src/components/MovementBits.tsx`, `data/generated/gamelogs.json`, `data/snapshots/2026-10-03/`.
Edited (additive): `src/lib/generated.ts` (GenGameLogs reader), `src/lib/radar.ts`, `src/lib/digests.ts`, `src/components/ProspectCard.tsx`, `src/app/player/[id]/page.tsx`, `src/app/draft/page.tsx`, `src/app/radar/page.tsx`, `package.json` (scripts `ingest:gamelogs`, `snapshot`).

## How to verify
```
npx tsc --noEmit                      # my files are clean; remaining errors are in BeatFeed.tsx, watchguide.ts, playerlog.ts, plan.ts, og-check.mts (other agents)
npx tsx scripts/adjusted-check.mts    # five known players, raw vs adjusted, per-game rows, QoC
npx tsx scripts/adjusted-impact.mts   # how much the adjustment moved the board
npm run snapshot                      # overwrites today's snapshot
```
I also tested the two-snapshot path by writing a perturbed copy as 2026-09-26, running biggestMoves, movementFor, scoreSeries and stockDigest, then deleting it. Risers, fallers, forecast moves, reasons, the delta on RadarPlayer and the sparkline series all came through.

## Five known players (raw percentile, adjusted percentile, blended, schedule)
| Player | Pos | Raw | Adjusted | Production | QoC | Label |
|---|---|---|---|---|---|---|
| Jeremiah Smith, Ohio State | WR | 100 | 100 | 100 | 46 | average |
| Arch Manning, Texas | QB | 55 | 88 | 72 | 62 | tough |
| Julian Sayin, Ohio State | QB | 96 | 99 | 98 | 46 | average |
| Cam Cook, West Virginia | RB | 97 | 98 | 98 | 36 | soft |
| Marcus Stokes, Memphis | QB | 99 | 90 | 95 | 28 | soft |

Manning is the poster child: Ohio State (No. 43 pass D), Tennessee (No. 26), and the adjustment moves him 33 percentile points. Stokes' 99th-percentile raw line came against UNLV, Arkansas State (No. 117), Boise State, UT Martin (FCS) and Charlotte, and the adjustment says so.

## How much it moved the top 25 (2027 class, Division I, by radar score)
- 20 of the top 25 sit at a different rank than they would with raw-only production. 12 scored higher with the adjustment, 4 lower. Mean absolute score change inside the top 25: 0.84 points. The top 11 is the same eleven names in nearly the same order (Sayin and Smith swap 1 and 2).
- Entered the top 25: Malachi Singleton (App State QB, raw rank 27), Gi'Bran Payne (Cincinnati RB, 30), T.J. Moore (Clemson WR, 36, tough schedule), Antwan Raymond (Rutgers RB, 28), Cam Cook (29), Jackson Arnold (UNLV QB, 31).
- Left the top 25: Yhonzae Pierre (now 26), Raylen Wilson (Georgia LB, now 30, soft schedule, QoC 15), Chris Cole (35), Ellis Robinson IV (42), Aidan Chiles (27).
- Across the 2,439 Division I radar players with a log: mean absolute score change 1.73, max 14. Biggest losers are RBs and QBs on soft slates (Nate Frazier, Georgia; A'Marion Peterson, UTSA; Nate Bennett, Baylor; Dante Moore, Oregon). Biggest gainers are interior DL, where the game log is fresher than CFBD's season stats (Eddrick Houston shows 3 tackles in season stats and 7 tackles plus 2 hurries in the box scores; the season-stats endpoint lags).
- Forecast Round 1 range (31 names): 2 tough schedules, 13 average, 8 soft, 8 unmeasured (OL and players without logs).

## Known gaps
- FCS advanced stats are not on the free tier, so an FCS player's adjustment is neutral and his schedule reads "unmeasured". An FBS player's FCS game counts 0.6 and as a known soft game in the QoC average.
- CFBD's season stats lag the box scores for some players (above). That is a reason to lean harder on the game log over time, or to rebuild season stats from it.
- Weight uses season-to-date opponent quality, so week 1 games are judged by what the opponent became, not what it was that day. Fine for the purpose; noted.
- Week 6 (today's games) is not in the log yet; the calendar start date had not passed when the ingest ran. The Monday cron picks it up.
- Movement is snapshot to snapshot, so a Saturday page shows last Monday's delta, not a live one. That is deliberate: it keeps "this week" stable and explainable.
- The player page now has two log-shaped sections: mine (season table vs opponent quality) and another agent's PlayerGameLog (play-by-play of this week's game). I titled mine "Game log vs opponent quality" so they read as different things.

## Ideas
- Opponent-adjusted usage: a 30% usage share in a blowout against an FCS team is garbage time. The play-by-play digest already has per-game counts; weight usage by game leverage.
- "Proved it" badge: a Round 1 range player whose adjusted percentile beats his raw one AND whose best game came against a top-25 unit. That is the sentence a scout actually says.
- Schedule ahead: the same axis tables can rank the next three opponents, so the card can say "faces No. 4 and No. 9 rush defenses in the next two weeks" and the Monday stock report can preview who is about to be tested.
- Stock chart on the draft page: a tiny sparkline per Round 1 name once there are four snapshots, and a "most volatile" list.
- Rebuild season stats from the game log instead of the lagging endpoint, which also gives per-week splits (last two weeks vs the season) for a "heating up" flag.
- Jev could label the reason text when it is ambiguous (production and pedigree both moved) with a Choice over the snapshot diff, but the code reasons are already deterministic and that is more honest.
