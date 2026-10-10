/**
 * Ingest season stats from ESPN box scores (free, no key).
 *
 * CollegeFootballData's free tier caps at 1,000 calls a month; once it is spent,
 * scripts/ingest.mjs keeps the old digests and the season stats freeze. This
 * script rebuilds the stat side of those digests from ESPN instead:
 *
 *   1. ESPN scoreboard, groups 80 (FBS) and 81 (FCS), every week played so far.
 *   2. The box score of every finished game (cached on disk under
 *      data/cache/espn-box/, so a rerun only fetches games it has not seen).
 *   3. data/generated/gamelogs.json rewritten in the same shape as
 *      scripts/ingest-gamelogs.mjs writes it.
 *   4. Season totals summed from those game lines and written into the `s`
 *      field of data/generated/players.json, with `g` set to the team's games
 *      played. Rosters, recruiting, and usage stay as CFBD last wrote them.
 *   5. meta.json gets ingestedAt = now (the "stats as of" stamp every page shows),
 *      statsSource "espn", and rosterIngestedAt keeps the CFBD roster time.
 *
 * ESPN athlete ids and event ids are the ids CFBD uses, so every join holds.
 *
 *   node scripts/ingest-espn.mjs
 *   SEASON=2026 node scripts/ingest-espn.mjs
 *
 * Needs data/generated/players.json (from scripts/ingest.mjs) for rosters.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAT_KEYS } from "./lib/digest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const CACHE = path.join(root, "data", "cache", "espn-box");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const GROUPS = { fbs: 80, fcs: 81 };

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
log("season", season);

async function getJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (res.ok) return await res.json();
    if (res.status === 404) return undefined;
    throw new Error(String(res.status));
  } catch (e) {
    if (attempt >= 3) {
      log("give up", url, e.message);
      return undefined;
    }
    await sleep(1000 * (attempt + 1));
    return getJson(url, attempt + 1);
  }
}

/* ------------------------------------------------------- rosters */
let players;
try {
  players = JSON.parse(await readFile(path.join(OUT, "players.json"), "utf8"));
} catch {
  console.error("ingest-espn: data/generated/players.json missing. Run npm run ingest first.");
  process.exit(0);
}
const byId = new Map(players.map((p) => [p.id, p]));
log("roster players", players.length);

/* ------------------------------------------------------- finished games */
const events = new Map(); // id -> { wk, st, cls }
for (const [cls, group] of Object.entries(GROUPS)) {
  for (let wk = 1; wk <= 16; wk++) {
    const sb = await getJson(`${BASE}/scoreboard?groups=${group}&seasontype=2&week=${wk}&dates=${season}&limit=400`);
    const evs = sb?.events ?? [];
    if (!evs.length) break;
    const done = evs.filter((e) => e.status?.type?.completed);
    for (const e of done) if (!events.has(e.id)) events.set(e.id, { wk, st: "regular", cls });
    // Weeks run in order; stop after the first week with nothing finished.
    if (!done.length) break;
  }
}
log("finished games", events.size);

/* ------------------------------------------------------- box scores */
await mkdir(CACHE, { recursive: true });
let fetched = 0;
let cached = 0;
async function box(id) {
  const f = path.join(CACHE, `${id}.json`);
  if (existsSync(f)) {
    cached++;
    return JSON.parse(await readFile(f, "utf8"));
  }
  const j = await getJson(`${BASE}/summary?event=${id}`);
  if (!j?.boxscore) return undefined;
  // Keep only what this script reads; full summaries run 300KB+.
  const slim = {
    header: { competitions: (j.header?.competitions ?? []).map((c) => ({ date: c.date, competitors: (c.competitors ?? []).map((t) => ({ id: t.id, homeAway: t.homeAway, score: t.score, team: { id: t.team?.id, location: t.team?.location } })) })) },
    boxscore: { players: (j.boxscore.players ?? []).map((t) => ({ team: { id: t.team?.id, location: t.team?.location }, statistics: (t.statistics ?? []).map((c) => ({ name: c.name, keys: c.keys, athletes: (c.athletes ?? []).map((a) => ({ id: a.athlete?.id, stats: a.stats })) })) })) },
  };
  await writeFile(f, JSON.stringify(slim));
  fetched++;
  return slim;
}

