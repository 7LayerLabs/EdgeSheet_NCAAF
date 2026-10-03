# Agent report: ESPN live feed and headshots

Verified 2026-10-03 (a Saturday with 37 FBS/FCS games in progress at test time). No key needed; ESPN's site API is public.

## What works

- Live score, clock, period, possession, down and distance, last play, win probability, and broadcast for every FBS and FCS game, overlaid on the CFBD slate. Status is now real: `live` only when ESPN says in progress, `final` when ESPN says post. A game CFBD thinks has started but ESPN says has not (delay, late kick) goes back to `upcoming`.
- Flip score per live game (closeness of the win probability plus its recent swing, weighted up in the third and fourth quarters). A "Flip to" quick filter on the slate sorts live games best first. A live ticker above the slate shows every live game, best flip first, with the refresh indicator.
- Game page "Live" section: scoreline with quarter scores, current situation and last play, win probability bar, a play-by-play win probability chart (inline SVG, shaded by who was favored, scoring plays as dots), scoring plays list, and a drive chart (most recent first, result tag, plays, yards, time, start to end).
- In-game box score from ESPN when CFBD's box is not published yet. Leaders per side in the same headline format as the CFBD box, and each radar prospect gets their in-game lines (4 of 12 radar players had lines in the Toledo at Ball State test). The settled CFBD box replaces it after the final; `box.source` says which one is showing.
- Headshots on ProspectCard, the player page, and the draft board rows. The ESPN image swaps to the jersey circle the moment it fails to load. Arch Manning (4870906) and Julian Sayin (5079712) return real 220 KB photos; unknown ids return a 404.
- Polling: `LivePoller` refreshes the server page every 60 seconds while a game is live, pauses when the tab is hidden, refreshes on return, and shows a "live, updating" dot. Used in the slate ticker and the game page header.
- Lower divisions are untouched (schedule-based status, no overlay). Sample-data fallback is untouched (no CFBD key means `getSlate` never reaches the overlay).

## Files

New:
- `src/lib/espn.ts`: typed fetchers. `liveScoreboard(date)` (memo 30 s, both FBS and FCS groups, Map by game id), `liveGame(id, date)`, `liveSummary(id)` (memo 60 s), `swingFor(id)`, `closenessOf(p)`, `headshotUrl(id)`, `espnDate()`. In-process ring buffer of win probability readings per game for the last 30 minutes.
- `src/lib/live.ts`: pure helpers safe for client components. `flipScore(game)`, `winProbLine(game)`, `anyLive(games)`.
- `src/components/Headshot.tsx` (client, `onError` fallback), `LivePoller.tsx` (client), `LiveLine.tsx` (card situation row and `WinBar`), `LivePanel.tsx` (game page section), `LiveTicker.tsx` (slate top row).
- `scripts/espn-check.mts` and `scripts/espn-slate-check.mts`: smoke tests.

Edited (additive only):
- `src/lib/types.ts`: `Game.live`, `Game.liveDetail`, `BoxSummary.source`.
- `src/lib/slate.ts`: import; `status` and `score` became `let`; overlay block right after they are computed; `liveP` next to `boxP`; ESPN box branch when CFBD has none; gap text; `live` and `liveDetail` in the returned Game.
- `src/components/Avatar.tsx`: `playerId` and `name` props, headshot attempt with the jersey circle as fallback.
- `src/components/GameCard.tsx`: `LiveLine` under the team line. `src/components/Slate.tsx`: "Flip to" quick filter and sort. `src/app/page.tsx`: ticker. `src/app/game/[id]/page.tsx`: `LivePanel` at the top of the "showed" section, `LivePoller` in the header, section title and box-source note. `ProspectCard.tsx`, `player/[id]/page.tsx`, `draft/page.tsx`: `playerId` wired.

## How to verify

```
npx tsc --noEmit
npx tsx scripts/espn-check.mts                       # feed only, prints live games, a summary, headshot status codes
npx tsx --env-file=.env.local scripts/espn-slate-check.mts   # through slate.ts: overlay counts, flip order, live game detail
```

Last run: 298 games on the slate, 90 live by CFBD's clock, 70 of them (all Division I) carrying the ESPN overlay; game 401866431 built with status live, clock "4th 0:56", ESPN box with 6 leaders per side, 193 win probability rows, 25 drives, 12 scoring plays.

The PM2 server still serves the old build, so the UI was not screenshotted. The orchestrator's build will light it up.

## ESPN fields actually present (checked against the raw JSON)

