/**
 * Weather baselines. For every Division I venue with coordinates, pull five
 * full years of hourly temperature, wind, and precipitation from the free
 * Open-Meteo archive (no key) and fold them into a per-week-of-year digest
 * so the game page can say what is typical for that stadium at that time.
 *
 *   node scripts/ingest-climate.mjs
 *
 * Writes data/generated/climate.json:
 *   [{ venueId, name, tz, years: [2021..2025], weeks: { "<0..52>": { h: { "12": [p10, p50, p90, windMean, n], "16": [...], "20": [...] },
 *      rainDays, days, rainYears } } }]
 *
 * Hour buckets are local time: "12" = noon to 3:59 pm, "16" = 4 to 7:59 pm, "20" = 8 to 11:59 pm.
 * Temps are Fahrenheit, wind is mph at 10 m, rain means at least 0.04 in (1 mm) between noon and midnight local.
 *
 * Open-Meteo is free and shared. Calls are sequential with a 2 s pause (a five-year hourly call is
 * weighted heavier than a short one), and each venue's digest is cached in data/cache/climate/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const CACHE = path.join(root, "data", "cache", "climate");
const BASE = "https://api.collegefootballdata.com";
const METEO = "https://archive-api.open-meteo.com/v1/archive";

async function loadKey() {
  if (process.env.CFBD_API_KEY) return process.env.CFBD_API_KEY;
  try {
    const env = await readFile(path.join(root, ".env.local"), "utf8");
    const m = env.match(/^CFBD_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return undefined;
}

const KEY = await loadKey();
if (!KEY) {
  console.error("ingest-climate: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cfbd(pathname, attempt = 0) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(2000 * (attempt + 1));
    return cfbd(pathname, attempt + 1);
  }
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
// Five complete calendar years before this season. The archive trails real time by a few days, so last season is the newest full year.
const YEARS = [season - 5, season - 4, season - 3, season - 2, season - 1];

/* ------------------------------------------------ Division I venue list */
const teams = await cfbd(`/teams?year=${season}`);
await sleep(500);
const venues = await cfbd(`/venues`);
await sleep(500);
const fbsGames = await cfbd(`/games?year=${season}&classification=fbs`);
await sleep(500);
const fcsGames = await cfbd(`/games?year=${season}&classification=fcs`);

const byId = new Map(venues.map((v) => [v.id, v]));
const ids = new Set();
for (const t of teams) if ((t.classification === "fbs" || t.classification === "fcs") && t.location?.id) ids.add(t.location.id);
for (const g of [...fbsGames, ...fcsGames]) if (g.venueId != null) ids.add(g.venueId);
const d1 = [...ids].map((id) => byId.get(id)).filter((v) => v && v.latitude != null && v.longitude != null);
const skipped = ids.size - d1.length;
log(`season ${season}: ${ids.size} Division I venue ids, ${d1.length} with coordinates, ${skipped} skipped (no coordinates). Years ${YEARS[0]} to ${YEARS[YEARS.length - 1]}`);

