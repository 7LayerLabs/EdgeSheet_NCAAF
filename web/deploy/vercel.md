# Why EdgeSheet is not on Vercel (yet)

Short version: the app is built like a program that runs on one machine with a disk, not like a website that runs on many short-lived functions. Vercel is the second kind of place. Moving there today would break the product's memory, its Saturday sheet, and its Telegram bot, and it would cost money to fix things that are free on agentbox.

## What would break, specifically

**1. File-based data is the product.**
Every locked call, every grade, every odds snapshot, every follow, every written report lives in `web/data/` as JSON on disk. `src/lib/archive.ts` writes `data/archive/<season>/<gameId>.json` the first time a page renders an upcoming game, and `gradePostgame` writes to the same file after the final. On Vercel each request runs in a function with a read-only deploy bundle and a throw-away `/tmp`. The write would either fail or vanish when the function ends. The Record page, the Ledger, the tuner, the draft declarations, the follows that drive Telegram reminders: all of it depends on those writes landing somewhere permanent.

Files involved: `src/lib/archive.ts`, `src/lib/declarations.ts`, `src/lib/follows.ts`, `src/lib/grades.ts`, `src/lib/odds.ts` and `src/lib/odds-core.mjs`, `src/lib/report.ts` (`data/ai/reports`), `src/lib/snapshot.ts` and `movement.ts` (`data/snapshots`), `src/lib/generated.ts` (`data/generated`, read-only so that one is fine).

**2. Headless Chrome.**
`src/lib/render.ts` shells out to a real Chrome binary with `child_process.execFile` to render the Saturday sheet PNG that Telegram sends as a photo. There is no Chrome in a Vercel function and no `execFile` of a 300 MB browser inside a 250 MB bundle limit. The usual fix (`@sparticuz/chromium` plus `puppeteer-core`) works but is slow to cold-start, bumps against the function size limit, and is a different code path than the one that runs on the PC and on agentbox.

**3. Long-running processes.**
`scripts/telegram-bot.mjs` long-polls Telegram forever and keeps a cursor in `data/telegram-state.json`. `scripts/odds-snapshot.mjs`, `prewarm.mjs`, `healthcheck.mjs`, `snapshot.mjs`, and `tune.mjs` are PM2 cron jobs. Vercel has no PM2. Vercel Cron can hit an HTTP route on a schedule, but a route cannot long-poll Telegram (it would need a webhook instead), and Hobby-tier cron fires at most once a day with no sub-hour schedules, so the 10-minute prewarm and 15-minute healthcheck would need Pro.

**4. In-process memo.**
`src/lib/memo.ts` caches the built slate in the Node process so 300 games are not rebuilt on every click. On Vercel there is no shared process; every cold function rebuilds the slate from CFBD, which means more CFBD calls against a free-tier key that already returns 429 when pushed, and a 2 to 4 second first paint on every cold hit. The 2 MB fetch-cache ceiling that memo exists to work around is also a Vercel-specific constraint, so the problem compounds.

**5. The CFBD key budget.**
One always-on process makes one set of calls per cache window. Many functions on many regions make many. The free tier would get rate-limited on a Saturday afternoon, exactly when the site matters.

## What would have to change

In order of how much they move the needle:

1. **Move the writes to a database.** Postgres (Neon, Supabase) or SQLite on Turso. Tables: `archive_entries`, `odds_snapshots`, `declarations`, `follows`, `grades`, `reports`, `radar_snapshots`, `telegram_state`. The read side of `archive.ts` and friends already returns plain objects, so the swap is mostly in the few `readFileSync` / `writeFileSync` call sites. Two or three days of careful work, plus a one-time import of `data/`.
2. **Replace the memo with a shared cache.** Vercel KV or Upstash Redis keyed the same way (`slate:<date>`, `game:<id>`) with the same TTL rule from `src/lib/cache-policy.ts`. Or go the other way and precompute the slate on a schedule into the database, so pages only read.
3. **Telegram as a webhook.** `setWebhook` to `/api/telegram`, parse updates there, keep the cursor in the database. The scheduled digests (8 AM slate, grades, reminders) become Vercel Cron routes. Needs Pro for anything under hourly.
4. **The sheet PNG.** Either `@sparticuz/chromium` in a dedicated function with a longer timeout, or render the sheet as an SVG or a Satori/`next/og` image route, which needs no browser at all and is the better answer long term.
5. **CFBD call discipline.** With a database-backed slate built once per window by a cron, the pages never call CFBD themselves. That also fixes the 429 problem for good.
6. **Secrets.** Move `.env.local` into Vercel project env vars. Nothing in code changes.

## When it is worth it

- When someone other than Derek needs the URL and Tailscale is not an option.
- When the archive is big enough that a database is the right home anyway (the tuner wants 50 graded games; that is a few weeks).
- When the sheet has moved to a browserless renderer.

Until then, agentbox with PM2 does everything this app needs, keeps the data on a disk you can rsync, and costs nothing extra. See `deploy/agentbox.md`.
