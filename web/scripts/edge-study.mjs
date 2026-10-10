/**
 * Edge study: where, if anywhere, the model or simple market rules beat the number.
 *
 * Hypotheses are fixed here, before the run, so this is a test and not a search:
 *   T1  Model side against the OPENING spread (walk-forward, weeks 4+, FBS vs FBS), leans of 3, 5, 7 points.
 *       Graded against the open (what you could have bet) and the close.
 *   T2  Closing-line value: on those leans, how often the line moved toward the model, and by how much.
 *       Beating the close is the most reliable sign of a real edge; win rate is noisy at these sample sizes.
 *   T3  Model total (league constant 26.8, the zero-bias value from the backtest) against the opening total.
 *   T4  Wind at kickoff (Open-Meteo historical hourly, home stadium, neutral sites and domes skipped) against totals.
 *   T5  Market-only rules: big underdogs, home underdogs, following or fading line moves.
 *   T6  T1 split by power vs Group of Five matchups, and by week band.
 *
 * Break-even at -110 is 52.38%. Every rate is reported with its sample size and a 95% interval.
 *
 *   node scripts/edge-study.mjs            # writes data/backtest/edge-study.json
 *
 * Network: ESPN scoreboards (venue per game, ~60 calls) and Open-Meteo archive (one call per venue-season),
 * both free and keyless, cached under data/cache/edge-study/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTendencies, eloMargin, edgeNet, blendMargin, modelTotal } from "./lib/models.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BT = path.join(root, "data", "backtest");
const CACHE = path.join(root, "data", "cache", "edge-study");
const SEASONS = (process.env.SEASONS ?? "2022,2023,2024,2025").split(",").map(Number);
const MIN_WEEK = 4;
const AVG_PPG_ZERO_BIAS = 26.8;
const BREAK_EVEN = 0.5238;
const POWER = new Set(["SEC", "Big Ten", "Big 12", "ACC", "Pac-12"]);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));

async function cachedJson(name, url) {
  const f = path.join(CACHE, name);
  if (existsSync(f)) return readJson(f);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const j = await res.json();
        await writeFile(f, JSON.stringify(j));
        return j;
      }
      if (res.status === 429) await sleep(5000 * (attempt + 1));
      else return undefined;
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return undefined;
}

/* ------------------------------------------------------------ stats helpers */
function rec() {
  return { n: 0, w: 0 };
}
function add(r, win) {
  r.n++;
  if (win) r.w++;
}
function show(r) {
  if (!r.n) return { n: 0 };
  const p = r.w / r.n;
  const se = Math.sqrt((p * (1 - p)) / r.n);
  // z against break-even: how many standard errors above 52.38%.
  const z = (p - BREAK_EVEN) / Math.sqrt((BREAK_EVEN * (1 - BREAK_EVEN)) / r.n);
  return { n: r.n, wins: r.w, rate: +(100 * p).toFixed(1), lo: +(100 * (p - 1.96 * se)).toFixed(1), hi: +(100 * (p + 1.96 * se)).toFixed(1), zVsBreakEven: +z.toFixed(2) };
}

/* ------------------------------------------------------------ load seasons */
await mkdir(CACHE, { recursive: true });
const venues = await readJson(path.join(root, "data", "cache", "venues.json"));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const venueByName = new Map();
const venuesByCity = new Map();
for (const v of venues) {
  if (v.latitude == null) continue;
  venueByName.set(norm(v.name), v);
  const k = `${norm(v.city)}|${norm(v.state)}`;
  (venuesByCity.get(k) ?? venuesByCity.set(k, []).get(k)).push(v);
}

