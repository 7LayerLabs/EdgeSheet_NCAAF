/**
 * This season's Elo, built from our own fitted rule (scripts/lib/elo.mjs) because CFBD's
 * pregame Elo stops arriving when the free monthly quota runs out.
 *
 *   seed     last season's end (CFBD's last real ratings + our update for that game + bowls),
 *            regressed toward the mean with the fitted carryover. New FBS teams start at 1500.
 *   season   every finished FBS-vs-FBS game this season from ESPN scoreboards, in kickoff order.
 *
 * Writes data/generated/elo.json:
 *   ratings   CFBD school name -> current rating
 *   byId      ESPN/CFBD team id -> school name (same ids in both)
 *   games     game id -> { h, a } pregame ratings, for every finished game with an FBS side
 *
 * Validated in scripts/elo-check.mjs: a cold start like this one stays within 0.5 to 0.7 spread
 * points of CFBD's own ratings all season, and the model's opener edge holds (57.4% on 5+ point
 * leans, 2023 to 2025) with these ratings in place of CFBD's.
 *
 *   node scripts/ingest-elo.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELO, NEW_TEAM, applyGame, carryOver, seasonEnd } from "./lib/elo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const CACHE = path.join(root, "data", "cache", "edge-study");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
const prev = season - 1;
const log = (...a) => console.log("[elo]", ...a);
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
await mkdir(CACHE, { recursive: true });

async function getJson(url, cacheName) {
  const f = cacheName && path.join(CACHE, cacheName);
  if (f && existsSync(f)) return readJson(f);
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const j = await res.json();
        if (f) await writeFile(f, JSON.stringify(j));
        return j;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return undefined;
}

/* ------------------------------------------------ last season's end */
const prevDir = path.join(root, "data", "backtest", String(prev));
if (!existsSync(path.join(prevDir, "games.json"))) {
  console.error(`ingest-elo: data/backtest/${prev}/games.json missing (run scripts/backtest.mjs once). Nothing written.`);
  process.exit(0);
}
const prevGames = await readJson(path.join(prevDir, "games.json"));
const prevFbs = new Set();
for (const g of prevGames) {
  if (g.hc === "fbs") prevFbs.add(g.home);
  if (g.ac === "fbs") prevFbs.add(g.away);
}
// ESPN team id -> CFBD school, joined on shared event ids (finished seasons are cached for good).
const idToSchool = new Map();
const prevById = new Map(prevGames.map((g) => [g.id, g]));
for (let wk = 1; wk <= 16; wk++) {
  const sb = await getJson(`${BASE}?groups=80&seasontype=2&week=${wk}&dates=${prev}&limit=400`, `sb-${prev}-${wk}.json`);
  for (const e of sb?.events ?? []) {
    const g = prevById.get(Number(e.id));
    if (!g) continue;
    for (const c of e.competitions?.[0]?.competitors ?? []) idToSchool.set(c.team.id, c.homeAway === "home" ? g.home : g.away);
  }
}
const bowls = [];
for (let wk = 1; wk <= 5; wk++) {
  const sb = await getJson(`${BASE}?groups=80&seasontype=3&week=${wk}&dates=${prev}&limit=400`, `sb-${prev}-post-${wk}.json`);
  for (const e of sb?.events ?? []) {
    const c = e.competitions?.[0];
    if (!c?.status?.type?.completed || bowls.some((b) => b.id === e.id)) continue;
    const h = c.competitors.find((x) => x.homeAway === "home");
    const a = c.competitors.find((x) => x.homeAway === "away");
    const hs = idToSchool.get(h?.team.id);
    const as = idToSchool.get(a?.team.id);
    if (hs && as) bowls.push({ id: e.id, start: e.date, home: hs, away: as, hp: Number(h.score), ap: Number(a.score), neutral: Boolean(c.neutralSite) });
  }
}
const ratings = carryOver(seasonEnd(prevGames, prevFbs, bowls));
log(`seed from ${prev}: ${ratings.size} teams, ${bowls.length} bowls applied`);

/* ------------------------------------------------ this season */
// FBS membership this season from the CFBD roster ingest (classification per school).
const fbsNow = new Set();
try {
  for (const p of await readJson(path.join(OUT, "players.json"))) if (p.c === "fbs") fbsNow.add(p.t);
} catch {}
if (!fbsNow.size) for (const t of ratings.keys()) fbsNow.add(t);
for (const t of fbsNow) if (!ratings.has(t)) {
  ratings.set(t, NEW_TEAM);
  log(`new to FBS, seeded at ${NEW_TEAM}: ${t}`);
}

const events = [];
for (let wk = 1; wk <= 16; wk++) {
  const sb = await getJson(`${BASE}?groups=80&seasontype=2&week=${wk}&dates=${season}&limit=400`);
  const evs = sb?.events ?? [];
  if (!evs.length) break;
  for (const e of evs) events.push(e);
  if (!evs.some((e) => e.status?.type?.completed)) break;
}
// Unknown ESPN ids (teams new this season) fall back to ESPN's location, which matches CFBD for most schools.
const schoolOf = (team) => idToSchool.get(team.id) ?? team.location;
const games = {};
let rated = 0;
const done = events.filter((e) => e.status?.type?.completed).sort((a, b) => a.date.localeCompare(b.date));
for (const e of done) {
  const c = e.competitions[0];
  const h = c.competitors.find((x) => x.homeAway === "home");
  const a = c.competitors.find((x) => x.homeAway === "away");
  const g = { home: schoolOf(h.team), away: schoolOf(a.team), hp: Number(h.score), ap: Number(a.score), neutral: Boolean(c.neutralSite) };
  for (const x of [h.team, a.team]) if (!idToSchool.has(x.id)) idToSchool.set(x.id, schoolOf(x));
  const pre = applyGame(ratings, g, (t) => fbsNow.has(t) && ratings.has(t));
  if (pre) {
    rated++;
    games[e.id] = { h: Math.round(pre.h), a: Math.round(pre.a) };
  } else {
    // One FBS side against FCS: record its rating so the game page can show it; nothing changes.
    games[e.id] = { h: ratings.has(g.home) ? Math.round(ratings.get(g.home)) : null, a: ratings.has(g.away) ? Math.round(ratings.get(g.away)) : null };
  }
}
log(`${season}: ${done.length} finished games, ${rated} FBS-vs-FBS rated`);

await mkdir(OUT, { recursive: true });
const out = {
  asOf: new Date().toISOString(),
  season,
  source: "EdgeSheet Elo (scripts/lib/elo.mjs), fitted to CFBD",
  params: ELO,
  ratings: Object.fromEntries([...ratings].filter(([t]) => fbsNow.has(t)).sort((x, y) => y[1] - x[1]).map(([t, r]) => [t, Math.round(r)])),
  byId: Object.fromEntries([...idToSchool].filter(([, t]) => fbsNow.has(t))),
  games,
};
await writeFile(path.join(OUT, "elo.json"), JSON.stringify(out));
const top = Object.entries(out.ratings).slice(0, 8).map(([t, r]) => `${t} ${r}`).join(", ");
log(`wrote elo.json: ${Object.keys(out.ratings).length} teams. Top: ${top}`);