const ids = [...events.keys()];
const boxes = new Map();
const CONCURRENCY = 6;
for (let i = 0; i < ids.length; i += CONCURRENCY) {
  const chunk = ids.slice(i, i + CONCURRENCY);
  const got = await Promise.all(chunk.map((id) => box(id)));
  chunk.forEach((id, k) => got[k] && boxes.set(id, got[k]));
  if ((i / CONCURRENCY) % 20 === 0) log(`box scores ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length}`);
}
log("box scores", boxes.size, "fetched", fetched, "from cache", cached);

// Nothing new since the last run: leave the digests alone so the site's caches stay warm.
if (!fetched && !process.env.FORCE) {
  try {
    const prev = JSON.parse(await readFile(path.join(OUT, "meta.json"), "utf8"));
    if (prev.statsSource === "espn" && prev.statsGames === boxes.size) {
      log("no new finished games; digests unchanged");
      process.exit(0);
    }
  } catch {}
}

/* ------------------------------------------------------- stat mapping */
// ESPN box-score keys onto the compact keys in scripts/lib/digest.mjs STAT_KEYS.
// Pairs like "completions/passingAttempts" split into two keys.
const ESPN_KEYS = {
  passing: { "completions/passingAttempts": ["pc", "pa"], passingYards: "py", passingTouchdowns: "ptd", interceptions: "pint" },
  rushing: { rushingAttempts: "ra", rushingYards: "ry", rushingTouchdowns: "rtd", longRushing: "rlg" },
  receiving: { receptions: "rec", receivingYards: "rcy", receivingTouchdowns: "rctd", longReception: "rclg" },
  defensive: { totalTackles: "tk", soloTackles: "solo", tacklesForLoss: "tfl", sacks: "sk", passesDefended: "pd", hurries: "hur", QBHits: "hur", defensiveTouchdowns: "dtd" },
  interceptions: { interceptions: "int", interceptionYards: "inty" },
  fumbles: { fumbles: "fum", fumblesLost: "fl", fumblesRecovered: "fr" },
  kicking: { "fieldGoalsMade/fieldGoalAttempts": ["fgm", "fga"], longFieldGoalMade: "fglg" },
  punting: { punts: "pno", puntYards: "_puy", puntsInside20: "pin20" },
  kickReturns: { kickReturns: "_krn", kickReturnYards: "kry", kickReturnTouchdowns: "krtd" },
  puntReturns: { puntReturns: "_prn", puntReturnYards: "pry", puntReturnTouchdowns: "prtd" },
};
const LONGS = new Set(["rlg", "rclg", "fglg"]);
const valid = new Set(Object.values(STAT_KEYS));
for (const m of Object.values(ESPN_KEYS)) for (const k of Object.values(m).flat()) if (!k.startsWith("_") && !valid.has(k)) throw new Error(`unknown stat key ${k}`);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const r1 = (n) => Math.round(n * 10) / 10;

/** Fill rate stats (ypa, ypc, ypr, fgp, ypp, kravg, pravg) from counting stats, then drop helper keys. */
function finishRates(s) {
  if (s.pa) s.ypa = r1(s.py / s.pa);
  if (s.ra) s.ypc = r1(s.ry / s.ra);
  if (s.rec) s.ypr = r1(s.rcy / s.rec);
  if (s.fga) s.fgp = r1((100 * (s.fgm ?? 0)) / s.fga);
  if (s.pno) s.ypp = r1((s._puy ?? 0) / s.pno);
  if (s._krn) s.kravg = r1((s.kry ?? 0) / s._krn);
  if (s._prn) s.pravg = r1((s.pry ?? 0) / s._prn);
  for (const k of Object.keys(s)) if (k.startsWith("_")) delete s[k];
  return s;
}

/* ------------------------------------------------------- game logs */
const games = {};
const logs = {};
const teamGames = new Map(); // school -> games played
let lines = 0;

