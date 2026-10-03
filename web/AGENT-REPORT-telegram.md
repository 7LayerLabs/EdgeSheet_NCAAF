# Agent report: Telegram delivery

## What was built

Push delivery of the morning slate, model leans, kickoff reminders for followed teams, postgame grades, and radar alerts to a Telegram chat, plus a command bot. Everything degrades cleanly with no keys: buttons hide, the API route answers 503 with the missing key named, the bot process waits and re-reads `.env.local` every 5 minutes instead of crash-looping.

Verified with `npx tsc --noEmit` (clean) and by running every digest builder through `tsx` against today's live slate (298 games, 111 Division I) with no token set. Grade lines and radar alerts were checked with a synthetic graded entry because nothing in the archive is graded yet.

## Setup for Derek

1. Telegram: open @BotFather, `/newbot`, copy the token.
2. `web/.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   PUBLIC_BASE_URL=http://localhost:3000
   ```
   Set `PUBLIC_BASE_URL` to a Tailscale or public URL if you want message links to open from your phone.
3. Open the bot in Telegram, send it any message (this is how it learns your chat id).
4. `npm run telegram:chat-id` prints every chat id it has seen. Add yours:
   ```
   TELEGRAM_CHAT_ID=123456789
   ```
5. Start the bot (from `web/`):
   ```
   pm2 start scripts/telegram-bot.mjs --name scout-telegram --time
   pm2 save
   ```
   Restart the `scout` web process once so the "Send to Telegram" buttons appear.

Dry run any time, no token needed: `npm run telegram:preview` (or `npm run telegram:preview -- 2026-10-10`).

If the bot is running and you message it before the chat id is set, it replies with your chat id and the line to add. Only one process may poll a bot at a time, so stop `scout-telegram` before running the chat-id script if the bot is already up.

## Schedule (Eastern)

| Cadence | Job |
| --- | --- |
| 8:00 AM, days with Division I games | Morning slate: top 5 by Scout Score with kickoff, network, one-line why; Hidden Gems; strong and moderate leans capped at 5 per group with a "plus N more" line |
| Every 15 min while a Division I game kicked off in the last 6 h or kicks off in the next 2 h | Kickoff reminders for followed teams and watched games with kickoff in the next 60 min. Once per game. |
| Every 10 min while a Division I game is live or went final within 6 h, hourly otherwise | Postgame grades for every game graded since the cursor; radar alerts for followed players with a "showed up" verdict |

Commands via long polling: `/slate [YYYY-MM-DD]`, `/leans`, `/record`, `/radar <team>`, `/game <team>`, `/help`. Replies only go to the chat in `TELEGRAM_CHAT_ID`.

## Files

New:
- `src/lib/telegram.ts`: Bot API client. `sendMessage(text, {parseMode: "HTML"})`, splits at 4096 on line boundaries, retries once (network, 5xx, short 429), `escapeHtml`, `getUpdates`, `getMe`, `telegramReady`, `telegramMissing`.
- `src/lib/digests.ts`: pure message builders over app data. `morningSlate`, `leansSection`/`leansDigest`/`modelLeans`, `upcomingForFollows`/`kickoffReminder`, `newlyGraded`/`postgameDigest`/`gradeLine`, `radarAlerts`/`radarAlertDigest`, `recordDigest`, `gameDigest`, `teamRadarDigest`, `findTeamGames`/`resolveSchool`, `helpDigest`. `LEAN_THRESHOLDS` (side 4 strong / 2 moderate, total 5 strong / 2.5 moderate). Base URL from `PUBLIC_BASE_URL`, default localhost:3000.
- `src/lib/follows.ts`: reads and writes `data/follows.json` ({teams, players, games, updatedAt}).
- `src/app/api/follows/route.ts`: POST mirrors the browser watchlist to the file. GET returns it.
- `src/app/api/notify/route.ts`: POST `{type: "slate" | "leans" | "grades", date?}` sends on demand. GET reports readiness.
- `src/components/SendToTelegram.tsx`: client button, returns null when `enabled` is false.
- `scripts/telegram-bot.mjs`: PM2 process. `scripts/telegram-chat-id.mjs`: chat id finder. `scripts/telegram-preview.mjs`: dry run.

