# EdgeSheet (College Game Scout)

Pick any college football game and know why it is worth watching, who NFL scouts are looking at and in which draft class, how the teams play, and what conditions could change the matchup.

Full product plan: `docs/BLUEPRINT.md` (original: `docs/College_Game_Scout_Product_Blueprint.docx`).

## Run it

```
cd web
cp .env.local.example .env.local     # add your CollegeFootballData key
npm install
npm run ingest                        # ~2 min: rosters, stats, recruiting, tendencies, draft history
npm run dev                           # http://localhost:3000
```

`npm run build` runs the ingest first (prebuild). Without `CFBD_API_KEY` the app falls back to a hand-written sample slate.

## Pages

| Route | What it is |
| --- | --- |
| `/` | The slate for a day: every FBS, FCS, DII, and DIII game, kickoff windows, ranks, lines, forecast flags, Scout Score, who is on the radar. Day strip, week navigation, search, filters (Live, Top 25, Hidden Gems, Watchlist, ...), sort by kickoff, score, or rank. |
| `/game/[id]` | The game report: Why Watch, Team Style with ranked metrics, pressure point, unit matchups, conditions, market, Must Watch by draft class (this year, next year, the year after), Keep an Eye On, box score leaders once the game starts with each radar player's line. |
| `/radar` | The national scouting board. Filter by draft class, division, position; search by name, school, or conference. Every card links to this week's game. |
| `/player/[id]` | Bio, class and eligibility, pedigree, the four radar components, season line, what to watch, this week's game. |
| `/rankings` | AP Top 25 plus the FCS, DII, and DIII coaches polls, each team's game this week, follow buttons. |
| `/draft` | The last three NFL drafts: positions taken in the top 50 with year-over-year change, pipeline schools, conferences, round one. |
| `/watchlist` | Teams, games, and players you follow (browser storage). |

Mobile gets a five-tab bar; desktop gets the top nav.

## Data

| Need | Source | Refresh |
| --- | --- | --- |
| Schedule, scores, records, TV, venues, logos, polls | CollegeFootballData (free tier) | live, 5 min to 1 day fetch cache |
| Spread, total, moneyline, line movement | CollegeFootballData `lines`, median across books, rounded to the half point | 10 min |
| Kickoff forecast | National Weather Service hourly grid at the stadium | 30 min |
| Box scores | CollegeFootballData `games/players` | 15 min |
| Rosters, season stats, usage, recruiting ratings, team advanced stats, draft picks | `scripts/ingest.mjs` writes `web/data/generated/*.json` | run `npm run ingest` (daily is plenty) |

Not available on the free tier: live clock and score during a game (status is schedule-based), NAIA schedules, advanced tendencies for FCS and below (Team Style is FBS-only; the report says so).

## The scouting radar

`src/lib/radar.ts`. Every player is scored on evidence only:

- Production: percentile against every player at the same position in the same division, per-game rates where volume matters.
- Pedigree: public recruiting rating (stars, national rank).
- Usage: share of team plays.
- Size: height and weight against NFL norms for the position.

Score = 55% production, 22% pedigree, 13% usage, 10% size, scaled by level of play (FCS 0.72, DII 0.5, DIII 0.38). Linemen have no box-score stats, so they lean on pedigree, size, class, and their unit's line yards.

Draft class comes from the roster: juniors and seniors in the next draft, sophomores the year after, freshmen the year after that. Tiers are Draft eligible, Future, Sleeper, Watch. The site says on every page that these are not draft grades and that no outside board is loaded. `src/data/prospects.json` still exists for curated board entries; it ships empty.

## Team style and matchups

`src/lib/tendencies.ts` turns advanced season stats (success rate, explosiveness, EPA, line yards, havoc, passing-downs success, pass rate) into labels by threshold, ranks every metric inside the division, compares each offense against the opposing defense on four axes, and writes the pressure point from the largest gap. Style contrast and direct-matchup inputs to the Scout Score come from here.

## Scout Score

`src/lib/score.ts`. Blueprint weights (35/20/15/10/10/5/5). Inputs the product cannot see for a game (no tendencies for DII/DIII, no line) are excluded and the weights renormalize. The breakdown on every game page shows what was excluded.

## Next steps

1. Deploy to Vercel with `CFBD_API_KEY` set; `outputFileTracingIncludes` must ship `data/generated/`.
2. Live scores: CollegeFootballData Patreon tier 1 unlocks the scoreboard endpoint.
3. Game logs per player (per-week box score joins) and a projection-history snapshot per ingest.
4. Curated board import into `prospects.json` so Established entries sit above the radar.
