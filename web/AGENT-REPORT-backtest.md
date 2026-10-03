# Agent report: backtest

## What I built

A historical replay of the three models (game projection, scouting radar, draft forecast) on the 2022, 2023, 2024, and 2025 seasons, graded against real finals, closing lines, real draft picks, and NFL career value. Plus a Track record page that shows it.

The one thing I changed from the brief: the projection is graded two ways. The brief asked for an end-of-season replay with a note. I did that, but full-season stats contain each game's own result, and in the first run that leak made the edge-heavy blends look best. CollegeFootballData's advanced stats accept an `endWeek` filter, so I added a walk-forward mode that grades each game with stats through the week before it (from week 4 on). Every headline number below and the recommended weights come from the walk-forward run. The leaky version is kept on the page, labeled, for comparison only.

## Headline numbers (walk-forward, 2,361 FBS games, weeks 4 and later, 2022 to 2025)

| Metric | Live blend (0.6 Elo, divisor 40) | Elo only | Closing line |
| --- | --- | --- | --- |
| Winner right | 71.6% | 70.8% | 72.4% |
| Margin error (points) | 12.80 | 12.50 | 11.98 |
| Model side vs number, all games | 51.9% | 50.9% | n/a |
| Model side vs number, 4 point lean | 52.7% on 1,108 games | 51.7% | n/a |
| Model total lean right | 51.9% on 1,812 leans | n/a | n/a |

Per season the live blend went 68.2%, 74.9%, 70.0%, 73.1% on winners. The closing line went 72.1%, 73.0%, 70.7%, 73.6%.

Win probability is honest: picks stated at 60 to 70% won 75.6% of the time, 70 to 80% won 86.7%, 80 to 90% won 94.0%. If anything the model is underconfident.

Draft forecast, four drafts (2023 to 2026), 981 drafted non-specialists:

| Metric | Result |
| --- | --- |
| Real first-rounders the forecast had in Round 1 range | 19 of 123 (15%) |
| Real top-100 picks in Round 1 or Day 2 range | 71 of 385 (18%) |
| Draftees on the radar at any tier | 96% |
| Draftees in the eligible pool (right class, Eligible or Sleeper tier) | 88% |
| Rank correlation, forecast board vs real pick | +0.29 |
| Of the names the forecast put in Round 1 range, drafted at all | 32 of 115 (28%) |

Fifty-two of the 123 real first-round picks were in the pool but ranked so low they landed in the "Priority free agent" band. That is the single biggest miss in the system.

NFL outcomes (939 drafted radar players joined to nflverse, value per season played): pedigree correlates with NFL value at +0.14, production percentile at +0.04, the radar score at +0.14, and the real draft slot at +0.41. Production beats pedigree only at RB (+0.32 vs 0.00), QB (+0.22 vs +0.08), TE (+0.29 vs +0.15), and interior DL (+0.22 vs +0.07). Everywhere else pedigree wins. The 2026 draft class has no NFL seasons yet and contributes nothing to those numbers.

Scout Score sanity check: competitive expectation (from the closing spread) correlates with CFBD's excitement index at about +0.35 every season, and average excitement rises monotonically through the competitive buckets (about 3.8 for spreads over 14, about 5.2 for spreads under 5). Style contrast correlates negatively (about -0.10) every season. So the "competitive" input is doing its job and "style contrast" is, if anything, pointing the wrong way for watchability.

## What the numbers say

1. The projection is a legitimate 71 to 72% winner model that sits about one point of margin error behind the closing line. That is about where a public Elo-based model should land. It is not a market-beating model, and the page says so.
2. Unit edges add a little to winner rate (71.6 vs 70.8) and almost nothing to margin error. The best grid row by margin error (eloWeight 0.8, divisor 20) is a tie with Elo only (12.49 vs 12.50). Note the two "weights" are separate dials: eloWeight scales the Elo point estimate, and (1 - eloWeight) / divisor is points per percentile of edge. The live 0.6 setting shrinks Elo to 60% of its own estimate, which is why margin error gets worse as Elo weight drops.
3. The edges carry a little anti-market information. Using all eight signed gaps (instead of the four largest with small gaps zeroed) at 0.6 and divisor 20 covers 54.6% on 1,007 four-point leans. That is the most interesting row in the grid and still inside the noise of four seasons.
4. The model total runs hot. 1,506 over leans against 306 under leans, 52% right either way, and its error is a point worse than the posted total. The efficiency-and-pace formula has an upward bias of a few points.
5. The draft forecast finds almost everyone (96% on radar) but orders them poorly. Box-score production is a weak signal for round one at WR, EDGE, LB, and CB, where scouts draft traits. Pedigree is the better NFL signal at seven of ten positions.

