# AGENT-REPORT-odds: line movement, closing lines, CLV, ledger, props

## What I built

The Odds API (the-odds-api.com, v4) feeds four things: a per-book line table and consensus per snapshot, a line-movement sparkline and sentence on the game page, closing lines and closing-line value (CLV) on the archive grade, and a flat-bet ledger on the Record page. Player props come on demand from a button, never automatically. Everything degrades to a clear "add ODDS_API_KEY" note until the key exists.

### Files added
- `src/lib/odds-core.mjs`: pure logic shared by the app and the cron script. Name normalization and a school+mascot matcher (CFBD "Miami" + "Hurricanes" vs the book's "Miami Hurricanes", aliases for UMass, Ole Miss, FIU, App State, Sam Houston, UConn, LSU, etc., accent stripping for San Jose State and Hawai'i, swapped-side detection for neutral sites, 36-hour kickoff window so the same two teams in another week cannot collide). Parses events into per-book lines in CFBD's convention (home spread, negative = home favored), consensus medians rounded to the half point, movement text, the snapshot files, usage tracking from the `x-requests-*` headers, and the two fetchers.
- `src/lib/odds-core.d.mts`: types for the core.
- `src/lib/odds.ts`: `hasOddsKey`, `fetchOdds()` (memo 10 min), `eventOdds()`, `snapshotGame()` (page-path refresh under the throttle), `fetchPropsForGame()`, `lineHistory`, `closingLine`, `openingLine`, `movement`, `summarize`, `gameOdds` (what `getGame` calls), `clvFrom` and `closingValue` (used by the archive), `findOddsFile`.
- `src/lib/ledger.ts`: `buildLedger(entries)` rebuilds side gap and total gap from what the lock stored (the archive never saved `sideGap`, so it is derived from winner, margin, and the locked spread), classifies strong (6+ side, 6+ total) and moderate (3+ side, 4+ total) leans, grades each leg from the archive's own `modelSideCovered` and `totalLeanRight`, stakes one unit at -110 on strong leans, and attaches CLV from `postgame.clv` or computes it from the odds file for older grades.
- `src/components/LineMovement.tsx`: movement sentence, two inline SVG sparklines (consensus spread, consensus total), opening and closing tiles, per-book table with prices and update times, credits remaining.
- `src/components/PropsForRadar.tsx` + `src/components/PropsButton.tsx` (client): props grouped per player and market, median point across books, "Market: 245.5 pass yds at DK" lines under each radar player, other listed players collapsed, and the fetch button (labeled with its 4-credit cost).
- `src/components/Ledger.tsx`: the Ledger section on `/history` with four tiles (simulated units on strong leans, units with moderate leans, CLV average, leans graded) and the table: game, lean, number at lock, closing number, CLV, result, units, running units.
- `src/app/api/odds/props/route.ts`: POST `{id}`; finds the odds file, fetches props once an hour at most per game.
- `scripts/odds-snapshot.mjs`: one slate call for this week's not-yet-final FBS and FCS games. `--dry` uses the free `/events` endpoint to test matching with zero credits. `--reserve N` refuses to spend below N credits.

### Shared files touched (additive only)
- `src/lib/types.ts`: `odds?: import("./odds").GameOdds` on Game.
- `src/lib/slate.ts`: one import, one line in `buildGameById` (`game.odds = await gameOdds(game, raw.season)`), game page only.
- `src/lib/archive.ts`: one import, `clv?: ClvRecord` on Postgame, one line in `gradePostgame` that records closing spread, closing total, side CLV and total CLV at grade time.
- `src/app/game/[id]/page.tsx`: two imports, `<LineMovement>` after the model-vs-market box, `<PropsForRadar>` at the end of the Draft radar section.
- `src/app/history/page.tsx`: one import, `<LedgerSection entries={graded} />` above the pending list.
- `package.json`: `"odds:snapshot": "node scripts/odds-snapshot.mjs"`.

## Request budget plan (free tier: 500 credits a month)

The Odds API charges credits per call as markets x regions, not one per call.