// ELO_SOURCE=ours swaps CFBD's pregame Elo for our rebuilt ratings (scripts/elo-check.mjs cold start, 2023+).
const OURS = process.env.ELO_SOURCE === "ours";
const eloSim = OURS ? (await readJson(path.join(BT, "elo-sim.json"))).sim : null;
const rows = []; // one per FBS game with a line
for (const season of SEASONS) {
  const dir = path.join(BT, String(season));
  const games = await readJson(path.join(dir, "games.json"));
  const lines = new Map((await readJson(path.join(dir, "lines.json"))).map((l) => [l.id, l]));
  const teams = await readJson(path.join(dir, "teams.json"));
  const advWeeks = await readJson(path.join(dir, "advWeeks.json"));
  const confOf = new Map(teams.map((t) => [t.team, t.conf]));
  const tendByWeek = new Map();
  const tendFor = (wk) => {
    const w = wk - 1;
    if (w < MIN_WEEK - 1 || !advWeeks[w]) return undefined;
    if (!tendByWeek.has(w)) tendByWeek.set(w, buildTendencies(advWeeks[w]));
    return tendByWeek.get(w);
  };

  // ESPN venue per game id (same ids as CFBD).
  const venueOfGame = new Map();
  for (let wk = 1; wk <= 16; wk++) {
    const sb = await cachedJson(`sb-${season}-${wk}.json`, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&seasontype=2&week=${wk}&dates=${season}&limit=400`);
    for (const e of sb?.events ?? []) {
      const c = e.competitions?.[0];
      const v = c?.venue;
      if (!v) continue;
      const hit = venueByName.get(norm(v.fullName)) ?? (() => {
        const list = venuesByCity.get(`${norm(v.address?.city)}|${norm(v.address?.state)}`) ?? [];
        return list.length === 1 ? list[0] : list.sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];
      })();
      venueOfGame.set(Number(e.id), { espnName: v.fullName, indoor: Boolean(v.indoor), neutral: Boolean(c.neutralSite), venue: hit });
    }
  }

  for (const g of games) {
    if (!(g.hc === "fbs" && g.ac === "fbs" && g.completed && g.hp != null && g.ap != null)) continue;
    const line = lines.get(g.id);
    if (!line) continue;
    const actual = g.hp - g.ap;
    const tend = tendFor(g.wk);
    const simElo = eloSim?.[season]?.[g.id];
    if (OURS && !simElo) continue;
    const elo = OURS ? eloMargin(simElo.h, simElo.a, g.neutral) : eloMargin(g.hElo, g.aElo, g.neutral);
    const net = tend ? edgeNet(tend, g.home, g.away) : undefined;
    const model = elo !== undefined && net ? blendMargin(elo, net.live) : undefined;
    const mt = tend ? modelTotal(tend, g.home, g.away, "fbs", AVG_PPG_ZERO_BIAS) : undefined;
    const ven = venueOfGame.get(g.id);
    const hc = confOf.get(g.home);
    const ac = confOf.get(g.away);
    rows.push({
      season, id: g.id, wk: g.wk, start: g.start, home: g.home, away: g.away, neutral: g.neutral,
      tier: POWER.has(hc) && POWER.has(ac) ? "power" : !POWER.has(hc) && !POWER.has(ac) ? "g5" : "mixed",
      actual, totalPts: g.hp + g.ap,
      close: -line.spread, open: line.spreadOpen != null ? -line.spreadOpen : null, // home margins
      totalClose: line.total ?? null, totalOpen: line.totalOpen ?? null,
      model, modelTotal: mt?.total ?? null,
      venue: ven?.venue ? { id: ven.venue.id, lat: ven.venue.latitude, lon: ven.venue.longitude, dome: Boolean(ven.venue.dome) || ven.indoor, tz: ven.venue.timezone } : null,
      espnNeutral: ven?.neutral ?? null,
    });
  }
  log(`season ${season}: ${rows.filter((r) => r.season === season).length} lined FBS games, venue matched ${rows.filter((r) => r.season === season && r.venue).length}`);
}

/* ------------------------------------------------------------ wind */
// One archive call per venue-season, hourly wind in mph, then the kickoff hour.
const windKey = (r) => `${r.venue.id}-${r.season}`;
const need = new Map();
for (const r of rows) if (r.venue && !r.venue.dome && !r.neutral) need.set(windKey(r), r);
let i = 0;
const windSeries = new Map();
for (const [k, r] of need) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${r.venue.lat}&longitude=${r.venue.lon}&start_date=${r.season}-08-20&end_date=${r.season}-12-15&hourly=wind_speed_10m,wind_gusts_10m,precipitation&wind_speed_unit=mph&timezone=UTC`;
  const j = await cachedJson(`wx-${k}.json`, url);
  if (j?.hourly?.time) windSeries.set(k, j.hourly);
  if (++i % 50 === 0) log(`weather ${i}/${need.size}`);
}
for (const r of rows) {
  if (!r.venue || r.venue.dome || r.neutral) continue;
  const h = windSeries.get(windKey(r));
  if (!h) continue;
  const t = new Date(r.start);
  t.setUTCMinutes(0, 0, 0);
  // Average over the first three hours of the game.
  const idx = h.time.indexOf(t.toISOString().slice(0, 13) + ":00");
  if (idx < 0) continue;
  const span = [idx, idx + 1, idx + 2].filter((j) => h.wind_speed_10m[j] != null);
  r.wind = span.reduce((s, j) => s + h.wind_speed_10m[j], 0) / span.length;
  r.gust = Math.max(...span.map((j) => h.wind_gusts_10m[j] ?? 0));
  r.rain = span.reduce((s, j) => s + (h.precipitation[j] ?? 0), 0);
}
log("games with kickoff wind", rows.filter((r) => r.wind != null).length);

/* ------------------------------------------------------------ tests */
const out = { generatedAt: new Date().toISOString(), seasons: SEASONS, breakEven: 52.38, games: rows.length, tests: {} };
const covers = (actual, line, side) => (side > 0 ? actual > line : actual < line); // home margin vs line, side +1 home
const push = (actual, line) => actual === line;

// T1 / T2 / T6: model vs open.
const T1 = {};
const T2 = {};
const T6 = {};
for (const lean of [3, 5, 7]) {
  const vsOpen = rec(), vsClose = rec(), clvToward = rec();
  let clvSum = 0;
  const bySeason = {}, byTier = {}, byWeek = {};
  for (const r of rows) {
    if (r.model == null || r.open == null || r.wk < MIN_WEEK) continue;
    const diff = r.model - r.open;
    if (Math.abs(diff) < lean) continue;
    const side = Math.sign(diff);
    if (!push(r.actual, r.open)) {
      const win = covers(r.actual, r.open, side);
      add(vsOpen, win);
      add((bySeason[r.season] ??= rec()), win);
      add((byTier[r.tier] ??= rec()), win);
      add((byWeek[r.wk <= 7 ? "wk4-7" : r.wk <= 10 ? "wk8-10" : "wk11+"] ??= rec()), win);
    }
    if (!push(r.actual, r.close)) add(vsClose, covers(r.actual, r.close, side));
    const move = (r.close - r.open) * side; // points the line moved toward the model's side
    clvSum += move;
    if (move !== 0) add(clvToward, move > 0);
  }
  T1[`lean${lean}`] = { vsOpen: show(vsOpen), vsClose: show(vsClose), bySeason: Object.fromEntries(Object.entries(bySeason).map(([k, v]) => [k, show(v)])) };
  T2[`lean${lean}`] = { lineMovedTowardModel: show(clvToward), avgClvPoints: vsOpen.n ? +(clvSum / (vsOpen.n || 1)).toFixed(2) : null };
  T6[`lean${lean}`] = { byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, show(v)])), byWeek: Object.fromEntries(Object.entries(byWeek).map(([k, v]) => [k, show(v)])) };
}
out.tests.T1_modelVsOpen = T1;
out.tests.T2_closingLineValue = T2;
out.tests.T6_splits = T6;