Touched (additive only):
- `src/lib/watchlist.ts`: fire-and-forget POST to `/api/follows` after each toggle.
- `src/app/page.tsx`: two buttons under the game count in the header (live slates only).
- `src/app/history/page.tsx`: one button next to the title.
- `package.json`: `tsx` devDependency; `telegram:bot`, `telegram:preview`, `telegram:chat-id` scripts.
- `README.md`: "Telegram delivery" section. `.env.local.example`: the three new keys.

Runtime data: `data/follows.json`, `data/telegram-state.json` (grades cursor, reminders sent, radar alerts sent, last Telegram update id). Delete the state file to reset. On first run the grades cursor is set to "now" so the archive is not replayed.

## Running TypeScript outside Next

The libs run under `tsx` with both the ESM and CJS hooks registered (`tsx/esm/api` and `tsx/cjs/api`). The CJS hook is required: `package.json` has no `"type": "module"`, so the `.ts` files load as CommonJS and the ESM-only hook alone fails on `./archive`. Verified: `fetch(..., {next: {revalidate}})` is ignored by Node's fetch, `@/data/prospects.json` resolves through tsconfig paths, `process.cwd()` is forced to `web/` so `data/` paths resolve.

Cold `getSlate()` in the bot takes about 70 s (CFBD plus NWS for 111 venues). It is memoized 60 s inside the lib, and the bot only calls it on the 10 and 15 minute marks, so CFBD load is about six slate builds an hour during game windows.

## Known gaps

- Postgame grading happens inside `getSlate()` for today's games only. A game that goes final after midnight ET is graded the next time its game page or the next day's slate is built; the bot's hourly check will pick it up once it is in the archive.
- Kickoff reminders depend on `data/follows.json`. Follows made before this change are not there until the user toggles any follow once.
- `/radar <team>` and `/game <team>` match against this week's slate first, then ingested roster school names. Nicknames ("Bama") do not resolve.
- Telegram limits bots to about 20 messages per minute per chat. Nothing here comes close, but a 100-game slate day with many followed teams could stack reminders. They are batched into one message per 15-minute tick.
- `data/telegram-state.json` is written by the bot process only; the notify route does not move the grades cursor, so an on-demand "Send grades" can repeat games the bot already sent.

## Findings worth a look (not in my scope)

From today's live slate, `modelLeans` flagged 17 strong side leans and 22 strong total leans out of about 60 Division I games with lines. Two patterns:

1. Totals skew: 25 over leans against 4 under. The model total (EPA per play times pace) runs well above the market: Purdue at Illinois 78 vs 62.5, Bowling Green at Miami (OH) 60 vs 42.5. Likely the pace term (plays per game) or the average points-per-game base is high, or the model is not regressing toward the market. The backtest agent should check calibration before this is trusted.
2. Side leans are almost all on big underdogs: USU +19.5, RUTG +24.5, UTEP +23, WYO +17. Elo at 28 points per spread point compresses large margins relative to the market. Shrinking the model margin toward the market, or widening the strong threshold for lines over 14, would quiet this.

The digest reports the over/under skew count on every leans message so the bias is visible.

## Ideas

- Discord next: `digests.ts` already returns HTML with only `<b>`, `<i>`, `<a>`, `<code>`. A 20-line `discord.ts` can convert to Markdown (`**`, `*`, `[text](url)`) and post to a webhook; the bot script gets a second `push` target.
- "Why this lean" expansion: on `/game`, include the projection basis lines (Elo numbers, unit edge net) so Derek can see what moved the model.
- Live score pings for followed teams once the ESPN agent lands a live feed: one message per scoring change, throttled to one per 5 minutes per game.
- Weekly recap on Sunday night: `recordDigest` for the week plus the three biggest misses and hits by margin error.
- A `/follow <team>` and `/unfollow <team>` command so follows can be managed from the phone and written straight to `data/follows.json`.
- Quiet hours: suppress hourly grade checks between midnight and 7 AM ET unless a game is live (Hawaii late kicks).
