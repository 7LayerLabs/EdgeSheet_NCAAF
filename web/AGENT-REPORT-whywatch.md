# AGENT-REPORT-whywatch

Why watch is now a viewing guide: a hook, three things to look for (who, what, when), and after kickoff a "How it went" line per player from the box score. Written in the diehard voice from sourced facts only, ranked by Jev, validated like the report, cached on disk.

## What I built

- `src/lib/watchguide.ts` (new)
  - `buildCandidates(game)`: every concrete, sourced thing to watch, each with a `kind` and facts that carry ids. Kinds: `player` (top 2 radar names per team with stat line, evidence, position-specific watch note, box line when started), `edge` (each non-even unit matchup with its numbers and watch cue), `situation` (every `game.situations.cues` line plus a "who gets the ball on money downs" candidate per team from `thirdDownTargets` / `redZoneTargets`), `weather` (elevated or flag conditions), `market` (toss-up, 2.5+ point line move, total at or above 62 or at or below 42), `rank`, `portal` (transfer faces former team), `projection` (model vs market when the side gap is 3+ or the total lean is 4+).
  - `rankCandidates(game, cands)`: one TypeSafe request, a Score question per candidate over the same state (speculative fan-out), four levels from "Skip it" to "Must see". Code enforces that the top three span at least two kinds (`enforceMix`). Falls back to the fixed `priority` order when the key is missing or the call fails, and records which ranker ran. Goes through the shared client (`batchScores` in `src/lib/jev.ts`, purpose `watchguide-rank`, 15s timeout); when it returns undefined the fallback order is used and the note records why.
  - `generateWatchGuide(game)`: top 5 candidates to Sonnet (`generateJSON`, `small: true`, structured output), JSON `{ headline, hook, items[3]{ title, what, when, who, whoPlayerId, factIds }, cardLine }`. Validation (`validateGuide`): exactly 3 items from 2+ kinds, every number in the candidate facts (same tolerance rules as the report validator), every proper noun in the facts (venue, city, network, team names allowed), player ids must be candidate players, fact ids must exist, no emoji, no em dash, no betting advice, no "the data" talk, "what" between 15 and 90 words. One retry with the violations listed; a cut-off answer counts as a failed attempt and retries shorter. Nothing unvalidated is ever written as `guide`.
  - Cache `data/ai/watchguide/<season>/<gameId>.json` with `evidenceVersion` (sha1 of the fact texts, so a guide is rewritten only when evidence changes, not every page build), the five candidates sent with their Jev scores, attempt log, usage.
  - `publishedGuide(game)` for the slate and page, `howItWent(item, game)` for the postgame line (code: prospect `lines` or box leaders by player id).
- `src/components/WatchGuide.tsx` (new): server component. Hook, three cards with Avatar headshot (linked to the player page) when the who is a radar player, a numbered circle otherwise, the what, a mono "When:" line, and "How it went" after kickoff. Footer shows the model, ranker, candidate count, attempts.
- `src/app/api/watchguide/route.ts` (new): `GET ?id=` audit (candidates, evidence version, cached record), `GET ?date=` the day's Division I games with Scout Score and whether a guide is cached, `POST { id, force }` writes one guide. Same shape as the report route.
- `scripts/write-watchguides.mjs` (new) and `npm run guides`: default talks to the running server (so CFBD calls come from its fetch cache), `--local` runs in-process via tsx, `--date`, `--limit`, `--ids`, `--force`, `--dry`, `--show N`, `--budget` (hard stop, default $5). `--local --from-cache` serves CFBD 429/503 from `.next/cache/fetch-cache` so guides can be written while the quota is exhausted.
- `src/lib/slate.ts`: `deriveWhyWatch` rewritten (fallback only). Leads with a named radar player and his line plus the position-specific watch note, or with the strongest mismatch and its numbers; market lines carry the total and what it means; a lone "No. 18 USC hosts Washington (3-1)" never leads, and when it is all we have it gets a sentence telling you what to watch. One additive change where `whyWatch` is set: prefer the cached guide's `cardLine`. One import.
- `src/app/game/[id]/page.tsx`: one import pair, `const guide = publishedGuide(game)` after `getGame`, and the Why watch section renders `WatchGuide` with the guide headline as the title when a guide exists, the old three cards otherwise.
- `package.json`: `"guides": "tsx scripts/write-watchguides.mjs"`.

