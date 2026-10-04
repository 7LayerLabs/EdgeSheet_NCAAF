/**
 * Ingest game logs: pull CollegeFootballData /games/players for every week
 * played so far this season (FBS and FCS, sequential with backoff) and write a
 * compact per-player game log. The site reads the digest; nothing here is
 * fetched at request time.
 *
 *   node scripts/ingest-gamelogs.mjs            # CFBD_API_KEY from .env.local or the environment
 *   SEASON=2026 WEEKS=1,2,3 node scripts/ingest-gamelogs.mjs
 *
 * Writes data/generated/gamelogs.json:
 *   meta     ingest time, season, weeks pulled, game and player counts
 *   games    per game id: week, season type, home, away, points, classification of each side
 *   players  per CFBD athlete id: array of game lines
 *            { g: gameId, wk: week, st: seasonType, t: team, opp: opponent, ha: "home" | "away", s: stats }
 *            stats use the same compact keys as scripts/lib/digest.mjs STAT_KEYS (py, ptd, ry, rec, tk, sk, ...).
 *
 * Only players in data/generated/players.json are kept, so run scripts/ingest.mjs first.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, makeGet, STAT_KEYS } from "./lib/digest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");

const KEY = await loadKey(root);
if (!KEY) {
  console.error("ingest-gamelogs: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const get = makeGet(KEY, log, { pause: 1200, retries: 6 });

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
log("season", season);

/* ------------------------------------------------------- roster filter */
let known = new Set();
let teamClass = new Map();
try {
  const players = JSON.parse(await readFile(path.join(OUT, "players.json"), "utf8"));
  known = new Set(players.map((p) => p.id));
  for (const p of players) if (p.c && !teamClass.has(p.t)) teamClass.set(p.t, p.c);
  log("known players", known.size);
} catch {
  log("players.json missing; keeping every athlete with a stat line");
}

/* ------------------------------------------------------- which weeks */
const calendar = await get(`/calendar?year=${season}`);
const now = Date.now();
let weeks = calendar
  .filter((w) => new Date(w.startDate ?? w.firstGameStart).getTime() <= now)
  .map((w) => ({ week: w.week, seasonType: w.seasonType }));
if (process.env.WEEKS) {
  const want = new Set(process.env.WEEKS.split(",").map((s) => Number(s.trim())));
  weeks = weeks.filter((w) => want.has(w.week));
}
log("weeks", weeks.map((w) => `${w.seasonType[0]}${w.week}`).join(" "));

/* ------------------------------------------------------- stat mapping */
// games/players uses box-score type names. Map them onto the season-stat compact keys.
const BOX_KEYS = {
  passing: { YDS: "py", TD: "ptd", INT: "pint", AVG: "ypa" },
  rushing: { CAR: "ra", YDS: "ry", TD: "rtd", AVG: "ypc", LONG: "rlg" },
  receiving: { REC: "rec", YDS: "rcy", TD: "rctd", AVG: "ypr", LONG: "rclg" },
  defensive: { TOT: "tk", SOLO: "solo", TFL: "tfl", SACKS: "sk", PD: "pd", "QB HUR": "hur", TD: "dtd" },
  interceptions: { INT: "int", YDS: "inty" },
  fumbles: { FUM: "fum", LOST: "fl", REC: "fr" },
  kicking: { LONG: "fglg", PCT: "fgp" },
  punting: { NO: "pno", AVG: "ypp", "In 20": "pin20" },
  kickReturns: { YDS: "kry", TD: "krtd", AVG: "kravg" },
  puntReturns: { YDS: "pry", TD: "prtd", AVG: "pravg" },
};
// Sanity: every compact key we emit exists in the shared STAT_KEYS table.
const valid = new Set(Object.values(STAT_KEYS));
for (const m of Object.values(BOX_KEYS)) for (const k of Object.values(m)) if (!valid.has(k)) throw new Error(`unknown stat key ${k}`);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** One athlete's stats inside a category, as compact keys. Handles the "x/y" pairs. */
function mapStats(category, raw) {
  const out = {};
  const map = BOX_KEYS[category] ?? {};
  for (const [type, v] of Object.entries(raw)) {
    if (category === "passing" && type === "C/ATT") {
      const [c, a] = String(v).split("/").map(num);
      if (c !== undefined) out.pc = c;
      if (a !== undefined) out.pa = a;
      continue;
    }
    if (category === "kicking" && type === "FG") {
      const [m, a] = String(v).split("/").map(num);
      if (m !== undefined) out.fgm = m;
      if (a !== undefined) out.fga = a;
      continue;
    }
    const key = map[type];
    if (!key) continue;
    const n = num(v);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

/* ------------------------------------------------------------- pull */
const games = {};
const players = {};
let kept = 0;
for (const w of weeks) {
  for (const cls of ["fbs", "fcs"]) {
    const rows = await get(`/games/players?year=${season}&week=${w.week}&seasonType=${w.seasonType}&classification=${cls}`, { optional: true });
    log(`week ${w.seasonType[0]}${w.week} ${cls}: ${rows.length} games`);
    for (const raw of rows) {
      const gid = String(raw.id);
      if (games[gid]) continue; // FBS vs FCS games show up under both classifications
      if (!raw.teams || raw.teams.length !== 2) continue;
      const home = raw.teams.find((t) => t.homeAway === "home") ?? raw.teams[0];
      const away = raw.teams.find((t) => t.homeAway === "away") ?? raw.teams[1];
      games[gid] = {
        wk: w.week,
        st: w.seasonType,
        home: home.team,
        away: away.team,
        hp: home.points ?? null,
        ap: away.points ?? null,
        hc: teamClass.get(home.team) ?? null,
        ac: teamClass.get(away.team) ?? null,
      };
      for (const side of raw.teams) {
        const opp = side === home ? away.team : home.team;
        const perPlayer = new Map();
        for (const cat of side.categories ?? []) {
          const byId = new Map();
          for (const type of cat.types ?? []) {
            for (const a of type.athletes ?? []) {
              const id = String(a.id);
              if (known.size && !known.has(id)) continue;
              const e = byId.get(id) ?? byId.set(id, {}).get(id);
              e[type.name] = a.stat;
            }
          }
          for (const [id, raw] of byId) {
            const s = mapStats(cat.name, raw);
            if (!Object.keys(s).length) continue;
            const e = perPlayer.get(id) ?? perPlayer.set(id, {}).get(id);
            Object.assign(e, s);
          }
        }
        for (const [id, s] of perPlayer) {
          (players[id] ??= []).push({ g: gid, wk: w.week, st: w.seasonType, t: side.team, opp, ha: side.homeAway, s });
          kept++;
        }
      }
    }
  }
}
for (const list of Object.values(players)) list.sort((a, b) => a.wk - b.wk);

await mkdir(OUT, { recursive: true });
const meta = {
  ingestedAt: new Date().toISOString(),
  season,
  weeks: weeks.map((w) => `${w.seasonType}:${w.week}`),
  games: Object.keys(games).length,
  players: Object.keys(players).length,
  lines: kept,
};
await writeFile(path.join(OUT, "gamelogs.json"), JSON.stringify({ meta, games, players }));
log("wrote gamelogs.json", meta);