// T3: model total vs open total.
const T3 = {};
for (const lean of [3, 5, 7]) {
  const over = rec(), under = rec(), overClose = rec(), underClose = rec();
  let clv = 0, n = 0;
  for (const r of rows) {
    if (r.modelTotal == null || r.totalOpen == null || r.wk < MIN_WEEK) continue;
    const gap = r.modelTotal - r.totalOpen;
    if (Math.abs(gap) < lean) continue;
    const side = Math.sign(gap);
    if (r.totalPts !== r.totalOpen) add(side > 0 ? over : under, side > 0 ? r.totalPts > r.totalOpen : r.totalPts < r.totalOpen);
    if (r.totalClose != null && r.totalPts !== r.totalClose) add(side > 0 ? overClose : underClose, side > 0 ? r.totalPts > r.totalClose : r.totalPts < r.totalClose);
    if (r.totalClose != null) { clv += (r.totalClose - r.totalOpen) * side; n++; }
  }
  const both = { n: over.n + under.n, w: over.w + under.w };
  T3[`lean${lean}`] = { all: show(both), overs: show(over), unders: show(under), oversVsClose: show(overClose), undersVsClose: show(underClose), avgClvPoints: n ? +(clv / n).toFixed(2) : null };
}
out.tests.T3_totalsVsOpen = T3;

