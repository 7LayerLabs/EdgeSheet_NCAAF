# AGENT-REPORT-ops

Items 10 and 13: honest gating, prewarm and cache, robustness, deploy prep, README. Plus the quota resilience layer the orchestrator added after CFBD ran out.

## 0. CFBD quota resilience (added after the 429s started)

Verified live on the dev server at :3077 while the quota was exhausted: `/api/slate?date=2026-10-10` built 96 Saturday games from ESPN in 4.4 s, the flag tripped on the first 429, and the slate page shows the coverage note under "What this slate cannot say yet". Screenshot of the fallback slate in my scratchpad: ranks, records, logos, networks, DraftKings line, kickoff times all present.

**`src/lib/cfbd.ts` quota guard.** Every response through the client goes through `noteCfbdResponse(path, res)`. A 429 whose body says "Monthly call quota exceeded" sets a module-level flag for six hours or until the first of next month UTC, whichever is sooner (so a tier upgrade is picked up within six hours, no restart). While flagged, the client still calls `fetch` so Next fetch-cache hits keep serving, but a path that already 429'd while flagged throws `CfbdQuotaError` without touching the network. Exports: `cfbdQuotaExhausted()`, `cfbdQuotaStatus()` (for the UI and scripts, includes a per-endpoint call counter), `markCfbdQuotaExhausted()`, `noteCfbdResponse()`. The two raw fetchers outside the client (`src/lib/consensus.ts`, `src/lib/boxscore.ts`) now report into the same flag; boxscore skips its no-cache call entirely while flagged.

**`src/lib/espn-schedule.ts` ESPN as a schedule source.** `espnCalendar(season)` turns ESPN's league calendar into `CfbdWeek[]`. `espnWeek(season, week)` fetches the scoreboard for groups 80 and 81 one call per ET day (ESPN rejects date ranges; 14 calls per week, memoized 5 minutes) and returns `CfbdGame[]`, `CfbdLineRow[]` (one book, usually DraftKings, sign settled by the favorite flag), `CfbdMedia[]`, `CfbdTeam[]` (logo, color, abbreviation), `CfbdVenue[]` (name, city, state, indoor; no coordinates), `CfbdRecord[]` (from `records[type=total].summary`), and a `CfbdRankingWeek` built from `curatedRank` (AP Top 25 for group-80 teams, FCS Coaches Poll for the rest, which matches the existing poll regexes). FBS conference ids are mapped from ESPN's constants; FCS conference names are left null rather than guessed, except when the game is a conference game and ESPN names the conference on the competition. Nothing is invented: Elo, excitement index, opening lines, coordinates are null and the note says so.

**`src/lib/slate.ts` (additive).** `Bundle` gained `source` and `espn`. `loadWeek` returns `loadWeekFromEspn` when the flag is set or when the games call is the one that discovers the quota; CFBD teams and venues are merged in when the fetch cache still has them (coordinates and surfaces). `buildSlate` falls back to `espnCalendar` when the calendar call throws the quota error. The coverage note is pushed into `notes`. The game page's own fallback (serve from the built week when `games?id` fails, added by the gamepage agent) now benefits automatically because the week it reads is the ESPN one.

**Prewarm.** `/api/slate` now returns `cfbdQuota`. When exhausted, prewarm warms only `/`, `/radar`, `/draft`, `/history` and logs why; game pages, other days, and rankings are skipped.

**Follow-up from the orchestrator (crossed with the first pass).** Added `cfbdExhausted()` as the short alias, `derivedWeek(season, date)` in `espn-schedule.ts` (Monday-to-Sunday ET window around the date, used only when neither CFBD nor ESPN gives a calendar), and `scripts/espn-fallback-check.mts`, which forces the flag and builds today's slate through the fallback:

```
npx tsx scripts/espn-fallback-check.mts            # or with a YYYY-MM-DD
flag forced: true
ESPN calendar: 17 weeks (252ms)
week 5 regular 2026-09-28 to 2026-10-05
ESPN week bundle (536ms): 114 games, 5 with a line, 111 broadcast rows, 228 teams, 114 venues, 228 records, polls AP Top 25 x19
getSlate(2026-10-03) (5371ms): 108 games on 2026-10-03, 114 in the week
fallback note present: true
first game: Memphis 4-1 @ Charlotte 0-5, ESPN+, status final
```

Only 5 games carried a line because the Saturday was already final when it ran; ESPN drops odds after the game. Outside Next there is no fetch cache, so the run shows one probe per CFBD path (calendar, teams, venues, five ratings), each dead afterwards; inside the server those are cache hits.

**Telegram bot no longer builds the slate in-process (orchestrator follow-up).** `scripts/telegram-bot.mjs` now has `loadSlate(date)` and `loadGame(id)` that read the running site's `GET /api/slate?full=1` (new mode, returns the whole Slate with every Game) and the new `GET /api/game?id=` (`src/app/api/game/route.ts`, same 30 s memo as the game page). Every former `slateLib.getSlate(...)` and `slateLib.getGame(...)` call site (live loop, morning, tick, `/slate`, `/leans`, `/record`, `/radar`, `/game`, `/plan`) goes through them; `getPlan()` in `src/lib/plan-load.ts` takes an optional prebuilt slate so `/plan` does not rebuild either. The in-process build stays only as the fallback when the site does not answer, and it logs `[site] ... building in this process instead. This costs CFBD calls. Is pm2 "scout" up?` at most once a minute. The live loop was already ESPN-only (`espn.liveScoreboard` plus `playerlog`, which has no CFBD call); confirmed and the comment updated. Effect: the ~1,300 CFBD calls a day from the bot go to zero while the site is up.

Verified: `node --check` on the bot, `tsc` clean, and `npx tsx scripts/telegram-api-check.mts http://localhost:3080` (new, kept as a dry run) against a fresh dev server:

```
GET /api/slate?full=1 -> 200 in 5494ms; 111 games, 117 in week, CFBD quota exhausted true
morningSlate: 6313 chars (Top 5 by Scout Score rendered with ranks, times, networks)
leansDigest: 4083 chars
GET /api/game?id=401862787 -> 200 in 836ms; Memphis @ Charlotte, final, 7 prospects, 4 matchups
gameDigest: 2252 chars
```

That run was on the ESPN fallback (quota still exhausted) and the digests came out whole. The dev server on 3080 was stopped afterwards. Restart the bot (`pm2 restart scout-telegram`) once the site is rebuilt so it picks up the routes; until the site has `/api/slate`, the bot falls back in-process and says so.

### CFBD calls per Saturday, from reading the code

The site runs one Node process with the Next fetch cache, so each endpoint costs one call per revalidate window while anyone (or prewarm) keeps the slate warm. Estimates for a 16-hour active Saturday (9 AM to 1 AM):

| Caller | Endpoint | Window | Calls |
| --- | --- | --- | --- |
| slate | `/games` x2 (fbs, fcs) | 300 s | ~380 |
| slate | `/lines` | 600 s | ~100 |
| slate | `/records` | 2 h | 8 |
| slate | `/games/media`, `/rankings` | 6 h | 6 |
| slate | `/calendar`, `/teams`, `/venues` | 1 day+ | 3 |
| game page | `/games?id=` | 300 s per game | 1 per game view after 5 min; prewarm as specified (35 games every 10 min) adds ~3,300 |
| game page | `/games/players` (box score) x2 | 15 min memo | ~130 while finals are landing |
| game page | ratings (SP+, FPI, SRS, Elo, pregame WP) | 6 h | 20 |
| odds snapshot | 4 CFBD calls per run | every 4 h | 24 |
| **Telegram bot** | full slate rebuild, no fetch cache | its own 10-min throttle | **~1,300 per day, every day of the week** |

