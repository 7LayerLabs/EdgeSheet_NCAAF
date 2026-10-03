# Agent report: context layer (portal storylines, real crosswind, weather baselines)

Division I only (FBS and FCS). Lower divisions keep today's behavior.

## What was built

### 1. Transfer portal storylines
- `scripts/ingest-portal.mjs` pulls CollegeFootballData `/player/portal` for 2025 and 2026 (both work on the free tier) and writes `data/generated/portal.json`. The endpoint has no athlete id, so each row is matched to the ingested roster (`players.json`) by normalized name plus destination school, with position as the tiebreaker. Matched rows carry the CFBD athlete id and `onRoster: true`.
- `src/lib/portal.ts`: `transfersBetween(schoolA, schoolB)` (players now at A who came from B or the reverse, both years; 2025 rows must still be on the roster, 2026 rows are kept regardless), `notableArrivals(school)` (incoming transfers by rating then stars), `transferById(id)`, `arrivalNote(id)` ("arrived from Tennessee in 2025"), `portalStorylines(home, away)`.
- `src/lib/slate.ts` buildGame: appends one storyline per transfer who faces a former team ("QB Nico Iamaleava (Tennessee transfer, 2025) faces his former team.") and adds "Transfer: arrived from X in YYYY." to Keep an eye on notes when the radar player is a recent transfer.
- `npm run ingest:portal` added. Ran once: PORTAL_NUMBERS

### 2. Real crosswind from stadium orientation
- `scripts/ingest-stadiums.mjs` builds the Division I venue list (FBS and FCS home fields from `/teams` plus every venue used in a 2026 FBS or FCS game), then asks the Overpass API for every `leisure=pitch` with `sport=american_football`, `leisure=stadium` way or relation, or any pitch within 400 m. The long axis of each polygon comes from a minimum-area bounding rectangle (works for both rectangular fields and oval stadium bowls). Preference order: football pitch (confidence high), stadium outline (medium), generic pitch (low). Field-shaped plausibility filter: long side 60 to 400 m, aspect ratio at least 1.15. Sequential, 1 s pause, backoff on 429/503/504, raw Overpass responses cached in `data/cache/overpass/<venueId>.json` so reruns are free.
- Writes `data/generated/stadiums.json` (venueId, name, lat, lon, osmId, osmType, bearing 0..180, confidence, source, fetchedAt).
- `src/lib/stadiums.ts`: `fieldBearing(venueId)`, `compassToDegrees("NW")`, `axisLabel(bearing)` ("NE to SW"), `angleToAxis`, `windComponent(windFromDeg, bearing)` (within 30 degrees of perpendicular = crosswind, within 30 of the axis = down the field, else quartering), `componentPhrase`.
- `src/lib/nws.ts`: `VenueForWeather` gains optional `fieldBearing` and `fieldBearingConfidence`; `crosswind` is now computed from the NWS wind direction against the field bearing; new `windComponent`, `fieldBearing`, `fieldBearingConfidence` on `WeatherInput`. Calm wind or unknown bearing leaves `windComponent` undefined and `crosswind` false.
- `src/lib/slate.ts` passes the bearing into the forecast call. `src/lib/types.ts` gains the three optional `WeatherInput` fields.
- Game page Conditions section: one new line under the mono strip, for example "Wind NW 14 mph, mostly across the field (field runs NE to SW)." When the bearing came from a stadium outline rather than a mapped football pitch it says so. When no bearing is on file it says the crosswind call is unmeasured. Not shown for domes.
- `npm run ingest:stadiums` added. Ran once: STADIUM_NUMBERS

### 3. Weather baselines
- `scripts/ingest-climate.mjs` fetches five full years (2021 to 2025) of hourly temperature, 10 m wind, and precipitation from the free Open-Meteo archive for every Division I venue with coordinates, one call per venue, 2 s pause, backoff on 429/5xx, digest cached in `data/cache/climate/<venueId>.json`. The digest is per week of year (0..52) and per local hour bucket (noon to 4, 4 to 8, 8 to midnight): 10th/50th/90th percentile temperature, mean wind, sample hours, plus rainy-day count, day count, and the number of years in which that week had at least one rainy afternoon or evening (0.04 in or more between noon and midnight).
- Writes `data/generated/climate.json`.
- `src/lib/climate.ts`: `baseline(venueId, kickoffIso)` picks the week and hour bucket using the venue's own time zone; `compareToBaseline(weather, baseline)` ("warmer than usual", "windier than usual", "wetter than usual"); `baselineLine(baseline, weather?)`.
- `src/lib/slate.ts` sets `game.climate` for Division I games; `src/lib/types.ts` gains `Game.climate`.
- Game page Conditions section: "Typical for this stadium in early October in the late afternoon: 68 to 80 degrees, wind 7 mph, rain 1 year in 5. Today's forecast is windier than usual." Shown even when there is no NWS forecast (kickoff outside the 7-day window), without the comparison clause.
- `npm run ingest:climate` added. Ran once: CLIMATE_NUMBERS

## Files touched
New: `scripts/ingest-portal.mjs`, `scripts/ingest-stadiums.mjs`, `scripts/ingest-climate.mjs`, `scripts/verify-context.ts`, `src/lib/portal.ts`, `src/lib/stadiums.ts`, `src/lib/climate.ts`, `data/generated/portal.json`, `data/generated/stadiums.json`, `data/generated/climate.json`, `data/cache/` (raw caches and ingest logs).
Edited (additive only): `package.json` (three scripts), `src/lib/types.ts`, `src/lib/nws.ts`, `src/lib/slate.ts` (three imports, bearing passed to forecast, storylines, eye notes, climate field), `src/app/game/[id]/page.tsx` (two imports, two lines in Conditions).

## How to verify
```
npx tsc --noEmit
npx tsx scripts/verify-context.ts
```
The verify script prints `transfersBetween("Tennessee","UCLA")`, notable Tennessee arrivals, the bearing and wind-component table for Neyland, Bryant-Denny, Ohio Stadium, Michigan Stadium, Rose Bowl and Kyle Field, and early-October baselines for the same venues. Then open any Division I game page and read the Conditions section.

## Keys needed
Only `CFBD_API_KEY` (already present). Overpass and Open-Meteo need no key.

## Known gaps
GAPS

## Ideas
- Sideline choice at the coin toss: with the bearing plus wind direction we can say which end zone the wind favors in each quarter. Add "kick toward the NE end in the 1st and 4th" once we know which end is which (OSM ways are ordered, so the first vertex gives a fixed reference).
- Kicker radar: pair the crosswind flag with each kicker's season long and accuracy from `players.json` to flag "long field goals are off the table today" by name.
- Portal depth chart: `notableArrivals` is ready to power a "New faces" strip on the game page and a transfer-class grade on the team style section (rating-weighted count of arrivals vs departures).
- Departures hurt too: the same portal rows give "who left" per team; a departure-weighted note ("lost its top two receivers to the portal") is a one-function addition.
- Climate for the Record page: grade whether the weather tilt in the projection beats the baseline-only prior (did "windier than usual" games go under more often).
- Home field weather edge: compare each team's home baseline against the visitor's home baseline (a Florida team playing a late-November night game in Wisconsin is a measurable climate gap).
- Overpass raw cache is 288 small JSON files; a once-a-year rerun is enough since stadiums do not move. Consider committing `stadiums.json` and never rerunning in CI.