## Samples (real output, claude-sonnet-5, ranked by Jev)

Auburn at Tennessee (final):
- Headline: Bishop ran wild while Tennessee's secondary locked the game down
- Hook: A Tennessee back ran for 220 yards and Auburn's deep ball never got untracked against the nation's No. 1 pass defense.
- 1. DeSean Bishop breaks the game open. "Bishop carried 34 times for 220 yards and three touchdowns in this game alone, way above his season pace of 320 yards on 54 carries. His 5.9 yards per carry on the year said he could do this, and once he got rolling Auburn had no answer." When: First drive and every time Tennessee needed a chain-mover on first down. How it went: rushing 34 car, 220 yds, 3 TD.
- 2. Tennessee's secondary smothers the deep ball. "Tennessee came in ranked No. 1 of 138 at limiting explosive passes at 1.10, while Auburn ranked just No. 60 in pass explosiveness at 1.58. Watch Auburn's longest completion of the day. If it stayed under 25 yards through the half, Tennessee had already won the matchup that mattered most." When: Every Auburn third down and shot play attempt downfield.
- 3. Womack wrecks the backfield. Da'Shawn Womack, 3 TFL and 2 sacks vs season 1 TFL, 0 sacks. How it went: defensive 5 tkl, 3 TFL, 2 sacks.
- Card: DeSean Bishop ran for 220 yards and three scores while Tennessee's No. 1 pass defense shut down Auburn's deep shots.

Washington at USC (live at the time):
- Headline: USC's passing downs are breaking Washington in real time
- 1. USC converts third-and-long at will (USC on passing downs vs Washington pressure). "USC ranks No. 3 of 138 in passing-downs success at 47 percent, while Washington ranks No. 57 at just 27 percent. That is a 40 percentile point gap, the kind that shapes an entire game plan. A third-and-8 against this Washington defense is not a stop, it is a first down waiting to happen." When: Any third-and-long situation, especially in the first half.
- 2. Maiava's rough start, 143 yards so far (Jayden Maiava, headshot). Season 1499 yds, 14 TD, 2 INT, 9.5 Y/A vs 12 of 18 for 143 and a pick so far; "Watch his ball placement outside the numbers and how he resets his feet when the first read is covered." When: Early third downs and any play where his first read is covered.
- 3. Washington's run game stuck at the line. OL No. 106 of 138 in line yards (2.82) vs USC front No. 39 (2.59). "Watch tackles for loss early, because USC living in the backfield is the tell."
- Card: USC's passing-downs offense, No. 3 in the country, is picking apart a Washington defense that ranks No. 57 in the same spot.

Fallback (no guide), same two games, now reads:
- "Mike Matthews (TENN WR, Jr): 14 rec, 261 yds, 3 TD, 18.6 Y/R. Release against press, separation at the top of the route, and hands away from his frame in traffic." then the deep-passing mismatch with its ranks, then "One-score game by the market: TENN -6, total 54.5."
- "Mark Bowman (USC TE, Fr): 21 rec, 204 yds, 2 TD, 9.7 Y/R. Whether he stays in to block on early downs, how he wins in the seam, and if the offense trusts him on third down." then the line-yards mismatch, then "No. 18 USC hosts Washington (3-1)." as the third line, never the first.

## Cost

| | |
|---|---|
| Guides written tonight | 11 (today's slate, the games the server's CFBD cache could rebuild) |
| Model calls | 15 (4 retries) |
| Total spend | $0.24 |
| First-attempt guide | 1.4 to 1.8 cents |
| Guide needing a retry | 3.2 to 3.5 cents |
| Average per guide | 2.2 cents |
| Jev | one request per guide, under a cent, not metered in usage.jsonl |

