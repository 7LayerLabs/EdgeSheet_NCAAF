# AGENT-REPORT-jev: TypeSafe Jev client and the judgments it powers

Date: 2026-10-03 night. Key: `TYPESAFE_API_KEY` (present in `.env.local`). SDK: `@typesafe-ai/sdk` 0.6.0. Model answering: `jev-1.13.0`.

## What I built

1. **Shared client** `src/lib/jev.ts`. `askJev(state, questions, opts)` plus flat helpers `nouls`, `choice`, `score`, and batch helpers `batchNouls` / `batchScores` that put many items in ONE request. Per-attempt timeout 5s, one retry (SDK backoff), usage appended to `data/ai/usage.jsonl` as provider `typesafe` in the same shape the LLM adapter writes (price from the docs: $0.042 per million input tokens, output free). Everything returns `undefined` on a missing key or any failure; callers fall back. Server only.
2. **Feed classification** (`src/lib/feed.ts`, additive): `judgeFeed(items, players)` asks, for every (item, tagged player) pair, six Nouls in one request: injury, availability (non-injury), promoted, demoted, praise from a reporter or outlet, and "is this post about this player at this team". Policy in code: chips at >= 0.7 (`FEED_CHIP_MIN`), tag dropped under 0.4 on about-player (`FEED_TAG_MIN`), a depth chart chip absorbs the availability chip unless an injury is also in play. Memoized 6 hours per item and player. Chips render in `BeatFeed` (`FeedChips`) with a "reported, unverified" mark; `PlayerNews` drops namesakes the same way. `/feed` has a filter: "Injury and availability only" (`?only=availability`).
3. **Keep an eye on** notes: `availabilityNotes(items)` picks the strongest injury or availability item per player. `src/components/AvailabilityNote.tsx` is an async server component the game page passes into `ProspectCard` through a new optional `note` prop, inside `Suspense` so the card never waits on the feed. Shows "Reported injured, Bluesky 3h ago, unverified" with the link, only at >= 0.7.
4. **Report soft gate** (`src/lib/report.ts`, additive): after the regex validator passes, `verifyReport` sends every sentence with the whole evidence packet in one request (one Noul per sentence, "fully supported by `evidence`"). Sentences under 0.5 go into `flags` on the cached report; `WrittenReport` shows "n of m sentences could not be confirmed" with the sentences on expand. Never blocks publication. The packet facts are now saved on the cached report as `evidence`, so the gate can be re-run offline and re-thresholded without CFBD.
5. **Flip ranking** (`src/lib/flip-jev.ts`): `flipScoreJev(games)` asks one Score per live game in one request, five concrete levels (blowout, comfortable, competitive, tight late, deciding moment), cached 60s, scaled to 0..100 with the numeric flip score as a 5 point tiebreak. `withFlipJev` attaches it as `game.live.flipJev` on the slate page; `flipRank(g)` in `live.ts` prefers it and falls back to `flipScore`. `Slate` "Flip to" and `LiveTicker` use `flipRank`. Not in `live.ts` itself because client components import that file and the Jev client needs `node:fs`.
6. **Calibration script** `scripts/jev-check.mts` (`npx tsx scripts/jev-check.mts`). Runs every use against real posts, a cached report, and live games (or synthetic situations laid over real matchups when nothing is live). Works without CFBD: falls back to `data/archive` matchups and radar players when the slate refuses. `scripts/jev-smoke.mts` is a 2-call sanity check of the client.

## Files touched

New: `src/lib/jev.ts`, `src/lib/flip-jev.ts`, `src/components/AvailabilityNote.tsx`, `scripts/jev-check.mts`, `scripts/jev-smoke.mts`.
Additive edits: `src/lib/feed.ts` (types + judge section at the end), `src/lib/report.ts` (`flags`, `verified`, `evidence` on `CachedReport`; `verifyReport`, `reportSentences`, `splitSentences`), `src/lib/live.ts` (`flipRank`), `src/lib/types.ts` (`live.flipJev`), `src/components/BeatFeed.tsx`, `src/components/PlayerNews.tsx`, `src/components/ProspectCard.tsx` (`note` prop), `src/components/WrittenReport.tsx`, `src/components/Slate.tsx` (one import, one sort line), `src/components/LiveTicker.tsx` (same), `src/app/page.tsx` (`withFlipJev`), `src/app/feed/page.tsx` (filter), `src/app/game/[id]/page.tsx` (one import, one prop on `ProspectCard`, `pos` passed to the feed). `package.json` gained `@typesafe-ai/sdk`.