| Call | Markets | Cost |
| --- | --- | --- |
| Slate snapshot (h2h, spreads, totals, region us) | 3 | 3 credits |
| Props for one game (4 player markets) | 4 | 4 credits |
| `/events` list (used by `--dry`) | 0 | free |

Plan that fits inside 500:
- Cron `npm run odds:snapshot` every 4 hours on Wed through Sat: 24 calls a week, 72 credits, about 310 a month. Every 2 hours all week would be about 1,080 a month and does not fit the free tier.
- Game page refresh: only when the newest snapshot for that game is older than `ODDS_PAGE_INTERVAL_MIN` (default 90) and only while the game is upcoming. Each slate response also refreshes every other open game that already has a file, so one credit spend updates the whole slate.
- Props: button only. Budget about 10 pulls a month, 40 credits.
- Reserve: both paths stop spending when `x-requests-remaining` drops to `ODDS_RESERVE` (default 40), so the month never ends at zero mid-slate.
- `data/odds/usage.json` holds remaining, used, last cost, and call count. The game page shows credits remaining next to the checked time.

Suggested Task Scheduler line (Windows) once the key is in:
```
node C:\Users\derek\OneDrive\Desktop\ASTRA_TESTING\college-game-scout\web\scripts\odds-snapshot.mjs
```

## How to verify
- `npx tsc --noEmit` passes. `npx eslint` on the new files passes.
- Core logic test (parsing per the documented v4 shapes, matching including swapped neutral sites and accents, consensus, movement sentence, closing before kickoff, props parse with `description` as the player, usage headers) passed in a scratch harness: `MIA -12 to -15.5 over 4 days; 3 of 3 books moved. Total 48.5 to 51.`
- `node scripts/odds-snapshot.mjs` without a key prints "ODDS_API_KEY missing" and exits 0. `--dry` with a key costs nothing and prints every match and every unmatched event.
- After the orchestrator rebuilds: `/game/<id>` Market section shows the yellow "add ODDS_API_KEY" card; `/history` shows the Ledger section with results and units from the archive and "needs ODDS_API_KEY for closing lines" under the CLV tile.

## Untested without a key
- A live `/v4/sports/americanfootball_ncaaf/odds` response: bookmaker keys and titles in the `us` region, whether `commenceTimeFrom`/`To` behave as documented, and the exact set of books that post FCS games (expect few or none; FCS files will mostly be empty).
- Real team names from the books across the full FBS and FCS list. The matcher has aliases for the known traps and a token-overlap fallback, but the first `--dry` run will show any misses in its "no match" list. Add any new aliases to `ALIAS_GROUPS` in `odds-core.mjs`.
- Props availability for college games by book and how early they post (usually Thursday or Friday for big games only).
- The `x-requests-*` headers on the real response.

## Known gaps
- "Number at lock" is the CollegeFootballData consensus the model saw; "closing" is the Odds API consensus. Two sources, both medians of US books, but not the same books. Once the key is in and snapshots exist before locks, the lock could also record the Odds API number for a like-for-like CLV.
- Closing line is the last snapshot before kickoff. With a 4-hour cron the "close" can be up to 4 hours stale; the tile says "last snapshot N h before kick; not a true close" when it is more than 3 hours old.
- The archive is upcoming-only for locks, so CLV for already-graded games fills in only if an odds file exists for them (it will not, until snapshots start).
- Rendering is not visible on port 3000 until the orchestrator rebuilds (PM2 runs `next start`).

## Ideas
- Steam detector: flag a game when 4 or more books move the same direction by a point or more within one snapshot interval, and push it to the Telegram agent.
- Reverse line movement: when the consensus moves against the side the public would obviously back (big-brand favorite), mark it in Why watch. That is the one line-movement signal with a real literature behind it.
- Lock the Odds API number at lock time too, then CLV is apples to apples and the ledger can show "number at lock vs best available at lock" as a line-shopping stat.
- Per-book bias: after a season of snapshots, which book is first to move on college games. That is a scouting-style question about the market.
- Record the model's number in the odds file at each snapshot so the sparkline can draw the model line as a flat reference against the moving market.