So: about 650 for the site on a Saturday without game-page prewarm, about 4,000 with it as specified, plus about 1,300 a day for the bot seven days a week, plus one full ingest per `npm run build` (prebuild; hundreds of calls, I did not count it). The bot is almost certainly what emptied the quota: it rebuilds the slate from scratch in its own process with no fetch cache, roughly 9,000 calls a week while the site itself needs maybe 1,500.

What Derek should buy: after the two fixes below, a normal week is about 1,500 site calls plus ingest, call it 8,000 to 10,000 a month with headroom. The free tier is nowhere near that. The first paid Patreon tier is the right one; check the current limits at collegefootballdata.com/key before paying since they change. Do not pay for a tier sized to the bot as it is today.

Two code fixes worth more than any tier:
1. The Telegram bot should read `/api/slate` (and a `/api/game/<id>` if one is added) from the running site instead of importing `getSlate` and rebuilding with its own CFBD calls. That removes ~1,300 calls a day.
2. Prewarm game pages only for live games and kickoffs inside 2 hours, on the 10-minute Saturday cadence that is about 15 games per tick instead of 35, and let the `/games?id=` window go to 600 s on game days since ESPN carries the live score anyway. That cuts the Saturday game-page cost from ~3,300 to under 1,000.

## First, the thing that matters tonight

**The CFBD monthly call quota is exhausted.** A direct call with the key in `.env.local` returns `429 {"message":"Monthly call quota exceeded."}`. On the running PM2 server, about 70 of today's 108 game links render as Next's "page could not be found" inside a streamed HTTP 200, because `getGame()` swallows the 429 and the page calls `notFound()`. Only games already in the Next fetch cache render. `npm run build` runs ingest through `prebuild`, so the orchestrator's build will hit this too. Sent to team-lead the moment I confirmed it. Both of my scripts now flag that render explicitly (a game page without the `id="why"` jump bar is reported as "rendered as not found").

## What I built

### 1. Honest gating
- `src/lib/gate.ts`: `gated(n, min, value)` returns the value or `{ tooEarly: true, n, min }`. Minimums live here: `RATE_MIN` 20, `BUCKET_MIN` 10, `LEDGER_MIN` 10, `GAME_RATIO_MIN` 3. `gatedText()` for Telegram or logs.
- `src/components/Gated.tsx`: renders "too early (n of min)" in muted text, nowrap, with a title tooltip.
- `/history`: all eight rate tiles go through the gate at 20 graded. Counts stay in the subline. The Scout Score bucket chart is hidden under 10 graded (a one-line note says when it appears), and inside the chart a bucket under 3 games shows its count with no bar. Edges and radar badges on graded rows render only when something was graded (no more `0/0`).
- `src/components/Ledger.tsx`: simulated units, moderate units, and CLV average gate at 10 legs; ROI and the side/total CLV split are also withheld under 10; tone colors only once the gate is passed. "Leans graded" count always shows.
- Consensus tile is one of the eight gated tiles.
- Game page "Did it play out" tiles already show counts, not ratios ("3 of 4"), so there was nothing to hide there. Left untouched; `GAME_RATIO_MIN` is exported for whoever adds a per-game percentage later.
- `/backtest` untouched, as asked.

### 2. Prewarm and cache
- `scripts/prewarm.mjs`: hits `/api/slate` (new, below), `/` for today, `/?date=` for the week's other slate days, `/radar`, `/draft`, `/rankings`, `/history`, `/sheet` (optional), then `/game/<id>` for every FBS/FCS game live or kicking off within 6 hours, live first. Sequential, 400 ms pause, 90 s timeout per request, timings logged per URL, summary with the three slowest, last run written to `data/prewarm-last.json`. `--scheduled` makes it obey the ET schedule (PM2 fires every 10 minutes; the script runs every tick Saturday 9 AM to Sunday 1 AM ET and only on the :00/:30 ticks otherwise). Builds older than `/api/slate` fall back to the game and day links on the slate page.
- `src/app/api/slate/route.ts`: slim JSON of the slate (ids, kickoffs, statuses, divisions, days). Hitting it warms the slate memo. `no-store`.
- `src/lib/cache-policy.ts` plus a two-line change in `src/lib/memo.ts`: `memo()` now accepts a TTL function of the resolved value. The slate memo in `slate.ts` is 60 s when any game is live or kicks off inside two hours, 120 s otherwise. The `Cache-Control: s-maxage` strategy for a future CDN is written in the header comment of `cache-policy.ts` (and why not to add those headers before a CDN exists).

