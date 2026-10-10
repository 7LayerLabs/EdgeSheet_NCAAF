/**
 * Fit and grade the draft model (src/lib/draft-model-core.mjs).
 *
 * Training rows: every junior and senior at a skill position in FBS or FCS, seasons 2022 to 2025,
 * labeled with where he went in the next draft (value = ln(262 / pick), undrafted = 0). Juniors and
 * seniors who went undrafted because they came back to school (same player id on next season's
 * roster) are left out: the model answers "where does he go if he declares".
 *
 * Grading: leave one season out. Fit on three seasons, rank the fourth, and score the ranking the
 * way the site uses it (top 32 = Round 1 range, 33 to 100 = Day 2, 101 to 257 = Day 3) against the
 * real draft, next to the current forecast (scripts/lib/models.mjs forecastBoard) on the same players.
 *
 * Writes data/draft-model.json: weights fitted on all four seasons, the size table, and the results.
 *
 *   node scripts/draft-fit.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, groupOf, valueOfPick, productionPercentiles, blendProduction, features, predict } from "../src/lib/draft-model-core.mjs";
import { buildRadar, forecastBoard, DRAFT_GROUP_OF, spearman } from "./lib/models.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BT = path.join(root, "data", "backtest");
const SEASONS = [2022, 2023, 2024, 2025];
const USE_TEAM = process.env.NO_TEAM ? false : true;
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

async function playersFor(season) {
  const f = path.join(BT, String(season), "players.json");
  if (existsSync(f)) return readJson(f);
  if (season === 2026) return readJson(path.join(root, "data", "generated", "players.json"));
  return null;
}

/* ------------------------------------------------ build labeled rows per season */
const bySeason = {};
for (const S of SEASONS) {
  const players = await playersFor(S);
  const prior = await playersFor(S - 1);
  const next = await playersFor(S + 1);
  const draftAll = await readJson(path.join(BT, String(S), "draft.json"));
  const draft = draftAll.filter((d) => d.year === S + 1 && DRAFT_GROUP_OF[d.pos] && DRAFT_GROUP_OF[d.pos] !== "ST");
  const curPct = productionPercentiles(players);
  // Team strength: each school's last pregame Elo of the season (CFBD), FBS only.
  const games = await readJson(path.join(BT, String(S), "games.json"));
  const teamElo = new Map();
  for (const gm of [...games].sort((a, b) => a.start.localeCompare(b.start))) {
    if (gm.hElo != null) teamElo.set(gm.home, gm.hElo);
    if (gm.aElo != null) teamElo.set(gm.away, gm.aElo);
  }
  const priorPct = prior ? productionPercentiles(prior) : new Map();
  const nextIds = new Set((next ?? []).map((p) => p.id));

  const pool = players.filter((p) => (p.y === 3 || p.y === 4) && (p.c === "fbs" || p.c === "fcs") && GROUPS.includes(groupOf(p.p)));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const byNameTeam = new Map(pool.map((p) => [`${norm(p.n)}|${p.t}`, p]));
  const pickOf = new Map();
  for (const d of draft) {
    const p = (d.collegeAthleteId != null && byId.get(String(d.collegeAthleteId))) || byNameTeam.get(`${norm(d.name)}|${d.college}`);
    if (p && !pickOf.has(p.id)) pickOf.set(p.id, d);
  }
  const rows = [];
  let returned = 0;
  for (const p of pool) {
    const d = pickOf.get(p.id);
    if (!d && nextIds.has(p.id)) { returned++; continue; }
    const g = groupOf(p.p);
    rows.push({ elo: teamElo.get(p.t) ?? null, p, g, prod: blendProduction(curPct.get(p.id) ?? 0, priorPct.has(p.id) ? priorPct.get(p.id) : null, p.g), pick: d?.overall ?? null, round: d?.round ?? null, name: p.n, team: p.t });
  }
  bySeason[S] = { rows, players, draft, matched: pickOf.size, returned, hasPrior: Boolean(prior) };
  console.log(`${S} -> ${S + 1} draft: pool ${pool.length}, left out as returning ${returned}, rows ${rows.length}, drafted matched ${pickOf.size} of ${draft.length}${prior ? "" : " (no prior season)"}`);
}

