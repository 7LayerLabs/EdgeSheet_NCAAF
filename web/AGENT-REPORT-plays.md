# Agent report: play-by-play situational tendencies

## What I built

Division I (FBS and FCS) situational splits from CollegeFootballData `/plays` and `/drives`, feeding the Team style section, the matchups section, and the passing-downs grade in the accountability archive.

- `scripts/ingest-plays.mjs` pulls every week played so far (calendar weeks whose start date has passed), FBS and FCS, plays and drives, sequentially with a 1.2 second pause and 429/5xx backoff. Writes `data/generated/situational.json`.
- `src/lib/situational.ts` reads the digest (memoized by mtime), ranks every split inside the classification, and turns splits into plain-English cues with numbers and sample sizes.
- `src/components/Situations.tsx` renders the side-by-side table (Team style section, id stays `style`) and the "Situational cues" list (matchups section, under the four cards, above the projection box).
- `package.json` gained `"ingest:plays": "node scripts/ingest-plays.mjs"`. The main ingest was not run.

## Field findings (probe of `/plays` and `/drives`, week 4 2026)

The free tier serves both endpoints. Per week: FBS plays 7.9 to 10.9 MB (about 12,600 rows, 71 games), FCS plays 7.2 to 16.8 MB (week 1 is the big one), drives about 0.9 MB per classification. Responses took 1 to 13 seconds each.

Play fields confirmed: `gameId, driveId, id, driveNumber, playNumber, offense, offenseConference, offenseScore, defense, defenseConference, defenseScore, home, away, period, clock {minutes, seconds}, offenseTimeouts, defenseTimeouts, yardline, yardsToGoal, down, distance, yardsGained, scoring, playType, playText, ppa, wallclock`. `ppa` is null on about a quarter of rows (non-scrimmage plays). Drive fields: `id, gameId, offense, defense, driveNumber, scoring, startPeriod, startYardsToGoal, startTime, endPeriod, endYardsToGoal, endTime, elapsed {minutes, seconds}, plays, yards, driveResult, isHomeOffense, start/end scores`.

Play types seen: Rush, Pass Reception, Pass Incompletion, Timeout, Kickoff, Penalty, Punt, Sack, End Period, Passing Touchdown, Rushing Touchdown, Punt Return, Field Goal Good/Missed, Fumble Recovery (Own/Opponent), Pass Interception Return, Interception, Interception Return Touchdown, and a few returns and Safety. Fumble rows are classified run or pass from the text.

Two things in `playText` that matter:
- A formation tag leads most plays: `Shotgun`, `No Huddle-Shotgun`, `Under Center`, `Pistol`. That gives a no-huddle rate without any inference.
- Ball handlers appear as `#20 N.Sheppard` (jersey, first initial, last name), so carriers and targets can be parsed and matched to `players.json` by team plus jersey plus last name, falling back to initial plus last name. Two-word surnames ("R.Vander Zee") and suffixes ("D.Salley Jr.") are handled.

The FBS feed includes the FCS and DII opponents in those games (and vice versa), so plays are de-duplicated by play id across the two calls and teams with no Division I classification in `players.json` are kept in the digest but never ranked.

## Sizes and runtime

| | |
|---|---|
| Weeks pulled | 1 to 5 (week 5 partial, as of Saturday afternoon) |
| Calls | 20 (plays and drives, FBS and FCS, 5 weeks) |
| Plays processed | 110,833 across 627 games |
| Teams in digest | 313 (138 FBS ranked, 128 FCS ranked, rest are lower-division opponents) |
| Digest size | 1.1 MB |
| Runtime | 71 to 113 seconds end to end |
| Names parsed (D1) | 5,097 top-5 entries, 43 unmatched (under 1 percent), flagged `unmatched: true` |

Budget note: each weekly run re-pulls every week. At 20 calls per run today and 4 more calls per week, a full season is about 60 calls. Nowhere near the limit, but if that becomes a concern the script could cache raw weeks to `data/raw/` and only re-pull the current week.

## What the digest holds

