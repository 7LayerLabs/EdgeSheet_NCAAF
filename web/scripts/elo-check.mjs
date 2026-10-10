/**
 * Validate scripts/lib/elo.mjs against CFBD's real pregame Elo, 2022 to 2025.
 *
 *   1. In-season: seed every team with its real week-1 rating, run the season forward with our
 *      rule, and compare our pregame ratings to CFBD's on every FBS game from week 4.
 *   2. Offseason: fit next-season week-1 rating = CARRY * end + (1 - CARRY) * MEAN, where `end`
 *      is the last real pregame rating plus our update for that game and for its bowl (ESPN).
 *   3. Cold start, the 2026 situation: seed season S from season S-1's end with the fitted
 *      carryover and run S entirely on our rule. Compare to CFBD.
 *
 * Writes data/backtest/elo-sim.json: { [season]: { [gameId]: { h, a } } } from the cold start,
 * which scripts/edge-study.mjs uses with ELO_SOURCE=ours.
 *
 *   node scripts/elo-check.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELO, applyGame, carryOver } from "./lib/elo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BT = path.join(root, "data", "backtest");
const CACHE = path.join(root, "data", "cache", "edge-study");
const SEASONS = [2022, 2023, 2024, 2025];
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
await mkdir(CACHE, { recursive: true });

async function cachedJson(name, url) {
  const f = path.join(CACHE, name);
  if (existsSync(f)) return readJson(f);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return undefined;
  const j = await res.json();
  await writeFile(f, JSON.stringify(j));
  return j;
}

const data = {};
for (const s of SEASONS) {
  const games = (await readJson(path.join(BT, String(s), "games.json"))).filter((g) => g.completed && g.hp != null).sort((a, b) => a.start.localeCompare(b.start));
  const fbs = new Set();
  for (const g of games) {
    if (g.hc === "fbs") fbs.add(g.home);
    if (g.ac === "fbs") fbs.add(g.away);
  }
  // ESPN team id -> CFBD school, joined through the shared event ids of the regular season.
  const idToSchool = new Map();
  const byId = new Map(games.map((g) => [g.id, g]));
  for (let wk = 1; wk <= 16; wk++) {
    const sb = await cachedJson(`sb-${s}-${wk}.json`, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&seasontype=2&week=${wk}&dates=${s}&limit=400`);
    for (const e of sb?.events ?? []) {
      const g = byId.get(Number(e.id));
      if (!g) continue;
      for (const c of e.competitions?.[0]?.competitors ?? []) idToSchool.set(c.team.id, c.homeAway === "home" ? g.home : g.away);
    }
  }
  // Bowls and playoff games (postseason), mapped to CFBD names.
  const bowls = [];
  for (let wk = 1; wk <= 5; wk++) {
    const sb = await cachedJson(`sb-${s}-post-${wk}.json`, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&seasontype=3&week=${wk}&dates=${s}&limit=400`);
    for (const e of sb?.events ?? []) {
      const c = e.competitions?.[0];
      if (!c?.status?.type?.completed) continue;
      const home = c.competitors.find((x) => x.homeAway === "home");
      const away = c.competitors.find((x) => x.homeAway === "away");
      const hs = idToSchool.get(home?.team.id);
      const as = idToSchool.get(away?.team.id);
      if (!hs || !as) continue;
      if (bowls.some((b) => b.id === e.id)) continue;
      bowls.push({ id: e.id, start: e.date, home: hs, away: as, hp: Number(home.score), ap: Number(away.score), neutral: Boolean(c.neutralSite) });
    }
  }
  bowls.sort((a, b) => a.start.localeCompare(b.start));
  data[s] = { games, fbs, bowls };
  console.log(`${s}: ${games.length} games, ${fbs.size} FBS teams, ${bowls.length} postseason games mapped`);
}

const ptsDiffErr = (simH, simA, g) => Math.abs((simH - simA) - (g.hElo - g.aElo)) / ELO.POINTS;

/* 1. In-season, real week-1 seed */
{
  const out = {};
  for (const s of SEASONS) {
    const { games, fbs } = data[s];
    const ratings = new Map();
    let n = 0, eloErr = 0, ptsErr = 0;
    for (const g of games) {
      for (const [t, r] of [[g.home, g.hElo], [g.away, g.aElo]]) if (r != null && !ratings.has(t)) ratings.set(t, r);
      const pre = applyGame(ratings, g, (t) => fbs.has(t));
      if (pre && g.wk >= 4 && g.hElo != null && g.aElo != null) {
        n++;
        eloErr += (Math.abs(pre.h - g.hElo) + Math.abs(pre.a - g.aElo)) / 2;
        ptsErr += ptsDiffErr(pre.h, pre.a, g);
      }
    }
    out[s] = { games: n, eloMae: +(eloErr / n).toFixed(1), spreadPointsMae: +(ptsErr / n).toFixed(2) };
  }
  console.log("1. in-season from real week-1 ratings", out);
}

