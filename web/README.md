This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Consensus of projection systems

The game page shows the EdgeSheet projection as the headline, then an "Other systems" table under it. Those rows are not ours. They are rating systems published through CollegeFootballData (free tier): SP+ (Bill Connelly), FPI (ESPN), SRS (Simple Rating System), Elo, and CFBD's own pregame spread and win probability (`/ratings/sp`, `/ratings/fpi`, `/ratings/srs`, `/ratings/elo`, `/metrics/wp/pregame`). Each rating difference becomes a projected margin with 2.5 points of home field (Elo uses the same 65 Elo points and 28 Elo per point as the model), and win probability uses the same 16-point normal. The consensus is the median margin across whatever systems have a number, plus a count of how many lean each side of the posted spread (inside half a point counts as "on the number"). SP+, FPI, and Elo tables are FBS only, so FCS games usually get SRS and CFBD pregame only. The consensus median and side are locked pregame and graded on the Record page ("Consensus vs number"). Code: `src/lib/consensus.ts`, `src/components/ConsensusTable.tsx`; check one game with `npx tsx scripts/consensus-check.mts <gameId>`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
| Every 10 min while games are live or recently final, hourly otherwise | Postgame grades for every newly graded game, plus radar alerts when a followed player posts a "showed up" line |

Commands: `/slate [YYYY-MM-DD]`, `/leans`, `/record`, `/radar <team>`, `/game <team>`, `/help`. The bot only answers the chat in `TELEGRAM_CHAT_ID`.

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