Per team, offense and defense (defense rows are what the unit allowed), all as counts so the reader derives rates:
- early downs, standard downs, passing downs (2nd and 8+, 3rd/4th and 5+): plays, passes, successes, havoc events
- third and short (1-3), medium (4-6), long (7+): plays, passes, conversions
- fourth down, red zone (yards to goal 20 or less, plus drive trips and touchdown trips), goal line (5 or less)
- score state: leading by 9+, within 8, trailing by 9+
- explosive: rush 12+ and completed pass 20+ over rush and dropback counts
- tempo (offense): no-huddle tag count over tagged snaps, median seconds between snaps inside one drive and period (4 to 60 second deltas, so clock stoppages are in there; it is a proxy), plays and seconds of possession from drives
- top-5 third-down carriers, third-down targets, red zone carriers, red zone targets with roster id when matched

Per game and school: plays, third downs and conversions, passing downs and successes. This is what grades the passing-downs axis.

Success uses the CFBD rule: half the distance on first down, 70 percent on second, the full distance on third and fourth; any offensive touchdown counts. Havoc is a sack, interception, tackle for loss on a run, forced or lost fumble, or a pass broken up, read from play type and text.

## Sample cues (real output)

`situationsFor("Georgia")`, 5 games, 301 offensive snaps:
- Early-down pass rate 44% (108 of 247), No. 74 of 138
- 3rd and short conversion 85% (17 of 20), No. 4 of 81
- Red zone TD rate 81% (22 of 27 trips), No. 3 of 78
- Plays per minute of possession 2.04, No. 120 of 138 (slow); median 36 seconds between snaps
- Defense: explosive rush allowed 3% (4 of 135), No. 7; explosive pass allowed 5% (8 of 175), No. 7
- Third-down carriers: Chauncey Bowens 7; third-down targets: Thomas Blackshear 5, Talyn Taylor 4, Sacovie White-Helton 4, Lawson Luckie 4
- Red zone carriers: Chauncey Bowens 11, Nate Frazier 10

`gameCues("Alabama", "Georgia")`:
- Alabama completes a 20-plus yard pass on 17% (25 of 148) of dropbacks (No. 8 of 138). Georgia allows one on 5% (No. 7 of 138).
- Georgia throws on 30% (6 of 20) of third-and-short (1 to 3) and converts 85% (No. 4 of 81). Alabama allows a 47% conversion rate there (No. 6 of 69, 15 plays).
- Alabama goes no-huddle on 9% (19 of 208) of tagged snaps (No. 128 of 138 fastest) and runs 2.01 per min of possession (No. 123 of 138).