for (const [gid, b] of boxes) {
  const ev = events.get(gid);
  const comp = b.header.competitions[0];
  const sides = b.boxscore.players;
  if (!comp || sides.length !== 2) continue;

  // Name each side the way CFBD does: majority school of its athletes on the roster, else ESPN's location.
  const school = new Map();
  for (const side of sides) {
    const votes = new Map();
    for (const c of side.statistics) for (const a of c.athletes) {
      const p = byId.get(String(a.id));
      if (p) votes.set(p.t, (votes.get(p.t) ?? 0) + 1);
    }
    const best = [...votes].sort((x, y) => y[1] - x[1])[0];
    school.set(side.team.id, best?.[0] ?? side.team.location);
  }
  const home = comp.competitors.find((t) => t.homeAway === "home");
  const away = comp.competitors.find((t) => t.homeAway === "away");
  if (!home || !away) continue;
  const homeName = school.get(home.team.id) ?? home.team.location;
  const awayName = school.get(away.team.id) ?? away.team.location;
  games[gid] = { wk: ev.wk, st: ev.st, home: homeName, away: awayName, hp: num(home.score) ?? null, ap: num(away.score) ?? null, hc: null, ac: null };
  for (const n of [homeName, awayName]) teamGames.set(n, (teamGames.get(n) ?? 0) + 1);

  for (const side of sides) {
    const t = school.get(side.team.id);
    const ha = side.team.id === home.team.id ? "home" : "away";
    const opp = ha === "home" ? awayName : homeName;
    const per = new Map();
    for (const c of side.statistics) {
      const map = ESPN_KEYS[c.name];
      if (!map) continue;
      for (const a of c.athletes) {
        const id = String(a.id);
        if (!byId.has(id)) continue;
        const s = per.get(id) ?? per.set(id, {}).get(id);
        (c.keys ?? []).forEach((k, i) => {
          const dest = map[k];
          if (!dest) return;
          if (Array.isArray(dest)) {
            String(a.stats?.[i] ?? "").split("/").map(num).forEach((v, j) => v !== undefined && (s[dest[j]] = v));
          } else {
            const v = num(a.stats?.[i]);
            if (v !== undefined && s[dest] === undefined) s[dest] = v;
          }
        });
      }
    }
    for (const [id, s] of per) {
      if (!Object.keys(s).length) continue;
      (logs[id] ??= []).push({ g: gid, wk: ev.wk, st: ev.st, t, opp, ha, s });
      lines++;
    }
  }
}
// Classification per side, filled once the whole roster is indexed.
const clsBySchool = new Map();
for (const p of players) if (p.c && !clsBySchool.has(p.t)) clsBySchool.set(p.t, p.c);
for (const g of Object.values(games)) {
  g.hc = clsBySchool.get(g.home) ?? null;
  g.ac = clsBySchool.get(g.away) ?? null;
}
for (const list of Object.values(logs)) list.sort((a, b) => a.wk - b.wk);

/* ------------------------------------------------------- season totals */
let updated = 0;
for (const [id, list] of Object.entries(logs)) {
  const p = byId.get(id);
  const tot = {};
  for (const line of list) {
    for (const [k, v] of Object.entries(line.s)) {
      if (LONGS.has(k)) tot[k] = Math.max(tot[k] ?? v, v);
      else tot[k] = (tot[k] ?? 0) + v;
    }
  }
  p.s = finishRates(tot);
  updated++;
}
// Strip the helper keys from the per-game lines too, and give each line its own rates.
for (const list of Object.values(logs)) for (const line of list) finishRates(line.s);
for (const p of players) {
  const g = teamGames.get(p.t);
  if (g) p.g = g;
}
log("players with ESPN season lines", updated, "game lines", lines);

/* ------------------------------------------------------- write */
const now = new Date().toISOString();
let meta = {};
try {
  meta = JSON.parse(await readFile(path.join(OUT, "meta.json"), "utf8"));
} catch {}
const weeks = [...new Set([...events.values()].map((e) => `${e.st}:${e.wk}`))].sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
meta = { ...meta, rosterIngestedAt: meta.rosterIngestedAt ?? meta.ingestedAt ?? null, ingestedAt: now, statsSource: "espn", statsGames: boxes.size, statsWeeks: weeks };

await writeFile(path.join(OUT, "players.json"), JSON.stringify(players));
await writeFile(
  path.join(OUT, "gamelogs.json"),
  JSON.stringify({ meta: { ingestedAt: now, season, weeks, games: Object.keys(games).length, players: Object.keys(logs).length, lines, source: "espn" }, games, players: logs }),
);
await writeFile(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
log("wrote players.json, gamelogs.json, meta.json", { games: Object.keys(games).length, weeks: weeks.join(" ") });