### 3. Robustness
- `scripts/healthcheck.mjs`: GET `/`, `/radar`, `/history`, one Division I game page (live first, else nearest kickoff, from `/api/slate` or the first slate link on older builds), and `/api/notify` for Telegram readiness as the server sees it. Fails on non-200, missing site shell, the error boundary, or a game page rendered as not-found. Exit 1 with the list of problems. `--notify` sends one Telegram message through `src/lib/telegram.ts` (loaded with tsx), at most hourly while failing, plus one "back up" message on recovery. State in `data/healthcheck-state.json`. Sending does not conflict with the bot; only long polling does.
- `src/app/error.tsx` and `src/app/game/[id]/error.tsx`: light-theme boundaries with "Try again" (calls `reset()`) and "Back to the slate". Layout, nav, and tab bar survive.
- Both scripts use `process.exitCode` instead of `process.exit`; on Windows, exiting with fetch handles open trips a libuv assertion (seen on the first run).

### 4. Deploy prep (nothing deployed)
- `deploy/agentbox.md`: box setup (Node 22, Chromium for `src/lib/render.ts`, timezone), rsync or git, secrets with `PUBLIC_BASE_URL=http://100.68.230.36:3000`, first deploy, PM2 table and exact commands, the data that must persist, backups, routine deploys, checks, known gaps. One-poller rule stated three times on purpose.
- `deploy/agentbox-deploy.sh`: pull or rsync mode, `npm ci`, env check and `PUBLIC_BASE_URL` write, create data dirs (never delete), `npm run ingest`, `npm run ingest:plays`, `npx next build` (direct, so `prebuild` does not run ingest twice), start-or-restart for `scout`, `scout-telegram`, `scout-odds`, `scout-prewarm`, `scout-health`, `pm2 save`, wait for :3000, healthcheck, first prewarm. `SKIP_INGEST=1` for code-only deploys.
- `deploy/vercel.md`: why not today (file-based writes, Chrome via `execFile`, long polling bot and PM2 crons, in-process memo, CFBD quota multiplied by functions) and the six changes that would make it fit, in order of payoff.

### 5. README
Top rewritten: what the product is in one screen, the pages, the run steps, the key table, the scripts table (every npm script, one line, plus the node-only scripts), the PM2 table and commands, the persist list. Removed the create-next-app boilerplate. Kept the existing Consensus, Telegram, and AI layer sections untouched.

## PM2 commands (not started by me)

```bash
cd web
pm2 start scripts/prewarm.mjs --name scout-prewarm --time --cron "*/10 * * * *" --no-autorestart -- --scheduled
pm2 start scripts/healthcheck.mjs --name scout-health --time --cron "*/15 * * * *" --no-autorestart -- --notify
pm2 save
```

PM2 cron runs in the machine's local time. The prewarm script converts to ET itself, so the schedule is right on any box.

## Measurements

Running PM2 server on :3000 (production build, before my code; it has no `/api/slate`, so prewarm used the slate-page fallback):

| Page | Cold (before prewarm) | After prewarm |
| --- | --- | --- |
| `/` | 2110 ms | 387 ms |
| `/radar` | 140 ms | 170 ms |
| `/history` | 130 ms | 121 ms |

Prewarm on :3000: 120 requests in 87.9 s, 0 HTTP failures; slowest `/game/401868173` 5033 ms, `/?date=2026-10-10` 3932 ms. Most game pages answered in 40 to 70 ms because they were the not-found render (quota), which the script now counts separately.