/* ------------------------------------------------ fit */
function sizeTable(rows) {
  const t = {};
  for (const g of GROUPS) {
    const hs = rows.filter((r) => r.g === g && r.p.h).map((r) => r.p.h);
    const ws = rows.filter((r) => r.g === g && r.p.w).map((r) => r.p.w);
    const m = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const sd = (a) => Math.sqrt(a.reduce((x, y) => x + (y - m(a)) ** 2, 0) / Math.max(1, a.length - 1)) || 1;
    t[g] = { hMean: m(hs), hSd: sd(hs), wMean: m(ws), wSd: sd(ws) };
  }
  return t;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function fit(rows, lambda) {
  const size = sizeTable(rows);
  const X = rows.map((r) => features(r.p, r.g, r.prod, size, USE_TEAM ? r.elo : null));
  const y = rows.map((r) => valueOfPick(r.pick));
  const names = [...new Set(X.flatMap((f) => Object.keys(f)))];
  const idx = new Map(names.map((n, i) => [n, i]));
  const k = names.length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  X.forEach((f, i) => {
    const e = Object.entries(f).map(([n, v]) => [idx.get(n), v]);
    for (const [a, va] of e) {
      b[a] += va * y[i];
      for (const [c, vc] of e) A[a][c] += va * vc;
    }
  });
  names.forEach((n, i) => { if (!n.startsWith("b:")) A[i][i] += lambda; });
  const w = solve(A, b);
  return { weights: Object.fromEntries(names.map((n, i) => [n, +w[i].toFixed(5)])), size };
}

/* ------------------------------------------------ grade */
function grade(ranked) {
  // ranked: [{ pick, round, rank }] for every row in the held-out pool, rank 1 = model's best
  const r1 = ranked.filter((x) => x.round === 1);
  const top100 = ranked.filter((x) => x.pick && x.pick <= 100);
  const drafted = ranked.filter((x) => x.pick);
  const band32 = ranked.filter((x) => x.rank <= 32);
  return {
    r1Recall: +(100 * r1.filter((x) => x.rank <= 32).length / Math.max(1, r1.length)).toFixed(1),
    r1In64: +(100 * r1.filter((x) => x.rank <= 64).length / Math.max(1, r1.length)).toFixed(1),
    top100Recall: +(100 * top100.filter((x) => x.rank <= 100).length / Math.max(1, top100.length)).toFixed(1),
    r1BandDraftedR1: band32.filter((x) => x.round === 1).length,
    r1BandDraftedAtAll: band32.filter((x) => x.pick).length,
    spearman: drafted.length > 3 ? +spearman(drafted.map((x) => x.rank), drafted.map((x) => x.pick)).toFixed(3) : null,
    r1Total: r1.length,
  };
}

const results = {};
let bestLambda = null;
for (const lambda of (process.env.LAMBDAS ?? "10,30,100,300,1000").split(",").map(Number)) {
  const per = {};
  for (const test of SEASONS) {
    const train = SEASONS.filter((s) => s !== test).flatMap((s) => bySeason[s].rows);
    const m = fit(train, lambda);
    const scored = bySeason[test].rows.map((r) => ({ ...r, v: predict(m.weights, features(r.p, r.g, r.prod, m.size, USE_TEAM ? r.elo : null)) }));
    scored.sort((a, b) => b.v - a.v);
    per[test] = grade(scored.map((x, i) => ({ pick: x.pick, round: x.round, rank: i + 1 })));
  }
  const avg = (k) => +(SEASONS.reduce((a, s) => a + per[s][k], 0) / SEASONS.length).toFixed(1);
  results[lambda] = { per, avg: { r1Recall: avg("r1Recall"), r1In64: avg("r1In64"), top100Recall: avg("top100Recall"), spearman: +(SEASONS.reduce((a, s) => a + per[s].spearman, 0) / SEASONS.length).toFixed(3) } };
  console.log(`lambda ${lambda}: avg R1 recall ${results[lambda].avg.r1Recall}%, R1 inside top 64 ${results[lambda].avg.r1In64}%, top-100 recall ${results[lambda].avg.top100Recall}%, spearman ${results[lambda].avg.spearman}`);
  if (!bestLambda || results[lambda].avg.r1Recall + results[lambda].avg.top100Recall > results[bestLambda].avg.r1Recall + results[bestLambda].avg.top100Recall) bestLambda = lambda;
}

/* ------------------------------------------------ quota variant: model orders each position, history sets the slots */
// Demand from the five drafts before the tested one (same as the live site), then each position fills its
// round-one, top-100, and total slots in model order; the overall board is band first, then model value.
function quotaRanks(rows, scoreOf, demandPicks) {
  const totals = new Map();
  const years = new Set(demandPicks.map((d) => d.year));
  for (const d of demandPicks) {
    const g = DRAFT_GROUP_OF[d.pos];
    if (!g || g === "ST") continue;
    const e = totals.get(g) ?? totals.set(g, { all: 0, r1: 0, top100: 0 }).get(g);
    e.all++;
    if (d.round === 1) e.r1++;
    if (d.overall <= 100) e.top100++;
  }
  const n = Math.max(1, years.size);
  const band = new Map();
  for (const g of GROUPS) {
    const t = totals.get(g) ?? { all: 0, r1: 0, top100: 0 };
    const list = rows.filter((r) => r.g === g).map((r) => ({ r, v: scoreOf(r) })).sort((a, b) => b.v - a.v);
    list.forEach((x, i) => band.set(x.r, { b: i < Math.round(t.r1 / n) ? 0 : i < Math.round(t.top100 / n) ? 1 : i < Math.round(t.all / n) ? 2 : 3, v: x.v }));
  }
  const order = [...band].sort((a, b) => a[1].b - b[1].b || b[1].v - a[1].v);
  return new Map(order.map(([r], i) => [r, i + 1]));
}
const quota = {};
for (const test of SEASONS) {
  const train = SEASONS.filter((s) => s !== test).flatMap((s) => bySeason[s].rows);
  const m = fit(train, bestLambda);
  const draftAll = await readJson(path.join(BT, String(test), "draft.json"));
  const demandPicks = draftAll.filter((d) => d.year >= test - 4 && d.year <= test);
  const ranks = quotaRanks(bySeason[test].rows, (r) => predict(m.weights, features(r.p, r.g, r.prod, m.size, USE_TEAM ? r.elo : null)), demandPicks);
  quota[test] = grade(bySeason[test].rows.map((r) => ({ pick: r.pick, round: r.round, rank: ranks.get(r) })));
}
const qavg = (k) => +(SEASONS.reduce((a, s) => a + quota[s][k], 0) / SEASONS.length).toFixed(1);
console.log(`QUOTA variant (lambda ${bestLambda}): avg R1 recall ${qavg("r1Recall")}%, R1 inside top 64 ${qavg("r1In64")}%, top-100 recall ${qavg("top100Recall")}%, spearman ${(SEASONS.reduce((a, s) => a + quota[s].spearman, 0) / SEASONS.length).toFixed(3)}`);
for (const S of SEASONS) console.log(`  ${S + 1} draft  quota: R1 ${quota[S].r1Recall}%  top100 ${quota[S].top100Recall}%`);

/* ------------------------------------------------ baseline: the current forecast on the same rows */
const baseline = {};
for (const S of SEASONS) {
  const { players } = bySeason[S];
  const draftAll = await readJson(path.join(BT, String(S), "draft.json"));
  const demandPicks = draftAll.filter((d) => d.year >= S - 4 && d.year <= S);
  const fc = forecastBoard(buildRadar(players, S + 1), S + 1, demandPicks);
  const rankOf = new Map(fc.board.map((e) => [e.player.id, e.overall]));
  const ranked = bySeason[S].rows.map((r) => ({ pick: r.pick, round: r.round, rank: rankOf.get(r.p.id) ?? 9999 }));
  baseline[S] = grade(ranked);
}
const bavg = (k) => +(SEASONS.reduce((a, s) => a + baseline[s][k], 0) / SEASONS.length).toFixed(1);
console.log(`CURRENT forecast on the same rows: avg R1 recall ${bavg("r1Recall")}%, R1 inside top 64 ${bavg("r1In64")}%, top-100 recall ${bavg("top100Recall")}%, spearman ${(SEASONS.reduce((a, s) => a + (baseline[s].spearman ?? 0), 0) / SEASONS.length).toFixed(3)}`);
for (const S of SEASONS) console.log(`  ${S + 1} draft  new: R1 ${results[bestLambda].per[S].r1Recall}%  top100 ${results[bestLambda].per[S].top100Recall}%   |  current: R1 ${baseline[S].r1Recall}%  top100 ${baseline[S].top100Recall}%`);

/* ------------------------------------------------ final fit on everything */
const final = fit(SEASONS.flatMap((s) => bySeason[s].rows), bestLambda);
const sample = bySeason[2025].rows
  .map((r) => ({ name: r.name, team: r.team, g: r.g, v: predict(final.weights, features(r.p, r.g, r.prod, final.size, USE_TEAM ? r.elo : null)), pick: r.pick }))
  .sort((a, b) => b.v - a.v)
  .slice(0, 15);
console.log("in-sample top 15, 2025 season -> 2026 draft:");
for (const s of sample) console.log(`  ${s.name.padEnd(24)} ${s.team.padEnd(16)} ${s.g.padEnd(4)} real pick ${s.pick ?? "undrafted"}`);

await writeFile(
  path.join(root, "data", "draft-model.json"),
  JSON.stringify({ fittedAt: new Date().toISOString(), seasons: SEASONS, lambda: bestLambda, priorGames: 4, teamElo: USE_TEAM, weights: final.weights, size: final.size, validation: { model: results[bestLambda], quota, current: baseline } }, null, 1),
);
console.log(`wrote data/draft-model.json (lambda ${bestLambda})`);
