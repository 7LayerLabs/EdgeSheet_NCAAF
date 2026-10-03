# Agent report: beat feed

## What I built

A sleepers.app style "Beat feed": the last 3 days of posts and headlines about a game's two teams, tagged to the radar players they name. Free sources only, no keys. Shown on the game page, the player page, and a new `/feed` route. Every item carries a label (Fan post, Reporter or outlet, News) and a line under each list says the feed is context, not a source for the report.

## Files

New:
- `src/lib/feed.ts`: `feedForTeams(schools, players)` returns `{ items, sources, asOf, windowDays }`. Items are `{ id, source, kind, author, outlet?, url, text, publishedAt, tags: playerIds[], team, where }`. Also `tagItem()`, `teamQuery()`, `youtubeFor()`, `subredditFor()`, `KIND_LABEL`, `SOURCE_LABEL`. Memoized 15 minutes per query and per team-pair, 6 second AbortController timeout on every fetch, `Promise.allSettled` so one dead source never blocks the page. Dedupes by URL and by first 80 characters of text, sorts newest first, caps at 60 with no single source allowed more than 30 so headlines cannot bury the posts.
- `src/components/BeatFeed.tsx`: server component `BeatFeed` (list, source status line, disclaimer), `FeedItemRow`, `SourceLine`, `FeedDisclaimer`, `BeatFeedFallback` (skeleton for Suspense), `ago()` ("4h ago"). Yellow `bg-warn` tag chips link to `/player/<id>`.
- `src/components/PlayerNews.tsx`: server component for the player page. Items that tag the player plus a Highlights card: YouTube search link always, Data API embed when `YOUTUBE_API_KEY` is in `.env.local`.
- `src/app/feed/page.tsx`: `/feed?team=Georgia&team=Alabama` (up to 6 teams). Players for tagging come from `radarForGame(team, 6)`. Empty state explains the query format and links to the watchlist and Top 25.
- `scripts/feed-check.ts`: `npx tsx scripts/feed-check.ts Miami Clemson` prints the feed with source status and tags.

Edited (small additive edits only):
- `src/app/game/[id]/page.tsx`: imports, `["feed", "Feed"]` added to the jump bar after Storylines, a "Beat feed" `Section` with `id="feed"` between Storylines and Scout Score, wrapped in `<Suspense>` so it streams in. Full width, not a right column, since the page is a single column throughout.
- `src/app/player/[id]/page.tsx`: imports, "In the news" section at the end with `<PlayerNews>` in `<Suspense>`.
- `src/app/watchlist/WatchlistClient.tsx`: "Beat feed for your teams" button under the followed teams, linking to `/feed?team=...`. I did not add Feed to NAV: the mobile tab bar already has six tabs.

## What the sources did (probed 2026-10-03 from this machine)

| Source | Result | Notes |
| --- | --- | --- |
| Bluesky `public.api.bsky.app` | 403 | Blocked for both curl and Node fetch from here, regardless of User-Agent. |
| Bluesky `api.bsky.app` | 200, no auth | Same `searchPosts` endpoint. The code tries `api.bsky.app` first and falls back to `public.api.bsky.app`. Bridged posts (brid.gy) have empty `text`; the code falls back to `bridgyOriginalText` and the embed title and description. |
| Reddit `search.json`, `api.reddit.com`, `old.reddit.com` | 403 or redirect to login | Unauthenticated JSON is dead to server fetches. |
| Reddit `search.rss` and `r/<team>/new.rss` | 200 but `x-ratelimit-remaining: 0` after one call, then 429 | Works, but the budget is roughly one request per minute per IP. The code parses the Atom feed, backs off all Reddit calls for 10 minutes after any 429 or 403, and memoizes each URL 15 minutes. Expect Reddit to show "off (Reddit HTTP 429)" often. |
| Google News RSS | 200, reliable, 70 items per query | Best source by far. Uses the `when:3d` operator. Outlet comes from the `<source>` tag. Links are Google redirect links. |
| YouTube | No key present | Search link only. Embed path is written and untested against a real key. |

Feed check for Miami and Clemson: 60 items in about 700 ms. 30 news, 15 Bluesky fan posts, 14 Bluesky outlet posts, 1 Reddit before the 429. Tagged Darian Mensah, Malachi Toney, Jeremiah Alexander, Samson Okunlola correctly.

## Tagging rules (conservative on purpose)

- Full name match, case-insensitive, allowing a middle initial.
- "D. Mensah" style initial plus last name, only when the item came from that player's team query.
- Last name alone only when: same team, 5+ letters, not in a 600-name common surname list, and the text also mentions the team.
- Player-name queries can return a different person with the same name; an item is kept only if it tags a player or mentions one of the teams (mascot or school plus a football word for short or ambiguous names like Miami, Georgia, Washington).

## Kind labels

- Fan post: `.bsky.social` handle or any subreddit post.
- Reporter or outlet: custom domain Bluesky handle (reporters and bridged outlets) or a display name with a word like Wire, Insider, Sports, 247, Rivals, On3.
- News: Google News article.
- Bots like OptaSTATS land under Fan post. Heuristic, not verified.

## How to verify

1. `npx tsc --noEmit` passes.
2. `npx tsx scripts/feed-check.ts Miami Clemson` prints the feed and source status.
3. After the orchestrator builds and restarts: open any game page and jump to Feed; open a player page and scroll to "In the news"; open `/feed?team=Miami&team=Clemson`; on the watchlist, follow a team and click "Beat feed for your teams". The running production server returns 404 for `/feed` until it is rebuilt, which is expected.

## Keys

None required. `YOUTUBE_API_KEY` in `.env.local` turns the highlights link into an embed on the player page.

## Known gaps

- Reddit is nearly useless unauthenticated. A Reddit app (client id and secret, script auth, free) would lift the limit to 100 requests per minute and unlock JSON with scores and comment counts.
- Bluesky search is noisy for quoted team names; a "mood report" bot that happened to mention the Hurricanes made it through. A small blocklist of handles would clean that up.
- Google News links go through news.google.com redirects, so the outlet domain is not visible in the URL.
- Items are sorted strictly newest first. No engagement weighting (Bluesky returns like and repost counts, which I kept off the UI to avoid a popularity signal that looks like a fact).
- `/feed` reads players from the radar for each team, so a team outside the generated data gets team-level items only.
- X (Twitter) is not a source. No free read API exists.

## Ideas

- Beat reporter list per team: a hand-curated list of 3 to 5 Bluesky handles per Power 4 program (beat writers, SB Nation sites) queried by author instead of by keyword would give a far cleaner feed than keyword search and cost one request per handle.
- Injury and availability signal: scan feed text for "out", "questionable", "will not play", "ruled out" next to a radar name and surface it on the Keep an eye on card as "reported, unverified" with the source link. That is where the beat feed earns its keep for a scouting product.
- Line move context: when the Market section shows a move, pull the feed items from the hours around the move so the reader sees why it moved.
- Postgame reactions: after a final, reorder the feed to show posts after kickoff first, so "Who showed up" gets social confirmation.
- Telegram or daily digest: the feed library already returns plain objects, so the Telegram agent could send "3 posts about your followed players" each morning.
- Reddit game threads: r/CFB posts a game thread and a postgame thread per game with a fixed title format. One RSS call to r/CFB new.rss can find them; link them directly from the game page under Live.
