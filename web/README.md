# EdgeSheet

College football, seen the way an NFL scout sees it. Pick any Division I game and the page tells you why it is worth watching, which players the league is looking at and in what draft class, how the two teams actually play, what the model projects against the number, and, after the final, whether any of that played out.

The rule that runs the whole thing: no invented facts. Every player, stat, line, and quote on a page comes from a source row (CollegeFootballData, ESPN, the National Weather Service, The Odds API). When the data is missing the page says "not available" instead of guessing. Hit rates stay hidden as "too early" until there are enough graded games to mean something.

What is on the site:

- **Slate** (`/`): today's games, Top 25 first, each with a Scout Score, the pressure point, and the model lean. Switch days inside the week.
- **Game** (`/game/<id>`): why watch, where it gets decided, draft radar, who to keep an eye on, live feed or box score, team style, conditions, market and line movement, storylines, and the graded call once it is final.
- **Radar** (`/radar`), **Player** (`/player/<id>`): production-based scouting scores by position and draft class, with the week-to-week movement.
- **Draft** (`/draft`): the 2027 forecast, supply versus demand by position, declared and returning.
- **Top 25** (`/rankings`), **Watchlist**, **My board**, **Feed**, **Ask**, **Backtest**, **Record** (`/history`): the archive of every locked call and how it graded, plus the ledger and the model tuner.
- **Telegram**: morning slate, leans, kickoff reminders, grades, and the Saturday sheet as a photo. Commands answered by the bot.

Everything new is Division I (FBS and FCS). Lower divisions keep the basic page.

## Run it

```bash
cd web
# create .env.local with at least CFBD_API_KEY=... (see the key table below)
npm install
npm run ingest               # rosters, season stats, drafts from CFBD (minutes; sequential, rate-limited)
npm run ingest:plays         # play-by-play situations (optional, minutes)
npm run dev                  # http://localhost:3000
```

Keys in `.env.local` (all optional except the first; the UI says which one is missing when a feature is off):

| Key | Turns on |
| --- | --- |
| `CFBD_API_KEY` | everything; without it the site shows a hand-written sample slate |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram delivery and the Send buttons |
| `ODDS_API_KEY` | line movement, closing lines, props, CLV in the ledger |
| `ANTHROPIC_API_KEY` | written reports and Ask |
| `TYPESAFE_API_KEY` | Jev judgments (feed classification, watch ranking) |
| `PUBLIC_BASE_URL` | what Telegram links point at (default `http://localhost:3000`) |
| `CHROME_PATH` | the browser used to render the Saturday sheet PNG, if Chrome is not in the usual place |

Production is `npm run build` then `npm run start` under PM2; see `deploy/agentbox.md` for the always-on box and `deploy/vercel.md` for why Vercel is not the target today. Type-check with `npx tsc --noEmit`.

## Scripts

| `npm run ...` | What it does |
| --- | --- |
| `dev` | Next dev server on :3000 |
| `build` | production build. `prebuild` runs `ingest` first, so a build is also a data refresh |
| `start` | production server (`next start`) |
| `lint` | eslint |
| `ingest` | CFBD rosters, season stats, usage, recruiting, advanced team stats, five drafts, into `data/generated/` |
| `ingest:plays` | play-by-play per game for situational splits and cues |
| `ingest:gamelogs` | per-player game logs behind the player pages |
| `ingest:portal` | transfer portal entries |
| `ingest:stadiums` | venue coordinates and surfaces for weather |
| `ingest:climate` | five-year weather baselines per venue and week |
| `snapshot` | weekly radar and forecast snapshot into `data/snapshots/<date>/`; feeds "who moved" |
| `tune` | replays the graded archive against the formulas; changes a weight only with 50+ games and a bootstrap-stable gain |
| `guides` | writes the fan-voice watch guides for the slate |
| `odds:snapshot` | one Odds API pull for this week's Division I games (3 credits); `--dry` costs nothing |
| `sheet:render` | renders the Saturday sheet PNG with headless Chrome, no send |
| `sheet:send` | renders and sends the sheet to Telegram as a photo |
| `telegram:bot` | the long-polling bot (run under PM2, one instance per token) |
| `telegram:preview` | prints every digest to the console, no token needed |
| `telegram:chat-id` | prints the chat ids the bot has seen, for `TELEGRAM_CHAT_ID` |