Average call: 3,530 input tokens, 890 output. To get under 2 cents on average, trim the candidate facts (drop the full stat line when `stat` already covers it, cap evidence at three lines) and add a system-prompt cache breakpoint; the system prompt is about 450 tokens, under Sonnet's cache minimum, so caching needs the fact block to be stable, which it is not. The honest lever is fewer retries.

## Validation rejections (first attempts, 4 of 15)

- "item 3 'what' is too long (98 words)" (Texas Tech at Colorado). Retry passed.
- "names or proper nouns not in the candidate facts: Chapel, Hill, NFL-size" (Notre Dame at UNC). Venue city was not in the vocabulary; fixed, and hyphenated coinages now pass when every part is known. Retry passed.
- "names or proper nouns not in the candidate facts: Add" (Vanderbilt at Georgia). Sentence-initial "Add" followed by an unknown capital; "add" is now a stop word. Retry passed.
- "model output was cut off at max_tokens" (Syracuse at UConn, first run at 1,500 max tokens). Raised to 3,000 and made a cut-off count as a failed attempt that retries shorter. Rerun passed first try.
- Zero number violations in 15 attempts. Zero invented players.

## How to verify

- `npx tsc --noEmit` is clean for my files (the one error is `scripts/jev-check.mts`, the jev agent's file).
- `npm run guides -- --dry` lists today's Division I games through the server once it is rebuilt (the route is new, so `next start` 404s it until then). Until the rebuild: `npm run guides -- --local --from-cache --limit 5`.
- Cached guides: `data/ai/watchguide/2026/*.json` (11 published). Open any of those game pages after the rebuild; the Why watch title is the guide headline and the three cards show who, what, when, and How it went on finals.
- Slate: the card's one-line why for those 11 games is the guide's `cardLine`.

## Keys needed

ANTHROPIC_API_KEY (present), TYPESAFE_API_KEY (present; without it the shared Jev client returns undefined, the ranker falls back to priority order, and the footer says so). Verified after switching to the shared client: Washington at USC rewrote with ranker jev, same top five order as the direct call. CFBD_API_KEY is over its monthly quota tonight: every fresh CFBD call returns 429. The server still serves games already in its fetch cache, which is why 15 of the top 25 games could not be rebuilt in-process ("no such game"). This blocks every agent's scripts, not just mine.

## Known gaps

- Guides for finals are written as "what to look for on a replay"; they lean on the box line, which is correct but reads like a recap. Pregame guides are the real product; tonight's slate had no cached upcoming game to test one on. Next Thursday's and Saturday's games need the CFBD quota back.
- Live guides are written from the box at that moment and are not rewritten as the game moves (evidence version changes with the box line, so a rerun would rewrite; a cron could do it at halftime).
- The validator allows integers 0 to 3 without a source, same as the report. "top 1 percent" passed on that rule; it was in the facts anyway.
- Situation candidates with unmatched play-text names (no id) keep the name but cannot link a headshot.

## Ideas

- Halftime rewrite: rerun guides for live games at the half with the box so the second-half "what to watch" updates; cheap at 1.5 cents.
- "Did it show up" grading: after the final, grade each item like the report edges. Player items already have the box line; edge items could be graded by the archive's edge verdicts (`game.archive.postgame.edges`) by matching `a vs b`. That gives a Why watch hit rate on the Record page.
- Use Jev twice: once to rank, once as a Noul per item ("is this sentence supported by these facts") before the regex validator, catching paraphrase hallucinations the number check cannot.
- Telegram: send the hook plus item 1 as the game-start push; it is already the shape of a text to a friend.
- Candidate kinds could feed the Scout Score: a game whose top three candidates all score "Must see" from Jev is a different kind of game than one ranked on Elo alone.