## How to verify

- `npx tsc --noEmit`: my files are clean. Errors remaining at the time of writing are in other agents' files (`watchguide.ts`, `radar.ts` movement import, `playerlog.ts` regex flag, `plan.ts`, `og-check.mts`).
- `npx tsx scripts/jev-check.mts`: prints every probability. Latest run below.
- Game page: a radar card shows a yellow note when a feed post reports an injury or availability for that player. Beat feed rows show chips. `/feed?team=Washington&team=USC&only=availability` filters to those rows.
- Written report footer shows the second-pass line once a report is (re)written with the key present.

## What Jev was good and bad at on real posts

Numbers from the 2026-10-03 run (feed judging: 36 pairs, 216 Nouls, ONE request, 659 ms).

Ten real examples (about-player | injury | availability | promoted | demoted | praise):

1. 247Sports: "Injury updates: Corey Simms out for season; Mark Bowman, Alex VanSumeren game-time decisions" (Mark Bowman, USC TE): 93 | 69 | 80 | 3 | 5 | 2. Chip: availability. Right call; "game-time decision" is availability, injury under the bar.
2. RotoWire: "Mark Bowman: Likely sidelined vs. Huskies": 94 | 80 | 47 | 4 | 7 | 2. Chip: injury.
3. Teren Kowatsch (Bluesky): "Washington center Landen Hatchett's availability for today's game against No. 18 USC is trending towards doubtful": 97 | 83 | 86 | 5 | 5 | 2. Chips: injury, availability. The exact post the keep-an-eye-on note is built for.
4. Newsday: "RB LJ Martin sidelined for No. 10 BYU at TCU after apparent injury in first half": 96 | 92 | 56 | 7 | 9 | 7. Chip: injury.
5. pitcherlistnews: "Injury: Bryce Elder (knee) will not be on Braves' NLDS roster. (Mark Bowman)" tagged to USC's Mark Bowman: about-player 7%, DROPPED. The namesake is an MLB reporter. This is the win over the regex tagger.
6. Husker Corner: "Are Jamal Rule and Mekhi Nelson playing vs. Maryland? Nebraska injury update": 93 | 30 | 30 | 6 | 5 | 3. No chip. A question headline with no status, so no chip is the honest answer.
7. Tide 100.9: "Keelon Russell Taking Bigger Strides Every Time He Steps on the Field": 96 | 2 | 4 | 9 | 2 | 91. Praise from an outlet, correctly high.
8. Evans Donnell (fan, Bluesky) sharing the AP recap "Keelon Russell accounts for 4 TDs as Alabama routs Mississippi State": 96 | 2 | 4 | 4 | 2 | 16. Praise low because the source kind is a fan, which is what the question asks. Good discrimination between a recap and praise.
9. "The Right News, Right Now" (RSS bot) photo captions "Alabama quarterback Keelon Russell passes during the second half": 96 | 2 | 4 | 3 | 2 | 7 to 11. Correctly not praise.
10. Salt Lake Tribune: "Fesi Sitake saw something in Legend Glasker before most major programs did. Now the BYU freshman is making an impact": 95 | 6 | 11 | 57 | 4 | 94. Praise yes; promoted at 57% is a fair reading of "is starting" buried in the text, under the chip bar.

Planted posts with known answers: injury questionable 97% injury; suspension 98% availability, 4% injury; "will start at QB" 95% promoted (and 84% availability, which is why the depth chart chip now absorbs the availability chip); "benches Russell" 98% demoted; "cleared to return" 95% availability; fan hype 3% praise (by design, praise is reporter-only); passing mention in a power ranking 55% about-player, no chips.

Bad or borderline:
- A namesake with no team context ("Chris Cole's new jazz record") sat at 52% about-player, above the 0.4 drop line. The real-world namesake (the Braves writer) was 7%, so the drop line works when there is any sport context. A 0.6 line would catch the jazz case but risks dropping real posts that only use a last name; keep 0.4 until we have a few false drops to look at.
- A TCU post about Jaden Craig got tagged to Josh Hoover by the regex and Jev gave 53% about-player, so it stayed. Jev is uncertain, not wrong; the regex tagger is the problem there.
- Injury vs availability overlap on the same post (Hatchett "trending towards doubtful" fires both). Both chips show. Fine for a fan, but if it gets noisy, show only the higher one.
- Praise is defined as reporter-or-outlet praise, so a Bluesky account bridged from an RSS feed with an outlet-like name gets treated as an outlet. That is the feed's `kind` classifier, not Jev.

