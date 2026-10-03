# Agent report: consensus of projection systems

## What was built
A consensus of outside projection systems shown next to the EdgeSheet model on the game page, locked pregame and graded on the Record page. The EdgeSheet projection stays the headline; the outside systems sit in a compact "Other systems" table under it, with our row marked "ours" and the posted line as a reference row.

## CFBD free-tier probe (key from .env.local, 2026-10-03)
| Endpoint | Status | Rows | Shape |
| --- | --- | --- | --- |
| `/ratings/sp?year=2026` | 200 | 139 (FBS) | `{team, conference, rating, ranking, offense:{rating,...}, defense:{rating,...}, specialTeams}`; most sub-fields null on free tier |
| `/ratings/fpi?year=2026` | 200 | 138 (FBS) | `{team, fpi, resumeRanks:{...}, efficiencies:{overall, offense, defense, specialTeams}}` |
| `/ratings/srs?year=2026` | 200 | 268 (FBS + FCS) | `{team, conference, division, ranking, rating}` |
| `/ratings/elo?year=2026` | 200 | 138 (FBS) | `{team, conference, elo}` |
| `/metrics/wp/pregame?year=2026&week=5` | 503 once, then 200 | 114 | `{season, week, seasonType, gameId, homeTeam, awayTeam, spread, homeWinProbability}`; spread is a home spread, positive = home underdog |

All five work on the free tier. The pregame WP endpoint threw one transient nginx 503, so the fetcher treats any failure as "not available right now" and the rest of the table still renders.

## Method
- SP+, FPI, SRS: rating difference plus 2.5 home (0 on a neutral site).
- Elo: pregame Elo from the games row when present (the same inputs the model uses), else the season Elo table; same 65 Elo home field and 28 Elo per point as projection.ts.
- CFBD pregame: margin = negative home spread; win probability is CFBD's own.
- EdgeSheet model: the Projection passed in, converted to a home-positive margin.
- Win probability for rating systems and for the consensus uses the same sigma-16 normal as projection.ts.
- Consensus = median home margin over available systems. Agreement = how many available systems lean each side of the posted spread; a projection inside half a point of the line counts as "on the number" for neither side. The summary sentence names the majority side and says whether the EdgeSheet model is with them, against them, or on the number.
- Fetches use the Next fetch cache (6 h) plus `memo()` (6 h) so a slate build touches each endpoint once; calls are sequential inside buildConsensus to avoid 429s. Every failure degrades to an "unavailable" row with a plain-English note.

## Sample output (`npx tsx scripts/consensus-check.mts 401858249`)
```
Miami @ Clemson (FBS, week 5) status upcoming
market: MIA -15.5
model: MIA by 10.9, 75%, high

system           projects         winprob  note
SP+              MIA by 18.3      87%      CLEM 4.9, MIA 25.7, +2.5 home
FPI              MIA by 15.8      84%      CLEM 7.4, MIA 25.7, +2.5 home
SRS              MIA by 5.2       63%      CLEM 6.4, MIA 14.1, +2.5 home
Elo              MIA by 12.4      78%      CLEM 1550, MIA 1962, +65 home
CFBD pregame     MIA by 15.5      86%      home spread 15.5, home win prob 14%
EdgeSheet model (ours)MIA by 10.9      75%      confidence high

consensus: median -13.9 (home positive) -> MIA, 81%; market home margin -15.5; side CLEM 3/6; model agrees true
summary: 3 of 6 systems lean Clemson against the number, 2 sit on the number. The EdgeSheet model is one of them.
archive lock: {"median":-13.9,"favorite":"MIA","side":"CLEM","sideCount":3,"of":6}
```
Samford @ UAB (FCS visitor): SP+, FPI, Elo unavailable with "No SP+ rating for SAM." style notes; SRS and CFBD pregame still produce a consensus.

## Files touched
- New: `src/lib/consensus.ts` (fetchers, math, `buildConsensus`), `src/components/ConsensusTable.tsx` (`ConsensusTable`, `ConsensusLine`), `scripts/consensus-check.mts`.
- `src/lib/types.ts`: optional `consensus?: Consensus` on Game.
- `src/lib/slate.ts`: import plus one block in buildGame right after the projection (FBS/FCS only, never throws) and `consensus` in the returned object.
- `src/lib/archive.ts`: `Pregame.consensus` (median, favorite, side, sideCount, of), backfill on an existing pre-kickoff lock, `Postgame.consensusResult` (winnerRight, marginError, sideCovered), four HistoryStats fields.
- `src/app/game/[id]/page.tsx`: one import, `<ConsensusTable>` inside ProjectionBox under the basis list, `<ConsensusLine>` inside the Side box of ModelVsMarket.
- `src/app/history/page.tsx`: "Consensus vs number" tile after "Model total lean".
- `README.md`: "Consensus of projection systems" section.
- `data/archive/2026/401858249.json`: consensus lock added by the check script (pregame, before kickoff).

## How to verify
- `npx tsc --noEmit` passed clean after my last edit. A later run showed two errors in `src/lib/espn.ts` (`lineVals` not found), which is the ESPN agent's file mid-edit, not part of this work.
- `npx tsx scripts/consensus-check.mts <gameId>` prints the table, consensus, summary, and the archive lock for any game.
- Open `/game/401858249`: table under the projection, consensus line in the Market section. After the final, the projection footnote and the table footnote show the grade; `/history` shows the tile.

## Keys needed
Only `CFBD_API_KEY` (present). No new keys.

## Known gaps
- SP+, FPI, Elo tables are FBS only, so FCS games usually get SRS and CFBD pregame only. The table says which are missing and why.
- CFBD's free tier zeroes out most SP+ sub-ratings (success, explosiveness), so only the headline rating is used.
- Home field is a flat 2.5 for the rating-difference systems. SP+ and FPI publish their own home-field assumptions elsewhere, but not on this endpoint.
- The 2026 ratings are season to date, not "as of kickoff"; a lock taken Tuesday and a lock taken Saturday can differ slightly. The archive keeps whichever was first.
- Postseason: pregame WP is fetched with the game's seasonType, untested until bowl season.

## Ideas
- Weight the consensus by each system's graded record on the Record page once there are 30+ games, so the sentence becomes "the systems that have been right lean X."
- Flag "lonely" model calls: when the EdgeSheet model is the only system against the number by 3+, say so on the slate card. Those are the calls worth tracking, and the ones that teach the most when they miss.
- SRS disagreement is a signal on its own: SRS is schedule-adjusted margin with no priors, so a large SRS gap from SP+ or FPI usually means a soft early schedule or a blowout-inflated rating. Could become a storyline line.
- Store a weekly snapshot of the ratings tables in `data/generated/ratings-<week>.json` so the archive can show how the consensus moved from Tuesday to Saturday, the way the market move already shows open vs current.
- CFBD pregame win probability already exists for every FBS game: it could feed the slate card as a tiny "CFBD 86%" chip without any new fetch.