## Recommended weights (data/weights.json, not applied)

`projection: eloWeight 0.8, edgeDivisor 20`. Honest reading: this is "mostly Elo, keep the edges at the same points-per-percentile as today." If the orchestrator wants the cover-rate angle instead, the all-eight-edges variant would need a code change in projection.ts (it currently reads the top four and zeroes gaps under 20).

`src/lib/projection.ts` now reads data/weights.json, but only when `USE_FITTED_WEIGHTS=1` is set. Default behavior is unchanged. I did not want running the backtest to silently change the live model.

## Ideas

- Fix the total's upward bias first: subtract the walk-forward mean error (about three points) or fit the EPA-per-play multiplier per season. The under leans were 51% and the over leans 52%, so there is no edge in the lean itself, but the error can shrink.
- Re-weight the radar score by position using the NFL numbers: more pedigree at WR, CB, S, OL, LB; more production at RB, QB, TE, interior DL. The data to do it is in results.json under nfl.byGroup.
- Add a "traits" input for the round-one problem. Size norms are already there; the next cheap public signals are recruiting rank inside the class (not just stars) and games started, both of which are in the roster and usage feeds.
- Build a weekly walk-forward archive in production: the backtest's advWeeks tables are exactly what lockPregame would need to replay any locked call later with the stats of that week.
- Try shrinking Elo less aggressively in-season (eloWeight 0.8) and leaving the edge scale alone; that is the whole of the weights recommendation.
- Style contrast should probably come out of the Scout Score or be re-defined. It is negatively correlated with excitement four seasons running.

## Files

New:
- `scripts/backtest.mjs` (the replay; sequential CFBD calls, 150 ms pause, 429 backoff, per-season caching, `REFETCH=1`, `SEASONS=`, `SKIP_NFL=1`)
- `scripts/lib/digest.mjs` (shared digest code: STAT_KEYS, digestPlayers, digestTeams, digestDraft, loadKey, makeGet)
- `scripts/lib/models.mjs` (ports of radar, forecast, tendencies, projection; `DRIFT` lists the differences)
- `src/lib/backtest.ts` (reader for results.json and weights.json, memoSync by mtime)
- `src/app/backtest/page.tsx` (route `/backtest`, title "Track record")
- `data/backtest/<season>/{players,teams,games,lines,draft,advWeeks,meta}.json` for 2022 to 2025
- `data/backtest/results.json`, `data/backtest/README.md` (every metric and caveat), `data/backtest/nflverse_draft_picks.csv`
- `data/weights.json`

Edited:
- `scripts/ingest.mjs`: now imports from `scripts/lib/digest.mjs`. Same calls, same output shapes (verified key-for-key against the current data/generated files).
- `src/lib/projection.ts`: additive optional weights read, gated by `USE_FITTED_WEIGHTS=1`.
- `src/app/history/page.tsx`: one link line, "See the historical track record".
- NAV in layout.tsx was not touched. It already has six tabs and the mobile tab bar has no room.

## How to verify

- `npx tsc --noEmit` passes.
- `node scripts/backtest.mjs` reruns in about ten seconds from the cached digests (no network except nflverse if the CSV is missing). A full refetch takes about 14 minutes.
- `/backtest` returns 404 on the running PM2 server because it is a production build; it will appear after the orchestrator's `next build`. `/history` still serves.

## Known gaps

- CFBD returned a 503 for the 2024 week-5 advanced table, so 2024 week-6 games are not in the walk-forward set (49 games counted as "not charted" across all seasons). A `REFETCH=1` rerun would likely fill it.
- No weather in the replay, so the total lean is the pure efficiency-and-pace model.
- Declarations are not replayed; returning juniors stay in the pool, which lowers band precision but not recall.
- The radar replay uses full-season stats; in-season radar tiers are noisier than the draft hit rates suggest.
- Four seasons is a small sample. Treat any rate within two points of another as a tie.