## Report verification

33 sentences vs the evidence in one request, 263 ms. The real packet could not be built because CFBD returned 429 "monthly call quota exceeded" during the run, so the check used the archive lock (21 facts) as a stand-in and 20 sentences were flagged, most of them because the stand-in lacks the stat lines, the market move, and the weather. What matters for calibration:
- Planted errors came back at 1 to 2%: a rank nudged from No. 3 to No. 10 with the same yards figure, an invented injury, an invented player.
- Framing sentences with no checkable claim came back high (96% "This is not a lean.", 95% "It is a mismatch, and a prominent one.").
- A sentence whose numbers were in the stand-in evidence came back 94% ("Clemson is No. 135 at 3.46 allowed").
- The first run exposed a splitter bug ("No. 3 of 138" was split at "No."), fixed with `splitSentences`, which also protects "vs.", "Jr.", "T.J.".
Re-run with the full packet once CFBD answers again, or write a new report: the facts are now saved on the cached report, so `jev-check` uses them next time.

## Flip ranking

Seven synthetic situations on real matchups, one request, 199 ms. Order and levels: overtime 100 (p 99% deciding moment), 4th and 2 at the 12 down four with 31 seconds 95, one score inside two minutes 94, scoreless first quarter 51, one score second quarter 49, two scores late third 33 (68% comfortable), 24 point lead in the fourth 10 (62% blowout). That is the order a fan would pick, and the numeric score agrees at the ends but cannot separate the three deciding-moment games from each other or from a tight first quarter; Jev can. Needs a real live Saturday to confirm on the ESPN feed.

## Latency and cost

| Use | Questions per request | Latency | Cost per request |
| --- | --- | --- | --- |
| Feed judge, 36 pairs | 216 Nouls | 659 ms | about $0.0009 |
| Feed judge, 13 pairs | 78 Nouls | ~250 ms | about $0.0003 |
| Report verify, 33 sentences | 33 Nouls | 263 ms | about $0.0004 |
| Flip, 7 games | 7 Scores | 199 ms | about $0.0001 |
| Smoke, 4 mixed | 4 | 357 ms | $0.00002 |

Whole calibration run: 8 requests, 52,751 input tokens, 1.9 s total Jev time, $0.0022. Latency is dominated by the round trip, not the question count, which is why batching per page is the right shape. The feed judge is memoized 6 hours per item, flip 60s, notes 5 minutes, so a busy Saturday is a few cents.

## Known gaps

- CFBD monthly quota is exhausted (429) as of this run, so the live packet, live flip, and the game page could not be exercised end to end. Everything degrades: feed and notes still work (they do not touch CFBD), report verify ran on the archive stand-in, flip ran on synthetic situations.
- `judgeFeed` only judges items the regex already tagged. It cannot add a tag the regex missed (a nickname, a first-name-only post).
- Chunk size is 30 pairs per request (180 Nouls). The API accepted 216 in one request without complaint; I have not found a documented ceiling, so a very busy feed splits into a few requests.
- The `evidence` array on cached reports only exists for reports written from now on.
- Flip uses `g.score`, which the slate only has once ESPN reports; a live game with no score falls back to the numeric flip score.

## Ideas worth adding

1. **Watch guide ranking**: Score each "why watch" reason and matchup for a neutral diehard fan ("skip", "nice to know", "must see") and let the game page order sections by it. One request per game, same state as the packet.
2. **Namesake-proof tagging**: run about-player on regex near-misses too (last name only on common surnames) and let Jev promote them to tags at >= 0.85. Turns the conservative tagger into a recall engine without inventing anything.
3. **Line move reasons**: for every spread move over a point, Nouls on the day's feed: "does this post explain the line move" (injury, weather, suspension). Surface the top post under the Market section as "reported reason, unverified".
4. **Telegram alert gate**: before pushing a live alert, one Score "how much would a fan regret missing this" to stop the 24 point blowout from paging anyone.
5. **Report re-verification after the final**: run `verifyReport` on a pregame report against the postgame packet and show which sentences the game disproved. Cheap accountability on top of the archive grades.
6. **Fan post dedupe**: Noul "is this the same news as `items[i]`" across the feed to collapse the eight RSS bots that repost one AP story.
7. **Prop context**: Noul per prop line "does the feed say anything that changes this player's availability" to annotate the PropsForRadar table.
8. **Pressure point check**: Choice over the four matchups "which one does this feed post say decides the game", to see whether reporters agree with the model's pressure point.