// T4: wind bins, under rate against close and open, and how much the market already moved.
const T4 = {};
for (const [label, lo, hi] of [["under 10 mph", 0, 10], ["10 to 15", 10, 15], ["15 to 20", 15, 20], ["20 plus", 20, 99]]) {
  const uClose = rec(), uOpen = rec();
  let resid = 0, moved = 0, n = 0;
  for (const r of rows) {
    if (r.wind == null || r.wind < lo || r.wind >= hi) continue;
    if (r.totalClose != null && r.totalPts !== r.totalClose) add(uClose, r.totalPts < r.totalClose);
    if (r.totalOpen != null && r.totalPts !== r.totalOpen) add(uOpen, r.totalPts < r.totalOpen);
    if (r.totalClose != null) { resid += r.totalPts - r.totalClose; n++; if (r.totalOpen != null) moved += r.totalClose - r.totalOpen; }
  }
  T4[label] = { underVsClose: show(uClose), underVsOpen: show(uOpen), avgActualMinusClose: n ? +(resid / n).toFixed(2) : null, avgTotalMoveOpenToClose: n ? +(moved / n).toFixed(2) : null };
}
out.tests.T4_wind = T4;

// T5: market-only rules against the close.
const T5 = {};
{
  const bigDog = rec(), homeDog = rec(), followMove = rec(), followTotalMove = rec();
  for (const r of rows) {
    if (push(r.actual, r.close)) continue;
    if (Math.abs(r.close) >= 21) add(bigDog, covers(r.actual, r.close, r.close > 0 ? -1 : 1));
    if (r.close < 0 && !r.neutral) add(homeDog, covers(r.actual, r.close, 1));
    if (r.open != null && Math.abs(r.close - r.open) >= 2) add(followMove, covers(r.actual, r.close, Math.sign(r.close - r.open)));
  }
  for (const r of rows) {
    if (r.totalOpen == null || r.totalClose == null || r.totalPts === r.totalClose) continue;
    if (Math.abs(r.totalClose - r.totalOpen) >= 3) add(followTotalMove, Math.sign(r.totalClose - r.totalOpen) > 0 ? r.totalPts > r.totalClose : r.totalPts < r.totalClose);
  }
  T5.bigUnderdog21plus = show(bigDog);
  T5.homeUnderdog = show(homeDog);
  T5.followSpreadMove2plusAtClose = show(followMove);
  T5.followTotalMove3plusAtClose = show(followTotalMove);
}
out.tests.T5_marketRules = T5;

// Market sanity: how often the line moves at all, and opener vs closer accuracy.
{
  let n = 0, openErr = 0, closeErr = 0, moved = 0;
  for (const r of rows) {
    if (r.open == null) continue;
    n++;
    openErr += Math.abs(r.actual - r.open);
    closeErr += Math.abs(r.actual - r.close);
    if (r.open !== r.close) moved++;
  }
  out.market = { gamesWithOpen: n, openerMae: +(openErr / n).toFixed(2), closerMae: +(closeErr / n).toFixed(2), shareMoved: +((100 * moved) / n).toFixed(1) };
}

out.eloSource = OURS ? "ours" : "cfbd";
await writeFile(path.join(BT, OURS ? "edge-study-ours.json" : "edge-study.json"), JSON.stringify(out, null, 2));
log(JSON.stringify(out, null, 2));
