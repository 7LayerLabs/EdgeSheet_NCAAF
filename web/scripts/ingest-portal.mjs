/**
 * Transfer portal ingest. Pulls CollegeFootballData /player/portal for the
 * current season and the one before, matches each row to the ingested roster
 * (players.json) by name and destination school, and writes a compact digest.
 *
 *   node scripts/ingest-portal.mjs
 *
 * Writes data/generated/portal.json:
 *   [{ id, name, position, origin, destination, stars, rating, eligibility, transferDate, season, onRoster }]
 *
 * `id` is the CFBD athlete id when the player is on the destination's ingested roster, otherwise null.
 * The portal endpoint has no athlete id of its own, so the match is name + school.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const BASE = "https://api.collegefootballdata.com";

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
  console.error("ingest-portal: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, attempt = 0) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(2000 * (attempt + 1));
    return get(pathname, attempt + 1);
  }
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
const seasons = [season - 1, season];
log("seasons", seasons.join(", "));

let roster = [];
try {
  roster = JSON.parse(await readFile(path.join(OUT, "players.json"), "utf8"));
} catch {
  log("players.json not found; rows will carry no athlete id. Run npm run ingest first for roster matching.");
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

// name|school -> [player]
const byNameSchool = new Map();
for (const p of roster) {
  const k = `${norm(p.n)}|${norm(p.t)}`;
  byNameSchool.set(k, [...(byNameSchool.get(k) ?? []), p]);
}

const rows = [];
for (const y of seasons) {
  const list = await get(`/player/portal?year=${y}`);
  log("portal", y, list.length, "rows");
  for (const r of list) {
    const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    const dest = r.destination ?? null;
    const hits = dest ? byNameSchool.get(`${norm(name)}|${norm(dest)}`) ?? [] : [];
    // Prefer a position match when the roster has two players with the same name at the school.
    const hit = hits.length > 1 ? hits.find((p) => p.p === r.position) ?? hits[0] : hits[0];
    rows.push({
      id: hit ? String(hit.id) : null,
      name,
      position: r.position ?? null,
      origin: r.origin ?? null,
      destination: dest,
      stars: r.stars ?? null,
      rating: r.rating ?? null,
      eligibility: r.eligibility ?? null,
      transferDate: r.transferDate ?? null,
      season: y,
      onRoster: Boolean(hit),
    });
  }
  await sleep(800);
}

// A player can appear in both seasons (entered 2025, entered again 2026). Keep every row; the lib dedupes by name on read.
rows.sort((a, b) => (b.season - a.season) || ((b.rating ?? 0) - (a.rating ?? 0)) || ((b.stars ?? 0) - (a.stars ?? 0)));

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "portal.json"), JSON.stringify(rows));
const matched = rows.filter((r) => r.onRoster).length;
const withDest = rows.filter((r) => r.destination).length;
log(`wrote portal.json: ${rows.length} rows, ${withDest} with a destination, ${matched} matched to the ingested roster`);
