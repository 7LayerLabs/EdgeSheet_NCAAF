# AGENT-REPORT-liveplan (items 7 and 8: per-player live logs, Saturday plan)

## What I built

1. **Per-player play logs** from ESPN's summary play-by-play: `src/lib/playerlog.ts`.
   `playerLog(gameId, playerId)` returns ordered plays `{quarter, clock, down, distance, situation, text, yards, isScoring, isBig, role, tag, homeScore, awayScore, seq}` plus a running line computed from the plays (`line`, `lineText` in the box-score voice). Memoized 60 s per game and per player; the raw summary is fetched once per game. `playerLogs(gameId, ids)` parses once for many players; `lastPlaysFor(gameId, ids)` gives the newest play per player for the cards.
   Matching is strict: jersey + first initial + last name (suffix stripped) from `data/generated/players.json`, scoped to the player's own roster. Jerseys repeat inside a team (Georgia has two number 14s), so all three parts are required. A twin on either roster flags `ambiguous` with the other name. No roster row, no jersey, or no summary gives a log with `reason` set, never a throw.
   Verified against ESPN's own box lines on Georgia-Vanderbilt (final): Stockton 25/32, 295 yds, 3 TD, 0 INT and 7 car, 22 yds exact; Berlowitz 12/23, 190, 1 TD, 1 INT exact; CJ Heard 9 tkl, 1 TFL, 1 sack, 1 PD exact; Roldan 2 rec, 57 yds, 1 TD exact; Mensah live (Miami-Clemson) 9/13, 141, 1 TD and 2 car, 33, 1 TD exact.
