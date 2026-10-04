# Agent report: myboard (items 6 and 14)

Derek's own eyes on the board, and a model that tunes itself in the open.

## What I built

### 1. Personal grades
- `data/grades.json` keyed by player id: an array of `{gameId, date, grade 1..5, note, at}` plus display hints (`name`, `team`, `pos`, `cls`) so the board can show a player even if the radar drops him.
- `src/lib/grades.ts`: `gradesFor(playerId)`, `myScore(playerId)` (average grade mapped 1 star = 0, 5 stars = 100), `allGraded()`, `setGrade()`, `removeGrade()`. Memoized by file mtime.
- `src/app/api/grade/route.ts`: GET `?playerId=`, POST `{playerId, gameId?, date?, grade, note?, name?, team?, pos?, cls?}` (upserts per player+game), DELETE `{playerId, gameId?}` (one grade, or all of the player's when gameId is omitted). Validates id and grade range.
- `src/components/GradeWidget.tsx` (client): five SVG stars plus a one-line note. Star tap saves immediately; note saves on Enter or blur. Shows the last grade on file and a clear button. `compact` mode for cards.
- Placed on the player page (new "My grade" section above "In the news", tied to this week's game when there is one) and on every ProspectCard on a game page once the game is live or final (`grade` prop, additive).

### 2. My board (`/board`)
- `src/app/board/page.tsx` (server) joins `allGraded()` with `radarPlayer()` and `entryFor()` (forecast band and estimated pick).
- `src/app/board/BoardClient.tsx` (client): sorted by Derek's score by default, with Radar, Blend, and Biggest gap sorts. Delta column reads "you have him 26 points above the model" and colors green/red at 15 or more. Position-group and draft-class chip filters. Blend slider (0..100, localStorage, `useSyncExternalStore` so the server renders 50 without a hydration flash) giving `w * mine + (1 - w) * radar`. CSV export of the filtered board (player, id, team, pos, class, draft class, games, my grade, my score, notes, radar, forecast, est pick, delta, blend). Notes column truncated with expand per row.
- Added "My board" to `NAV` in `layout.tsx` (eye icon). That makes seven mobile tabs; see gaps.

### 3. Closed loop (`scripts/tune.mjs`, `npm run tune`)
- Reads the archive through `listEntries` (falls back to reading `data/archive` directly if the module import fails), graded entries only.
- (a) Edge threshold: re-grades every archived edge at thresholds 15..40 (step 5) with the exact `archive.ts` rules, parsed from the stored `actual` line. Picks the best played-out rate with at least 30 calls, requires a 3-point gain, then bootstraps the difference (200 resamples of games) and applies only if the 5th percentile is above zero.
- (b) Scout Score: Pearson of the score, and of each component, with the excitement index. Proposal only (weights live in `score.ts`): drop a weight whose correlation is below -0.10 with the bootstrap 95th percentile below zero; raise a zero weight above 0.15 with the 5th percentile above zero.
- (c) Projection: winner rate and model-side cover rate by lean strength (under 3, 3 to 6, 6 and up points off the number). Re-blends `eloWeight` (0.3..0.9) and `edgeDivisor` (20..80) on games whose lock carries the parts, by mean absolute margin error, bootstrap on the error difference.
- (d) Total: mean model total minus the final and minus the market. Moves `totalBaselineOffset` by half of the final-based bias (half points, at most 2 per run) when the bootstrap 90% band excludes zero.
- Gate: at least 50 graded games or it prints the full summary and writes nothing. Also `--dry` (never writes) and `--min=N` (testing only).
- Writes `data/changelog.json` entries `{date, metric, from, to, evidence, applied}` and updates only the `applied` section of `data/weights.json`, preserving the backtest sections.
- New `src/lib/weights.ts`: `appliedWeights()` with `APPLIED_DEFAULTS` (eloWeight 0.6, edgeDivisor 40, edgeThreshold 20, totalBaselineOffset 0, equal to today's constants) and `APPLIED_BOUNDS` (0.3..0.9, 15..80, 15..40, -5..5). Out-of-bounds values in the file are ignored.
- `projection.ts` now reads the blend from `applied` when `USE_FITTED_WEIGHTS` is not set, adds `totalBaselineOffset` to `AVG_PPG`, and exposes `eloMargin` and `netEdge` so the lock can archive the parts. `tendencies.ts` reads `edgeThreshold` for `unitEdges` and `pressurePoint`.
- `archive.ts` (additive): `EdgeCall.gap` (signed percentile gap), `Pregame.scoreComponents`, and `eloMargin`/`netEdge` on the locked projection. Entries locked before tonight do not carry these; the tuner says how many do.

### 4. Changelog on the site
- `src/lib/changelog.ts` and `src/components/ModelUpdates.tsx`. "Model updates" section at the bottom of `/history` (`#model-updates`), newest first, one line each: "Oct 6: edge threshold 20 to 25 (played-out rate 61% vs 54%, n=73)" with an applied/proposal tag. Slate header shows "model updated Oct 6" (link to the section) when an entry is inside the last 7 days.

## Files touched
New: `src/lib/weights.ts`, `src/lib/grades.ts`, `src/lib/changelog.ts`, `src/app/api/grade/route.ts`, `src/components/GradeWidget.tsx`, `src/components/ModelUpdates.tsx`, `src/app/board/page.tsx`, `src/app/board/BoardClient.tsx`, `scripts/tune.mjs`.
Edited (additive): `src/lib/projection.ts`, `src/lib/tendencies.ts`, `src/lib/archive.ts`, `src/components/ProspectCard.tsx`, `src/app/game/[id]/page.tsx`, `src/app/player/[id]/page.tsx`, `src/app/history/page.tsx`, `src/app/page.tsx`, `src/app/layout.tsx`, `package.json` (`tune` script).

## How to verify
- `npx tsc --noEmit`: clean for everything above. The only errors in the tree are in `src/lib/playerlog.ts` (another agent; regex `s` flag needs an ES2018 target).
- `npm run tune`: with tonight's archive (131 locked, 4 graded) it prints the summary and ends with "not enough data: 4 of 50 graded games. Nothing written." No `data/changelog.json` is created and `data/weights.json` is untouched. `npm run tune -- --min=3 --dry` exercises the decision stage and reports "nothing to change" without writing.
- Grade round trip (done against the shared dev server on 3077, because Next 16 refuses a second `next dev` in the same tree): POST saved, GET returned it with `myScore` 75, `/board` rendered the player with "you have him 26 points above the model", a grade of 9 was rejected, DELETE removed it. `/history`, `/`, and `/player/5109518` all returned 200.
- Cron (Monday 6 AM Eastern), documented in the script header:
  - cron: `0 6 * * 1  cd /path/to/web && npm run tune >> data/tune.log 2>&1`
  - pm2: `pm2 start npm --name scout-tune --cron "0 6 * * 1" --no-autorestart -- run tune`
  - Windows: `schtasks /Create /TN "EdgeSheet tune" /SC WEEKLY /D MON /ST 06:00 /TR "cmd /c cd /d C:\path\to\web && npm run tune >> data\tune.log 2>&1"`

## Keys needed
None.

## Known gaps
- Archive entries locked before tonight have no `gap`, `scoreComponents`, `eloMargin`, or `netEdge`, so the threshold sweep, the per-component correlation, and the blend re-fit only count games locked from now on. The tuner prints how many carry them.
- Passing-downs edges cannot be re-graded at thresholds below the one they were locked at (their verdict comes from play-by-play, not the box line); they count only where the lock already called them.
- The total offset is tuned against the final score, with the market bias shown as evidence, because calibrating to the market would only teach the model to agree with the book.
- The dev server test ran on the shared 3077 server, not a separate one.
- Seven items in the mobile tab bar is tight. If it crowds, drop "My board" from the tabs and keep it in the top nav plus the player-page link.
- Grades are single-user with no auth, like follows and declarations.

## Ideas
- Grade the grader: once a graded player gets drafted (or not), score Derek's average grade and the radar against the pick, side by side. The board already has the data; the backtest's nflverse pull has the outcomes.
- Blend-by-position: Derek's eyes may beat the model at QB and lose at OL. Fit the blend weight per position group from draft outcomes and show it on the slider as the suggested default.
- "Watch again" queue: any game where Derek's grade and the radar disagree by 25 or more becomes a highlights link on the player page, so the disagreement gets a second look.
- Grade prompts in Telegram after a final: "You watched X @ Y. Grade the three radar names?" with one tap per star.
- Let the tuner propose radar weight changes (prod/pedigree/usage/size) from the draft backtest the same way it proposes Scout Score weights, still proposal-only.
- Changelog diff view: click an entry on /history to see the sweep table that produced it, not just the one-line evidence.
