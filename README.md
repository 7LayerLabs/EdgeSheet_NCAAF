# College Game Scout (working name: Scout the Slate)

Pick any college football game and know why it is worth watching, who matters, how the teams play, and what conditions could change the matchup.

Full product plan: `docs/BLUEPRINT.md` (original: `docs/College_Game_Scout_Product_Blueprint.docx`).

## What is here

`web/` is a Next.js 16 app (TypeScript, Tailwind 4) that now runs on **live data** for every FBS, FCS, Division II, and Division III game on the schedule.

```
cd web
cp .env.local.example .env.local   # add your CollegeFootballData key
npm install
npm run dev                         # http://localhost:3000
```

Without `CFBD_API_KEY` the app falls back to the hand-written sample slate from September 12.

## Data sources (all free tier)

| Need | Source | Cache |
| --- | --- | --- |
| Schedule, scores, records, conference, venue, TV | CollegeFootballData `games`, `games/media`, `records`, `teams`, `venues`, `calendar` | 5 min for games, hours or days for the rest |
| Spread, total, moneyline, line movement | CollegeFootballData `lines` (median across books, rounded to the half point) | 10 min |
| Kickoff forecast | National Weather Service hourly grid for the stadium coordinates | 30 min |
| Prospects | `web/src/data/prospects.json`, curated by hand | build time |

What the free tier does **not** give: live clock and score during a game (status is schedule-based and says "in progress"), NAIA schedules, play-by-play or charting. Every report lists these under "what this report cannot say."

## Screens

- `/` The slate for a day. Day strip for the week, previous and next week links. Search, quick filters (Live, Upcoming, Finished, Top Prospects, Hidden Gems, Late Night Radar, Watchlist), division toggles, weather-risk toggle, sort by kickoff or Scout Score.
- `/game/[id]` Game report in the blueprint's fixed order. Header, coverage gaps, Why Watch, Team Style, Conditions, Market, Must Watch, Matchups, Keep an Eye On, Storylines, Live or Postgame, Scout Score breakdown.
- `/player/[id]` Player page from the prospect file.
- `/watchlist` Games and players you follow (stored in the browser).

## Logic

- `src/lib/slate.ts` builds the slate: joins the CollegeFootballData rows, computes the market consensus, pulls the forecast, attaches prospects, writes the rule-based Why Watch lines, derives Scout Score inputs, and labels every gap.
- `src/lib/score.ts` Scout Score with the blueprint weights (35/20/15/10/10/5/5). Inputs that are not ingested yet (charting, prospects when the file is empty) are **excluded and the weights renormalize** instead of scoring zero. The breakdown shows what was excluded.
- `src/lib/weather.ts` rules engine with the blueprint thresholds (wind 15/20 mph, rain in the game window, heat index, cold, storm, indoor override, altitude note).
- `src/lib/nws.ts` and `src/lib/cfbd.ts` are the provider adapters. Swap them without touching the UI.

## Prospect file

`web/src/data/prospects.json` is the editorial backbone. It ships empty on purpose. Add real, verified players with the school name spelled exactly as CollegeFootballData spells it. Once it has entries, Draft talent and Future talent join the Scout Score and games show "N likely picks."

## Next steps from the blueprint

1. Fill the prospect file from public 2027 boards (store each board separately, keep source and date).
2. Live scores: either the CollegeFootballData Patreon tier (scoreboard endpoint) or a second provider.
3. Team tendency metrics from play-by-play (weeks 7 to 8), which unlocks Team Style, Style contrast, and Direct matchups.
4. Structured AI report generation with factual validation (week 9).
5. Deploy to Vercel with `CFBD_API_KEY` set as a server-side environment variable.