2. **Player page**: "Live log" (live) or "Game log, this week" (final) section, `src/components/PlayerGameLog.tsx`, newest play first, scoring plays green, big plays navy, computed line next to the box line, ambiguity banner, LivePoller while live. Replaces the plain "This week's game" list once a log exists.
3. **Game page**: one additive prop `lastPlay` on `ProspectCard` (a "Last play" strip under the evidence), filled on live Division I games by `lastPlaysFor` in `src/app/game/[id]/page.tsx`.
4. **Telegram live loop** in `scripts/telegram-bot.mjs` (additive): `liveTick()` every 60 s. For each followed player in a live game it sends each NEW big play ("Jaden Craig (TCU QB): 2-yd run, 4th quarter 14:58. BYU 10, TCU 7" plus the full play text, today's computed line, links), throttled to one message per player per 2 minutes (cursor stays put when throttled, so the play goes next tick). Cursor per `gameId:playerId` = last play sequence sent, stored in `data/telegram-state.json` as `liveCursor`; the first sight of a player sets the cursor without sending, so a restart or a new follow never replays the game. Score-change ping per followed team game, one per 5 minutes (`scoreSeen`, `scoreSent`). Live state comes from the ESPN scoreboard (30 s memo, zero CFBD calls); the slate is rebuilt at most every 10 minutes in the loop.
5. **Saturday plan**: `src/lib/plan.ts` (pure `buildPlan`, `planText`), `src/lib/plan-load.ts` (`getPlan(date)`: slate + follows + roster names + live logs for followed players), page `src/app/plan/page.tsx` (`/plan?date=`), nav entry "Plan". Thirty-minute blocks from the first kickoff to the last expected final, each with the recommended game, a one-line why, up to two switch triggers about other games, and the other games on. Live blocks refresh every 60 s via LivePoller. "Send plan to Telegram" button (POST `/api/notify` type `plan`, added to the route and to `SendToTelegram`), `/plan [date]` bot command, `/plan` in `/help`.
   Rules: rank = Scout Score, +25 followed team, +10 per followed player (max two), +10 strong lean, +5 moderate, minus 15 with no network, scaled by game phase (fourth quarter 1.15x). Live, current block only: + closeness x 40, + min(swing, .4) x 60, +25 fourth quarter within one score, +8 red zone (parsed from ESPN's "at UGA 14" text vs possession), +10 followed player with a play this quarter. Triggers, live: followed player on the field (per the live log), fourth quarter within one score, win prob within 15 points, red-zone drive, 15+ point swing, else "if it gets back within one score". Pregame: kickoff in this block, followed player big play, model lean + within one score in the fourth, within one score at the half/fourth by elapsed time.

## Files touched

New: `src/lib/playerlog.ts`, `src/lib/plan.ts`, `src/lib/plan-load.ts`, `src/components/PlayerGameLog.tsx`, `src/app/plan/page.tsx`, `scripts/playerlog-check.mts`, `scripts/plan-check.mts`, `scripts/plan-live-check.mts`.
Additive edits: `src/components/ProspectCard.tsx` (prop `lastPlay`), `src/app/game/[id]/page.tsx` (import, `lastPlays`, prop), `src/app/player/[id]/page.tsx` (log section), `src/app/layout.tsx` (nav icon + entry), `src/app/api/notify/route.ts` (type `plan`), `src/components/SendToTelegram.tsx` (type `plan`), `src/lib/digests.ts` (help line), `scripts/telegram-bot.mjs` (imports, state defaults, live loop, `/plan`).

## How to verify

- `npx tsc --noEmit` is clean except `scripts/og-check.mts` (another agent's `.tsx` import paths).
- `npx tsx scripts/playerlog-check.mts 401856705 4685578 5079471 5079698` prints Stockton, Heard, Robinson IV logs next to the ESPN box.
- `npx tsx scripts/plan-live-check.mts 20261003` builds the plan from the real ESPN scoreboard with no CFBD calls (follows TCU and Jaden Craig by default) and prints the now/next blocks and the Telegram text. Verified tonight: pick BYU-TCU at 9:30 PM with "Jaden Craig just had a play (2-yd run, 4th 14:58), fourth quarter, within one score (10-7), you follow TCU", trigger "Flip to ARST-UL now: win prob UL 60, ARST 40".
- `npx tsx scripts/plan-check.mts [date]` is the full path through `getSlate`, but **CollegeFootballData is returning 429 "Monthly call quota exceeded" tonight**, so it could not run against the live slate from a fresh process. The lead has been told. The running site may still serve from its fetch cache.
- `/plan` returns 404 on the PM2 production server until the orchestrator rebuilds (new route).
- Bot: `node --check scripts/telegram-bot.mjs` passes. After restart, log lines `[live:<name>]` and `[score:<gameId>]` show sends; `data/telegram-state.json` gains `liveCursor`, `liveSent`, `scoreSeen`, `scoreSent`.

## ESPN play text variants seen (2026-10-03, SEC, Big Ten, ACC, Big 12, AAC, FCS)

Stat-crew style everywhere, players as `#<jersey> <Initial>.<Last>`:
- Rush: `(14:14) Shotgun #28 S.Alexander rush middle for 7 yards gain to the UGA49 (#5 R.Wilson; #8 D.Jones), 1ST DOWN`. Loss: `rush left for 7 yards loss`. Tacklers in the trailing parens, `;` means assisted. Formation prefix optional (`Shotgun`, `No Huddle-Shotgun`, `No Huddle`, none).
- Completion: `#14 G.Stockton pass complete short left to #23 J.Reddell caught at UGA19, for 6 yards to the UGA26 (#11 B.Longwell)`.
- Incompletion: `pass incomplete short right thrown to UGA30`, with target `to #0 J.Sherrill`, optionally `broken up by #3 Q.Johnson`, `QB hurried by #55 J.Walker`.
- Sack: `#14 G.Stockton sacked for loss of 7 yards to the UGA01 (#8 C.Heard)`; may continue `, fumble by #9 H.Brown recovered by OSU #14 C.Alliegro at IOWA14, End Of Play`.
- Interception: `pass intercepted by #1 E.Robinson IV at UGA30 #1 E.Robinson IV return 0 yards to the UGA30 (#0 J.Sherrill)`; type is `Interception` or `Pass Interception Return`.
- Fumble: `fumbled by #2 D.Epps at ISU40 forced by #24 B.Miller recovered by ISU #3 S.Johnson at ISU41 #3 S.Johnson return 4 yards`.
- Touchdown: `... to the VAN00 TOUCHDOWN, clock 06:57 #91 P.Woodring kick attempt good (H: #14 G.Stockton, LS: #51 W.Snellings)`; two-point `#2 R.Vander Zee pass attempt Successful` / `rush attempt failed`.
- Kicks: `#91 P.Woodring kickoff 65 yards to the VAN00, Touchback`; `#42 J.Cassidy kickoff 65 yards to the ISU00 #0 C.Pettaway return 10 yards`; `#37 T.Ebel punt 25 yards to the UGA20`, `fair catch by #8 E.James`, `out of bounds at UGA45`; `field goal attempt from 39 yards GOOD (H: ..., LS: ...)`, `NO GOOD`, `NO GOOD blocked by #44 J.Hall`.
- Penalty: `PENALTY UGA Pass Interference (#1 E.Robinson IV) 15 yards from VAN25 to VAN40, 1ST DOWN. NO PLAY` (type Penalty, nullified, skipped). `declined` penalties keep the play. Penalty-enforced yardage: `rush middle for 24 yards gain (1) to the UGA22` where `(1)` is the yardage that counts (box agrees), normalized before parsing.
- Replay: `... CALL OVERTURNED. (Original Play: ... TOUCHDOWN ...)`. Only the ruling that stands is parsed.
- Narrative style on scoring plays before the detail lands and in `scoringPlays[]`: `Devin McCuin 15 Yd pass from Julian Sayin (Connor Hawkins Kick)`, `Philippe Laforge 20 Yd Field Goal`. Matched by full display name.
- Team-only actor: `Charlotte rush middle for 20 yards loss to the CLT09 fumbled by Charlotte` (never matches a player).
- Names: suffixes `Jr.`, `IV`, `III`, and `, Jr.`; multi-word last names `R.Vander Zee`; apostrophes `M.Ta'ase`; hyphens `K.Viliamu-Asa`, `S.White-Helton`. Leading `(mm:ss)` is the snap clock; `play.clock` is after the play. Timeouts, End Period, End of Game have no prefix.
- Plays carry `start.down/distance/downDistanceText`, `period.number`, `homeScore/awayScore` after the play, `scoringPlay`, `statYardage`, `teamParticipants` (offense/defense ids; flipped on kickoffs vs punts, so not used for roles). No `participants` with athlete ids, which is why name matching is needed.

## Known gaps

- NCAA counts sacks as rushing attempts, so a sacked QB's computed rushing line shows the negative yards (matches ESPN's box); the passing headline adds `sacked Nx`.
- Interceptions land under the defensive headline here while ESPN's box splits them into an `interceptions` category.
- Tackle attribution is name-based inside the trailing parens; a tackle on a two-point try or on a kick return by a player sharing jersey+initial+last with a teammate would be flagged ambiguous, not resolved.
- The plan assumes 3 h 30 min game windows; past blocks are the rules applied to what is known now, not a replay.
- Red zone is parsed from `downDistance` text against `possession`; when ESPN omits possession the rule stays off.
- Jev is not used yet; the obvious place is the ambiguous-name case (Noul: "is this play about player X at team Y") and ranking "worth flipping to right now" across live games.

## Ideas

- A "my players" live strip at the top of the slate: one line per followed player with his latest play and computed line, refreshed every minute.
- Pings with a 15-second video link: ESPN's play ids map to highlight clips for scoring plays; the Telegram message could carry the clip URL when one exists.
- Drive-level pings: "Manning's drive crossed midfield, 3rd and 4 at the OU 44" using `drives.current`, which is already in the summary.
- Postgame "his big plays" reel on the player page: the big plays list is already there, group by role and add the win-probability delta per play from `winprobability[]` to show which plays moved the game.
- Plan replay: snapshot the live inputs every block to `data/plan/<date>.json` so Sunday's view shows what the plan actually said at each half hour and how often the switch triggers fired.
- Use the computed line vs the box line as a self-check on the parser: a nightly script over every final could flag any player whose two lines disagree, which is the fastest way to catch a new ESPN text variant.