/* ------------------------------------------------------------ fetching */
async function archive(lat, lon, attempt = 0) {
  const u = new URL(METEO);
  u.searchParams.set("latitude", lat.toFixed(4));
  u.searchParams.set("longitude", lon.toFixed(4));
  u.searchParams.set("start_date", `${YEARS[0]}-01-01`);
  u.searchParams.set("end_date", `${YEARS[YEARS.length - 1]}-12-31`);
  u.searchParams.set("hourly", "temperature_2m,wind_speed_10m,precipitation");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("wind_speed_unit", "mph");
  u.searchParams.set("precipitation_unit", "inch");
  u.searchParams.set("timezone", "auto");
  let res;
  try {
    res = await fetch(u, { headers: { "User-Agent": "EdgeSheet/0.1 (stadium climate baselines)" } });
  } catch (e) {
    if (attempt < 5) {
      await sleep(5000 * (attempt + 1));
      return archive(lat, lon, attempt + 1);
    }
    throw e;
  }
  if (res.status === 429) {
    // Open-Meteo says which window was exceeded. A five-year hourly pull is weighted heavily, so the hourly
    // cap lands around 125 venues. Wait for the window to roll over instead of failing the rest of the list.
    const body = await res.text().catch(() => "");
    if (/daily/i.test(body)) throw new Error(`open-meteo daily limit exceeded; rerun tomorrow (cache keeps what is done): ${body.slice(0, 160)}`);
    if (/hourly/i.test(body)) {
      const now = new Date();
      const ms = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000 + 90000;
      log(`hourly limit hit; sleeping ${Math.round(ms / 60000)} min until the window resets`);
      await sleep(ms);
      return archive(lat, lon, attempt);
    }
    if (attempt < 8) {
      await sleep(70000);
      return archive(lat, lon, attempt + 1);
    }
    throw new Error(`open-meteo -> 429 ${body.slice(0, 160)}`);
  }
  if (res.status >= 500 && attempt < 5) {
    await sleep(15000 * (attempt + 1));
    return archive(lat, lon, attempt + 1);
  }
  if (!res.ok) throw new Error(`open-meteo -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* ----------------------------------------------------------- digesting */
const BUCKETS = ["12", "16", "20"];
const bucketFor = (h) => (h >= 20 ? "20" : h >= 16 ? "16" : "12");

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** Day of year 0-based, then week index 0..52 (week 52 is the stub of Dec 30 and 31). */
function weekIndex(y, m, d) {
  const start = Date.UTC(y, 0, 1);
  const day = Math.floor((Date.UTC(y, m - 1, d) - start) / 86400000);
  return Math.min(52, Math.floor(day / 7));
}

function digest(json) {
  const h = json.hourly;
  if (!h?.time?.length) return null;
  // week -> bucket -> { temps: [], wind: [] }; week -> day key -> rain inches (noon to midnight)
  const weeks = new Map();
  const dayRain = new Map();
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i]; // "2021-01-01T00:00" local
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const d = Number(t.slice(8, 10));
    const hr = Number(t.slice(11, 13));
    if (hr < 12) continue;
    const w = weekIndex(y, m, d);
    const temp = h.temperature_2m[i];
    const wind = h.wind_speed_10m[i];
    const rain = h.precipitation[i];
    if (!weeks.has(w)) weeks.set(w, { b: { 12: { t: [], w: [] }, 16: { t: [], w: [] }, 20: { t: [], w: [] } } });
    const wk = weeks.get(w);
    const bk = wk.b[bucketFor(hr)];
    if (temp != null) bk.t.push(temp);
    if (wind != null) bk.w.push(wind);
    const dk = `${w}|${y}|${m}|${d}`;
    dayRain.set(dk, (dayRain.get(dk) ?? 0) + (rain ?? 0));
  }
  const out = {};
  for (const [w, wk] of weeks) {
    const hb = {};
    for (const b of BUCKETS) {
      const ts = wk.b[b].t.slice().sort((a, c) => a - c);
      const ws = wk.b[b].w;
      if (!ts.length) continue;
      hb[b] = [
        Math.round(pct(ts, 0.1)),
        Math.round(pct(ts, 0.5)),
        Math.round(pct(ts, 0.9)),
        ws.length ? Math.round((ws.reduce((s, x) => s + x, 0) / ws.length) * 10) / 10 : null,
        ts.length,
      ];
    }
    let rainDays = 0, days = 0;
    const rainYears = new Set();
    for (const [dk, inches] of dayRain) {
      if (!dk.startsWith(`${w}|`)) continue;
      days++;
      if (inches >= 0.04) {
        rainDays++;
        rainYears.add(dk.split("|")[1]);
      }
    }
    out[w] = { h: hb, rainDays, days, rainYears: rainYears.size };
  }
  return out;
}

/* ----------------------------------------------------------------- run */
await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

const rows = [];
let fetched = 0, cached = 0, failed = 0;
for (const v of d1) {
  const cacheFile = path.join(CACHE, `${v.id}.json`);
  let row;
  if (existsSync(cacheFile)) {
    try {
      row = JSON.parse(await readFile(cacheFile, "utf8"));
      cached++;
    } catch {}
  }
  if (!row) {
    try {
      const json = await archive(v.latitude, v.longitude);
      const weeks = digest(json);
      if (!weeks) throw new Error("empty hourly series");
      row = { venueId: v.id, name: v.name, lat: v.latitude, lon: v.longitude, tz: json.timezone ?? null, years: YEARS, weeks, fetchedAt: new Date().toISOString() };
      await writeFile(cacheFile, JSON.stringify(row));
      fetched++;
    } catch (e) {
      failed++;
      log("fail", v.id, v.name, String(e.message ?? e));
      await sleep(5000);
      continue;
    }
    await sleep(2000);
  }
  rows.push(row);
  if ((fetched + cached) % 25 === 0) log(`${fetched + cached}/${d1.length} (${fetched} fetched, ${cached} cached)`);
}

rows.sort((a, b) => a.venueId - b.venueId);
await writeFile(path.join(OUT, "climate.json"), JSON.stringify(rows));
log(`wrote climate.json: ${rows.length} venues with a baseline, ${failed} failed, ${skipped} skipped for missing coordinates`);
