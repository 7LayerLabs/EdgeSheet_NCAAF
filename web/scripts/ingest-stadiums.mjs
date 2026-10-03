/**
 * Stadium orientation ingest. For every Division I venue (FBS and FCS home
 * fields plus every venue used by a Division I game this season) ask
 * OpenStreetMap's Overpass API for the nearest american-football pitch or
 * stadium outline within 400 m, and compute the bearing of its long axis
 * (the direction the field runs).
 *
 *   node scripts/ingest-stadiums.mjs
 *
 * Writes data/generated/stadiums.json:
 *   [{ venueId, name, lat, lon, osmId, osmType, bearing, confidence, source, fetchedAt }]
 *
 * bearing is 0..180 degrees (an axis has two headings; 45 means the field runs NE to SW).
 * confidence: "high" = a sport=american_football way, "medium" = a leisure=stadium outline,
 * "low" = a generic pitch, "none" = nothing found (bearing null).
 *
 * Overpass is a free shared service. Calls are sequential with a 1 s pause, and
 * results are cached in data/cache/overpass/<venueId>.json so a rerun is free.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const CACHE = path.join(root, "data", "cache", "overpass");
const BASE = "https://api.collegefootballdata.com";
const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const RADIUS = 400;

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
  console.error("ingest-stadiums: CFBD_API_KEY missing. Nothing written.");
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
log(`season ${season}: ${ids.size} Division I venue ids, ${d1.length} with coordinates`);

/* ------------------------------------------------------------ geometry */
/** Equirectangular projection to meters around a reference point. Good enough at stadium scale. */
function project(points, lat0, lon0) {
  const R = 6371000;
  const k = Math.cos((lat0 * Math.PI) / 180);
  return points.map((p) => ({ x: ((p.lon - lon0) * Math.PI / 180) * R * k, y: ((p.lat - lat0) * Math.PI / 180) * R }));
}

/** Long-axis bearing via the minimum-area bounding rectangle over polygon edges (robust for rectangles and ovals). */
function longAxisBearing(points) {
  if (points.length < 3) return null;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const pts = project(points, lat0, lon0);
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 0.5) continue;
    const ux = ex / len;
    const uy = ey / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (!best || area < best.area) {
      // Long axis is along u if w >= h, else along v (perpendicular to the edge).
      const ax = w >= h ? ux : -uy;
      const ay = w >= h ? uy : ux;
      best = { area, ax, ay, long: Math.max(w, h), short: Math.min(w, h) };
    }
  }
  if (!best) return null;
  // Compass bearing: 0 = north (y), 90 = east (x). Fold to 0..180 since an axis has no direction.
  let deg = (Math.atan2(best.ax, best.ay) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return { bearing: Math.round(deg), long: Math.round(best.long), short: Math.round(best.short) };
}

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------- overpass */
async function overpass(lat, lon, attempt = 0) {
  // One spatial scan per venue (pitches and stadiums together); the pick order is applied in code. Overpass
  // throttles on server runtime per IP, so fewer clauses means far fewer cooldowns.
  const q = `[out:json][timeout:25];
nwr["leisure"~"^(pitch|stadium)$"](around:${RADIUS},${lat},${lon});
out geom;`;
  let res;
  try {
    res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "EdgeSheet/0.1 (stadium orientation; contact via repo)" },
      body: `data=${encodeURIComponent(q)}`,
    });
  } catch (e) {
    if (attempt < 5) {
      await sleep(5000 * (attempt + 1));
      return overpass(lat, lon, attempt + 1);
    }
    throw e;
  }
  if ((res.status === 429 || res.status === 504 || res.status === 503) && attempt < 5) {
    await sleep(10000 * (attempt + 1));
    return overpass(lat, lon, attempt + 1);
  }
  if (!res.ok) throw new Error(`overpass -> ${res.status}`);
  return res.json();
}

