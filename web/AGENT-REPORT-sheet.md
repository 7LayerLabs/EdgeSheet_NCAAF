# AGENT-REPORT-sheet

Agent: sheet. Scope: the Saturday sheet, PNG rendering, Telegram photo, OG images, share button.

## What was built

1. The Saturday sheet at `/sheet?date=YYYY-MM-DD`. One Letter page, light, dense. Six sections, all from existing functions:
   Games that matter (top 8 by Scout Score with kickoff, TV, line, O/U, model lean, one-line why), Edges (biggest unit
   mismatch per game by percentile gap, top 8), Leans (side and total, strong first, confidence, "Model, not a pick" once in
   the footer), Radar names to watch (top 10 radar scores playing that day with forecast band), Kickoff windows (ranked games
   by hour, two columns, three per hour plus a count), Weather flags (rules-engine flags at flag or elevated level).
   The "why" uses the AI watch guide's cached `cardLine` from `data/ai/watchguide/<season>/<gameId>.json` when present,
   otherwise `whyWatch`, cut to the first sentence (abbreviation-aware so "Michael Hawkins Jr." survives).
   Print CSS: Letter, 0.3in margins, nav, tab bar, footer, and buttons hidden, sections never split across pages.
   `?print=1` hides the site chrome and the Next dev badge so the screenshot is only the sheet.
   Buttons: Print, Send to Telegram (POST /api/notify type "sheet"), and a PNG link (/api/sheet.png?date=).
2. PNG rendering with headless Chrome via child_process, no puppeteer. `renderPng(url, {width, height, scale, out})` and
   `renderSheetPng(date, base)` which writes `data/sheets/<date>.png` (816 wide, 1200 tall, scale 2 = 1632 x 2400).
   Each run gets a throwaway `--user-data-dir` so it works while Derek's real Chrome is open.
3. Telegram photos: `sendPhoto(path, caption)` added to `src/lib/telegram.ts` (multipart FormData with fetch, retried once,
   caption capped at 1024). The notify route gained type "sheet". `scripts/send-sheet.mjs` plus `npm run sheet:send`
   (and `sheet:render` for a dry run) for a Saturday 8 AM cron. The bot's morning digest now also renders and sends the sheet
   PNG after the text slate (one try/catch block in `scripts/telegram-bot.mjs`; a failure is logged, never fatal).
4. OG images with next/og ImageResponse, 1200 x 630, light theme:
   `src/app/game/[id]/opengraph-image.tsx` (both logos, names with rank, kickoff, network, Scout Score with tag, line and
   O/U, records, model line, first sentence of the pressure point) and `src/app/opengraph-image.tsx` (date, top 3 D1 games
   with cardLine or whyWatch). Fonts are Barlow Semi Condensed 700 and Source Sans 3 fetched once from Google Fonts (WOFF);
   when offline the bundled default font is used. Note: passing an empty `fonts` array to ImageResponse disables the default
   font and the route dies with "failed to pipe response", so `ogFontsOrDefault()` returns undefined instead of [].
5. `generateMetadata` on the game page: title "No. 24 Kentucky at South Carolina, 4:15 PM ET on SEC Network", description =
   cardLine or whyWatch, openGraph and twitter cards. Next wires the og:image automatically from the sibling file.
6. Share button (`src/components/ShareButton.tsx`): `navigator.share` on phones, clipboard copy elsewhere. One line added next
   to the follow buttons in the game header.

## Files

New:
- `src/lib/sheet.ts` (buildSheet, cardLineFor), `src/app/sheet/page.tsx`, `src/components/SheetActions.tsx`
- `src/lib/render.ts`, `src/app/api/sheet.png/route.ts`, `scripts/send-sheet.mjs`
- `src/lib/og.ts`, `src/app/opengraph-image.tsx`, `src/app/game/[id]/opengraph-image.tsx`
- `src/components/ShareButton.tsx`
- `data/sheets/2026-10-03.png` (today's rendered sheet)

Edited (additive only):
- `src/lib/telegram.ts` (sendPhoto appended), `src/app/api/notify/route.ts` (sheet type), `package.json` (sheet:send, sheet:render)
- `scripts/telegram-bot.mjs` (sheet PNG after the morning slate), `src/app/game/[id]/page.tsx` (4 imports, generateMetadata, ShareButton line)

## How to verify

- `npx tsc --noEmit` is clean for every file above (0 errors at the time of writing).
- `PUBLIC_BASE_URL=http://localhost:3000 npm run sheet:render` writes `data/sheets/<today>.png` in about 3 to 7 seconds.
- `npm run sheet:send` renders and sends it as a Telegram photo (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).
- Open `/sheet?date=2026-10-03`, click Print for the Letter preview; click Send to Telegram.
- `curl -o og.png http://localhost:3000/game/401856709/opengraph-image` and `curl -o slate.png http://localhost:3000/opengraph-image`
  both returned 200 image/png (about 80 to 90 KB) on the dev server.
- `curl http://localhost:3000/game/401856709 | grep og:image` shows the card image tag and the cardLine description.

Verified on the shared dev server at port 3077 (Next refuses a second dev server in the same tree); the PM2 build needs the
orchestrator's rebuild to pick these up.

## Keys and environment

- Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (CHROME_PATH overrides).
- `PUBLIC_BASE_URL` must point at the running site when the cron or bot renders (defaults to http://localhost:3000).
- Telegram keys for sending. OG fonts need outbound access to fonts.googleapis.com; otherwise the default sans is used.

## Known gaps

- The sheet is one page on a normal Saturday but a 111-game day pushes the PNG to about 1.14 Letter heights; the PNG viewport is
  1200 px tall for that reason. Print paginates cleanly. If Derek wants strict one-page, drop Kickoff windows to the top 8 hours.
- The "lean" column on Games that matter shows the model's winner and probability when no gap clears the threshold; the Leans
  section is the authoritative list.
- The OG image fetch of CFBD logos happens inside satori; a slow logo host slows the first card render (then cached by Next).
- `data/sheets/` grows one PNG per day; nothing prunes it yet.

## Ideas

- A Sunday "Did it play out" sheet from the archive: same layout, graded calls in red/green, sent after the last final.
- Per-conference sheets (`/sheet?conf=SEC`) for the Telegram bot: `/sheet sec` returns a smaller PNG.
- Put the sheet PNG behind the slate OG image on Saturdays so sharing the home link previews the real sheet.
- A "radar card" OG image per player (`/player/[id]/opengraph-image`) with the headshot, band, and stat line, for sharing names.
- Jev could rank the eight "games that matter" by "worth flipping to right now" once games are live, and the sheet could re-render at 3 PM and 7 PM as a live edition.