Dev server on :3077 (another agent's, same tree, so it has `/api/slate`): prewarm 44 requests in 70.2 s, 0 failed; `/api/slate` 7105 ms cold, `/draft` 17431 ms cold (dev compile), `/history` 397 ms. Healthcheck: 6 of 6 passed, game page picked was Georgia Southern @ Coastal Carolina (live).

The 60 to 120 s memo change cannot be measured on the running server until the orchestrator rebuilds; it halves slate rebuilds on quiet days and changes nothing on Saturdays.

## Verification
- `npx tsc --noEmit`: my files are clean. Remaining errors are other agents' in-progress files (`src/lib/watchguide.ts`, `src/lib/plan.ts`, `src/lib/playerlog.ts`, `scripts/og-check.mts`).
- Screenshot of `/history` (dev server on :3077) in my scratchpad: tiles show "too early (4 of 20)", the bucket chart is replaced by the one-line note, graded rows show no `0/0` edges badge.
- I could not start my own dev server on :3080: Next refuses a second dev server on the same tree while :3077 is running. Nothing to stop.
- `data/healthcheck-state.json` and `data/prewarm-last.json` were written by the runs; both are harmless and excluded in the deploy rsync.

## Files touched
New: `src/lib/gate.ts`, `src/components/Gated.tsx`, `src/lib/cache-policy.ts`, `src/lib/espn-schedule.ts`, `src/app/api/slate/route.ts`, `src/app/error.tsx`, `src/app/game/[id]/error.tsx`, `scripts/prewarm.mjs`, `scripts/healthcheck.mjs`, `deploy/agentbox.md`, `deploy/agentbox-deploy.sh`, `deploy/vercel.md`.
Edited (additive): `src/lib/cfbd.ts` (quota guard around the client), `src/lib/consensus.ts` and `src/lib/boxscore.ts` (report 429s into the shared flag), `src/lib/memo.ts` (TTL function), `src/lib/slate.ts` (imports, Bundle fields, `loadWeekFromEspn`, quota branch in `loadWeek`, calendar fallback, one note line, TTL line), `src/app/history/page.tsx` (imports, tile values, bucket gate, badges, Tile type), `src/components/Ledger.tsx` (imports, tile values, Tile type), `README.md` (top replaced, feature sections kept).

## Known gaps
- The quota. Until it resets or the key changes, game pages for anything not in the fetch cache are not-found renders. Consider a second CFBD key for ingest only, or Patreon tier.
- Healthcheck "ok" on `/api/slate` for an old build means "fell back to the slate page", which is fine but reads oddly in the log.
- `deploy/agentbox-deploy.sh` is untested on a real Ubuntu box; the Chromium package name differs between Ubuntu releases (apt vs snap), the doc covers both.
- `prebuild` still runs ingest on every `npm run build`. The deploy script sidesteps it; the clean fix is removing the hook.

## Ideas
- `/` is 4.5 MB of HTML. The slate page embeds the full week in the RSC payload. Splitting the week's other days into a lazy fetch would cut first paint on a phone more than any cache change.
- A `429` from CFBD should render a "data source rate-limited, showing what we have" card, not a not-found page. `getGame()` could return the archive entry alone when the live fetch fails, since every locked game has a pregame file on disk. That alone makes the Record page useful on a quota-exhausted day.
- Count CFBD calls per day in `cfbd.ts` the way `odds-core` counts credits, and show it on `/history` or a `/ops` page, so quota exhaustion is seen a week early instead of on a Saturday.
- The healthcheck could post a one-line "Saturday morning green" at 8 AM so silence on a game day is known to mean healthy, not dead.
- Prewarm could skip game pages on the quiet schedule entirely and only warm them inside the Saturday window; today it warms only live or next-6-hour games, which is already small on weekdays.
- With a `/api/slate` that exists, the Telegram bot could stop importing the whole library through tsx and just read JSON from the running server, which would also remove the duplicate CFBD calls the bot makes on its own.