/** Flatten ways and relation outer rings into candidate polygons. */
function candidates(json, lat, lon) {
  const out = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const isFootball = /american_football/.test(tags.sport ?? "");
    const kind = tags.leisure === "stadium" ? "stadium" : "pitch";
    const rings = [];
    if (el.type === "way" && el.geometry?.length >= 3) rings.push(el.geometry);
    if (el.type === "relation") {
      for (const m of el.members ?? []) if (m.role !== "inner" && m.geometry?.length >= 3) rings.push(m.geometry);
    }
    for (const g of rings) {
      const axis = longAxisBearing(g);
      if (!axis) continue;
      const cLat = g.reduce((s, p) => s + p.lat, 0) / g.length;
      const cLon = g.reduce((s, p) => s + p.lon, 0) / g.length;
      out.push({
        osmId: el.id,
        osmType: el.type,
        kind,
        isFootball,
        bearing: axis.bearing,
        long: axis.long,
        short: axis.short,
        dist: distanceM(lat, lon, cLat, cLon),
        name: tags.name ?? null,
      });
    }
  }
  return out;
}

/** Football pitch first (closest), then stadium outline (closest, plausibly field-shaped), then any pitch. */
function pick(cands) {
  const ok = (c) => c.long >= 60 && c.long <= 400 && c.short >= 30 && c.long / Math.max(1, c.short) >= 1.15;
  const football = cands.filter((c) => c.isFootball && ok(c)).sort((a, b) => a.dist - b.dist);
  if (football.length) return { ...football[0], confidence: "high" };
  const stadium = cands.filter((c) => c.kind === "stadium" && ok(c)).sort((a, b) => a.dist - b.dist);
  if (stadium.length) return { ...stadium[0], confidence: "medium" };
  const pitch = cands.filter((c) => c.kind === "pitch" && ok(c)).sort((a, b) => a.dist - b.dist);
  if (pitch.length) return { ...pitch[0], confidence: "low" };
  return null;
}

/* ----------------------------------------------------------------- run */
await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

const rows = [];
let fetched = 0, cached = 0, failed = 0;
for (const v of d1) {
  const cacheFile = path.join(CACHE, `${v.id}.json`);
  let json;
  if (existsSync(cacheFile)) {
    try {
      json = JSON.parse(await readFile(cacheFile, "utf8"));
      cached++;
    } catch {}
  }
  if (!json) {
    try {
      json = await overpass(v.latitude, v.longitude);
      await writeFile(cacheFile, JSON.stringify(json));
      fetched++;
    } catch (e) {
      failed++;
      log("fail", v.id, v.name, String(e.message ?? e));
      rows.push({ venueId: v.id, name: v.name, lat: v.latitude, lon: v.longitude, osmId: null, osmType: null, bearing: null, confidence: "none", source: "error", fetchedAt: new Date().toISOString() });
      await sleep(3000);
      continue;
    }
    await sleep(1000);
  }
  const best = pick(candidates(json, v.latitude, v.longitude));
  rows.push({
    venueId: v.id,
    name: v.name,
    lat: v.latitude,
    lon: v.longitude,
    osmId: best?.osmId ?? null,
    osmType: best?.osmType ?? null,
    bearing: best?.bearing ?? null,
    confidence: best?.confidence ?? "none",
    source: best ? `osm ${best.kind}${best.isFootball ? " american_football" : ""} ${Math.round(best.dist)} m, ${best.long}x${best.short} m` : "no polygon within 400 m",
    fetchedAt: new Date().toISOString(),
  });
  if ((fetched + cached) % 25 === 0) log(`${fetched + cached}/${d1.length} (${fetched} fetched, ${cached} cached)`);
}

rows.sort((a, b) => a.venueId - b.venueId);
await writeFile(path.join(OUT, "stadiums.json"), JSON.stringify(rows));
const count = (c) => rows.filter((r) => r.confidence === c).length;
log(`wrote stadiums.json: ${rows.length} venues, bearing for ${rows.filter((r) => r.bearing != null).length} (high ${count("high")}, medium ${count("medium")}, low ${count("low")}), none ${count("none")}, errors ${failed}`);