Not wired to npm (run with `node` or `npx tsx`): `scripts/prewarm.mjs` (warms the pages before a visitor does), `scripts/healthcheck.mjs` (curls the site and Telegram readiness, exits non-zero with a reason), `scripts/write-reports.mjs` (AI reports, on purpose, never on page load), `scripts/backtest.mjs`, and the `*-check.mts` one-offs for debugging a single game or feed.

## PM2 processes

| Name | Script | Schedule |
| --- | --- | --- |
| `scout` | `next start -p 3000` | always on |
| `scout-telegram` | `scripts/telegram-bot.mjs` | always on; its own ET schedule inside |
| `scout-odds` | `scripts/odds-snapshot.mjs` | `0 */4 * * 3,4,5,6` (every 4 hours, Wed to Sat) |
| `scout-prewarm` | `scripts/prewarm.mjs --scheduled` | `*/10 * * * *`; runs every tick Sat 9 AM to 1 AM ET, :00 and :30 otherwise |
| `scout-health` | `scripts/healthcheck.mjs --notify` | `*/15 * * * *`; Telegram message only on failure (hourly at most) and once on recovery |

```bash
cd web
pm2 start node_modules/next/dist/bin/next --name scout --time -- start -p 3000
pm2 start scripts/telegram-bot.mjs --name scout-telegram --time
pm2 start scripts/odds-snapshot.mjs --name scout-odds --time --cron "0 */4 * * 3,4,5,6" --no-autorestart
pm2 start scripts/prewarm.mjs --name scout-prewarm --time --cron "*/10 * * * *" --no-autorestart -- --scheduled
pm2 start scripts/healthcheck.mjs --name scout-health --time --cron "*/15 * * * *" --no-autorestart -- --notify
pm2 save
```

Only one machine may run `scout-telegram` for a given bot token (Telegram allows one poller), and only one should run `scout-odds` (one credit budget).

## Data that must survive a deploy

`data/archive`, `data/odds`, `data/ai`, `data/snapshots`, `data/sheets`, `data/declarations.json`, `data/grades.json`, `data/follows.json`, `data/telegram-state.json`. `data/generated` and `data/cache` are rebuilt by ingest.

## Consensus of projection systems

The game page shows the EdgeSheet projection as the headline, then an "Other systems" table under it. Those rows are not ours. They are rating systems published through CollegeFootballData (free tier): SP+ (Bill Connelly), FPI (ESPN), SRS (Simple Rating System), Elo, and CFBD's own pregame spread and win probability (`/ratings/sp`, `/ratings/fpi`, `/ratings/srs`, `/ratings/elo`, `/metrics/wp/pregame`). Each rating difference becomes a projected margin with 2.5 points of home field (Elo uses the same 65 Elo points and 28 Elo per point as the model), and win probability uses the same 16-point normal. The consensus is the median margin across whatever systems have a number, plus a count of how many lean each side of the posted spread (inside half a point counts as "on the number"). SP+, FPI, and Elo tables are FBS only, so FCS games usually get SRS and CFBD pregame only. The consensus median and side are locked pregame and graded on the Record page ("Consensus vs number"). Code: `src/lib/consensus.ts`, `src/components/ConsensusTable.tsx`; check one game with `npx tsx scripts/consensus-check.mts <gameId>`.

## Telegram delivery

EdgeSheet can push the morning slate, model leans, kickoff reminders for followed teams, postgame grades, and radar alerts to a Telegram chat, and answer simple commands. Nothing runs until two keys are in `web/.env.local`.

### Setup (five minutes)

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username. Copy the token.
2. Add to `web/.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   PUBLIC_BASE_URL=http://localhost:3000
   ```
   `PUBLIC_BASE_URL` is what the links in messages point at. Leave it as localhost, or set it to a Tailscale or public URL so links open from your phone.
3. Open your new bot in Telegram and send it any message (for example `hi`). This is how Telegram learns which chat to deliver to.
4. Run `npm run telegram:chat-id`. It prints the chat ids the bot has seen. Add the one for your chat:
   ```
   TELEGRAM_CHAT_ID=123456789
   ```
   Private chats are positive numbers, groups are negative.