/* 2. Offseason carryover fit */
function endOfSeason(s) {
  // Last real pregame rating per team, then our update for that game, then bowls.
  const { games, fbs, bowls } = data[s];
  const last = new Map();
  for (const g of games) {
    if (g.hElo != null) last.set(g.home, { g, side: "home" });
    if (g.aElo != null) last.set(g.away, { g, side: "away" });
  }
  const ratings = new Map();
  for (const [t, { g }] of last) {
    const tmp = new Map([[g.home, g.hElo], [g.away, g.aElo]]);
    applyGame(tmp, g, (x) => tmp.get(x) != null && fbs.has(x));
    ratings.set(t, tmp.get(t));
  }
  for (const b of bowls) applyGame(ratings, b, (x) => ratings.has(x));
  return ratings;
}
const pairs = [];
for (const s of SEASONS.slice(1)) {
  const end = endOfSeason(s - 1);
  const first = new Map();
  for (const g of data[s].games) {
    if (g.hElo != null && !first.has(g.home)) first.set(g.home, g.hElo);
    if (g.aElo != null && !first.has(g.away)) first.set(g.away, g.aElo);
  }
  for (const [t, r] of first) if (end.has(t)) pairs.push([end.get(t), r]);
}
{
  const n = pairs.length;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const mean = intercept / (1 - slope);
  let err = 0;
  for (const [x, y] of pairs) err += Math.abs(slope * x + intercept - y);
  ELO.CARRY = +slope.toFixed(3);
  ELO.MEAN = Math.round(mean);
  console.log(`2. carryover fit on ${n} team-seasons: next = ${ELO.CARRY} * end + ${(1 - ELO.CARRY).toFixed(3)} * ${ELO.MEAN}, MAE ${(err / n).toFixed(1)} Elo (${(err / n / ELO.POINTS).toFixed(2)} pts)`);
}

/* 3. Cold start from last season's end, the 2026 situation */
const sim = {};
{
  const out = {};
  for (const s of SEASONS.slice(1)) {
    const { games, fbs } = data[s];
    const ratings = carryOver(endOfSeason(s - 1));
    sim[s] = {};
    let n = 0, eloErr = 0, ptsErr = 0;
    const byWeek = {};
    for (const g of games) {
      const pre = applyGame(ratings, g, (t) => fbs.has(t) && ratings.has(t));
      if (!pre) continue;
      sim[s][g.id] = { h: Math.round(pre.h), a: Math.round(pre.a) };
      if (g.hElo != null && g.aElo != null) {
        const e = ptsDiffErr(pre.h, pre.a, g);
        const k = g.wk <= 3 ? "wk1-3" : g.wk <= 7 ? "wk4-7" : g.wk <= 10 ? "wk8-10" : "wk11+";
        (byWeek[k] ??= { n: 0, e: 0 }).n++;
        byWeek[k].e += e;
        if (g.wk >= 4) {
          n++;
          eloErr += (Math.abs(pre.h - g.hElo) + Math.abs(pre.a - g.aElo)) / 2;
          ptsErr += e;
        }
      }
    }
    out[s] = { games: n, eloMae: +(eloErr / n).toFixed(1), spreadPointsMae: +(ptsErr / n).toFixed(2), byWeek: Object.fromEntries(Object.entries(byWeek).map(([k, v]) => [k, +(v.e / v.n).toFixed(2)])) };
  }
  console.log("3. cold start from last season", JSON.stringify(out, null, 1));
}

await writeFile(path.join(BT, "elo-sim.json"), JSON.stringify({ params: ELO, sim }));
console.log("wrote data/backtest/elo-sim.json", ELO);