`gradePassingDowns("401856700", "Georgia", "Oklahoma", "offense")`:
- did not play out. Georgia on passing downs: 3 of 16 successful (19%); third down 4 of 12 (33%). Season baseline 34% (Georgia's season rate, 70 plays).

## Grading rule (archive.ts, passing-downs axis only)

`gradeEdge` now routes `axis === "passing-downs"` to `gradePassingDowns(gameId, offTeam, defTeam, edge)`. The favored side's number in the game is compared with its own season rate: an offense edge plays out when the offense beat its season passing-downs success by 8 points (or beat both passing-downs and third-down rates by 4); a defense edge plays out when the offense was held 8 points under what that defense allows all season; 8 points the wrong way is "did not play out"; between is "mixed". Fewer than 8 passing downs stays unmeasured. If the game is not in the digest yet (played after the last ingest), the verdict stays unmeasured with a message naming `npm run ingest:plays`, and `gradePostgame` now fills that verdict in on a later visit once the digest has the game. No archive entry had a postgame at the time of writing, so that fill-in path is type-checked but not exercised against a real file.

## Files touched

New:
- `scripts/ingest-plays.mjs`
- `src/lib/situational.ts`
- `src/components/Situations.tsx`
- `data/generated/situational.json` (generated)
- `AGENT-REPORT-plays.md`

Additive edits:
- `package.json`: `ingest:plays` script
- `src/lib/types.ts`: `situations?: { home, away, cues }` on `Game`
- `src/lib/slate.ts`: import; `situations` built in `buildGame` for FBS/FCS; passed on the returned Game
- `src/app/game/[id]/page.tsx`: import; `<SituationsTable>` at the end of the Team style section; `<SituationalCues>` under the matchup cards
- `src/lib/archive.ts`: import; `gradeEdge` takes an optional `gameId` and routes passing downs; `gradePostgame` fills in previously unmeasured passing-downs verdicts; the box-score fallback message names the ingest command

## How to verify

```
npm run ingest:plays
npx tsc --noEmit
npx tsx -e "import('./src/lib/situational').then(m => console.log(m.situationsFor('Georgia')?.offense.slice(0,6)))"
```

Open any FBS or FCS game page after the orchestrator rebuilds: the Team style section ends with "Situations" (two tables plus "who gets the ball" cards), and the matchups section shows a "Situational cues" card when at least one cue clears the 15-play bar on both sides. The PM2 server is a production build, so the live page does not show this until the rebuild.

## For the orchestrator (player cues)

`thirdDownTargets(school)` and `redZoneTargets(school)` return `{ carriers, targets }` lists of `{ name, id?, n, unmatched? }`. `id` is the CFBD athlete id from `players.json` when matched, so a radar player can be joined by id and a line like "4 of Georgia's 20 third-down targets this season" can go on a ProspectCard. Unmatched names are the play-text spelling and carry no id. I did not touch `radarToProspect` or `ProspectCard`.

## Known gaps

- Week 5 is partial until Sunday's ingest. Ranks shift as samples grow; every row shows n.
- Tempo: the no-huddle tag comes from ESPN's play text and is broad (Georgia shows 58 percent no-huddle yet ranks 120th in plays per minute). Plays per minute of possession from drives is the better pace number; seconds between snaps includes clock stoppages. All three are shown so the reader can weigh them.
- Red zone TD per trip is per drive that reached the 20; trips that started inside the 20 after a turnover count. Goal line TD rate is per play, not per trip.
- Score state uses the score at the snap. "Trailing by 9+" is empty for teams that never trailed.
- Names: a handful of players are missing from `players.json` (walk-ons with no stat line) and stay unmatched. Jersey collisions across a roster (two players sharing a number with different last names) are resolved by last name.
- No live fallback. A game played after the last ingest grades as unmeasured until the next run. The ingest is cheap enough (about 70 seconds) to run nightly during the season.
- No ranks for DII and DIII opponents that appear in these feeds. Lower divisions keep today's behavior, per the brief.

## Ideas

1. Nightly `ingest:plays` on the PM2 box, Sunday morning at minimum, so the Record page grades passing downs the same day.
2. Defensive havoc leaders. The same `#N Name` parsing on "(#8 H.Johnson)" tackle credits, "sacked ... (#24 B.Gompers)", "broken up by #4 E.Smith", and "intercepted by" gives per-player havoc on passing downs. That is a scouting signal for edge rushers and corners that no box score shows and would feed the radar directly.
3. Pass depth and direction. ESPN text labels every throw "short left", "deep middle", and so on. A 3 by 2 target map per offense (short/deep by left/middle/right) and per defense (allowed) is one more pass over the same rows and makes a sharp "Watch for" line: "Alabama throws deep right on 14 percent of dropbacks; Georgia has allowed 2 completions there all season."
4. Fourth-down aggressiveness. Go rate on fourth and 1 to 3 inside the opponent's 45, ranked. Fourth-down plays are already bucketed; only the opportunity count (punts and field goals on those downs) is missing, and both are in the feed.
5. Half-by-half splits. Period is on every row. Second-half pass rate when the game is within one score tells you who tightens up and who keeps attacking.
6. Formation tags as a style signal: Under Center versus Shotgun versus Pistol share per offense is sitting in the text for free.
7. Live grading mid-game. `/plays?gameId=` with the `team` filter is small (around 100 KB). An on-demand fetch memoized at 60 seconds would let the Live panel show "third downs today: 3 of 7" next to the season rate, which is the single most useful in-game number for a scout.
8. Drive-level finishing: points per trip inside the 40 is in the advanced stats already, but drives give points per trip inside the 20 by start field position, which separates "short field" scoring from earned red zone trips.