Scoreboard (`scoreboard?groups=80|81&limit=400&dates=YYYYMMDD`):
- `events[].id` matches the CFBD game id. `status.type.state` is `pre`, `in`, or `post`; `status.period`, `status.displayClock`, `status.type.shortDetail` ("1:58 - 4th", "Halftime", "Final").
- `competitions[0].competitors[].{homeAway, score (string), winner, team.{id, abbreviation}, linescores}`.
- `competitions[0].situation`: `lastPlay.text`, `lastPlay.probability.{homeWinPercentage, awayWinPercentage, secondsLeft}`, `down`, `distance`, `yardLine`, `isRedZone`, `downDistanceText` ("2nd & 10 at AUB 33"), `possessionText` ("AUB 33"), `possession` (team id). `possession` and `downDistanceText` are missing between plays and at halftime. `down` is -1 or 0 between plays.
- There is no `homeWinProbability` on the scoreboard. The current win probability is `situation.lastPlay.probability`. For final games I use the `winner` flag.
- `broadcasts[].names[]` is present ("ESPN+", "ACC Network"). `odds` appears only on pregame events. `headlines` was absent on every event.

Summary (`summary?event=<id>`):
- `boxscore.players[].statistics[]` with `keys`, `labels`, and `athletes[].{athlete.{id, displayName, headshot}, stats[]}`. Categories: passing, rushing, receiving, fumbles, defensive, interceptions, kickReturns, puntReturns, kicking, punting. `homeAway` is on `boxscore.teams[]` not on `players[]`, so I match by team id.
- `drives.previous[]` and `drives.current` with `team.abbreviation`, `result`, `displayResult`, `shortDisplayResult`, `yards`, `offensivePlays`, `timeElapsed.displayValue`, `start/end.{text, period, clock}`, `isScore`, `plays[]`. Results seen: TD, FG, PUNT, FUMBLE, DOWNS, MISSED FG, SF; the current drive has no result.
- `winprobability[]` is one row per play (`homeWinPercentage`, `playId`). Every playId matched a play in `drives[].plays`, which is where the period and clock for the x axis come from.
- `scoringPlays[]` with `period.number`, `clock.displayValue`, `team`, `type.abbreviation`, `text`, `homeScore`, `awayScore`.
- `header.competitions[0].competitors[].linescores[].value` was null on a live game while `displayValue` had the numbers; the parser reads both. `header.competitions[0].situation` was absent, so the situation comes from the scoreboard, not the summary.

## Limits

- The win probability swing needs readings in this server process. It starts empty on every restart and fills one reading per scoreboard fetch (at most every 30 s). For the first 2 minutes the card says "trend builds after 2 min". The summary's full series could seed it; see ideas.
- ESPN's `lastPlay.probability` can lag: at halftime several games showed `secondsLeft: 1800` and the probability stopped moving. One FCS game (Alabama A&M at Jackson State) sat at "1st 10:47" for over 30 minutes, so the feed itself stalls sometimes. The UI shows the as-of time from our fetch, not from ESPN.
- The scoreboard `dates=` day appears to be an Eastern calendar day. I query by the CFBD kickoff date in ET; a game that ESPN files under the other side of midnight would miss the overlay and fall back to schedule-based status.
- Headshots: unknown ids return a 404 (handled). ESPN sometimes serves a generic silhouette for ids it knows but has no photo for; that would render as a silhouette rather than the jersey circle. Not seen in testing, but it exists.
- `next/image` is not used for headshots (plain `img` with lazy loading) because the fallback needs `onError`. No `next.config` change needed.
- Only Division I. DII and DIII stay schedule-based with no score.
- The overlay runs for games that kicked off in the last 30 hours only, so past weeks never hit ESPN.

## Ideas

- Seed the swing from the summary's `winprobability` series for the game page (it has a clock on every row, so "last 15 minutes of game time" is computable without a process history). The slate could do the same for the top handful of flip candidates at the cost of one summary call each.
- Red-zone and fourth-down alerts: `isRedZone` and `down === 4` are in the feed. A "Right now" chip on the ticker ("4th & 2, NCSU in the red zone") is a one-liner.
- Flip score could use the posted spread too: a 20-point favorite tied in the fourth is a bigger story than a pick'em tied in the fourth.
- Telegram or Buzz push when a watchlisted game's flip score crosses 60 or its win probability crosses 50% in the fourth quarter. The poller already has the numbers every minute.
- Headshots for box leaders on the game page and the Record page rows, now that `Avatar` takes `playerId`.
- Postgame: the drive chart plus the pregame pressure point could grade "did the pressure point decide it" automatically (which unit's drives scored).
- ESPN `odds` on pregame events carries DraftKings spread and total. Useful as a second book for the consensus agent when CFBD lines are thin.