5. Start the bot under PM2 from the `web/` folder:
   ```
   pm2 start scripts/telegram-bot.mjs --name scout-telegram --time
   pm2 save
   ```
   Then restart the web app so the "Send to Telegram" buttons appear (they are hidden when the keys are missing).

Dry run with no token: `npm run telegram:preview` prints every digest to the console.

### What it sends

| When | What |
| --- | --- |
| 8:00 AM ET on any day with Division I games | Morning slate: top 5 by Scout Score, Hidden Gems, strong and moderate model leans (capped at 5 per group, `/leans` for all) |
| Every 15 min while games are in a window | Kickoff reminders for followed teams and watched games with a kickoff in the next 60 minutes |
| Monday 7:00 AM ET (after the 6:30 AM snapshot) | Stock report: radar risers, fallers, forecast-board moves |
| Every 10 min while games are live or recently final, hourly otherwise | Postgame grades for every newly graded game, plus radar alerts when a followed player posts a "showed up" line |

Commands: `/slate [YYYY-MM-DD]`, `/leans`, `/record`, `/radar <team>`, `/game <team>`, `/plan`, `/stock`, `/help`. The bot only answers the chat in `TELEGRAM_CHAT_ID`.

Every lean is labeled "model, not a pick". Thresholds live in `src/lib/digests.ts` (`LEAN_THRESHOLDS`).

### How follows reach the bot

The watchlist lives in the browser (localStorage). Every toggle also POSTs the full list to `/api/follows`, which writes `data/follows.json`. The bot reads that file. If you follow a team on a device that has never hit the site since this was added, toggle any follow once to sync.

### Files

- `src/lib/telegram.ts`: Bot API client (send with HTML, split at 4096 chars, retry once, long polling).
- `src/lib/digests.ts`: message builders, pure functions over app data, reusable for Discord.
- `src/lib/follows.ts`, `src/app/api/follows/route.ts`: server-side follows mirror.
- `src/app/api/notify/route.ts`: `POST {type: "slate" | "leans" | "grades"}` sends on demand.
- `src/components/SendToTelegram.tsx`: the buttons on the slate header and the Record page.
- `scripts/telegram-bot.mjs`: the PM2 process. `scripts/telegram-chat-id.mjs`: finds your chat id. `scripts/telegram-preview.mjs`: dry run.
- `data/telegram-state.json`: grades cursor, reminders sent, radar alerts sent, last update id. Delete it to reset.

## AI layer (written reports and Ask the slate)

The model never sees the internet and never adds a fact. It explains and ranks evidence the app already computed.

- Provider: `src/lib/llm.ts`. Anthropic (`claude-opus-5`) when `ANTHROPIC_API_KEY` is set, otherwise OpenAI (`gpt-5.4` for reports, `gpt-5.4-mini` for Ask) when `OPENAI_API_KEY` is set, otherwise the UI says which key to add. Keys are read from `.env.local`, then `~/scripts/.env`. Every call is logged to `data/ai/usage.jsonl` with tokens and an estimated cost.
- Written report: `src/lib/report.ts` builds an evidence packet (every fact has an id), asks for a structured report, then checks every name and number in the output against the packet. One retry with the violations listed; a second failure is recorded and not published. Cached at `data/ai/reports/<season>/<gameId>.json` with the evidence version. `GET /api/report?id=<gameId>` returns the packet so a report can be audited.
- Ask: `/ask` runs a tool loop over our own functions (slate, game packet, radar board, draft forecast, record). The tool calls are shown under every answer.

Budget: a report is about 7,000 input and 1,300 output tokens per attempt, roughly 3 to 6 cents on gpt-5.4 or claude-opus-5 (two attempts at most). An Ask question is 1 to 3 cents on gpt-5.4-mini. Reports are never generated on page load. Write them on purpose:

```bash
node scripts/write-reports.mjs --dry          # list today's locked Division I games
node scripts/write-reports.mjs --limit 10     # write the top 10 by Scout Score (needs the server running)
node scripts/write-reports.mjs --ids 401858249 --force
npx tsx scripts/test-report-validation.ts     # offline check of the validator, no key needed
```
