/**
 * Closed loop: replay the graded archive against the current formulas and tune
 * the few parameters that live in data/weights.json `applied`. Transparent by
 * construction: every change (and every proposal it will not apply on its own)
 * lands in data/changelog.json and shows on /history under "Model updates".
 *
 *   npm run tune                 # tsx scripts/tune.mjs (run from web/)
 *   npm run tune -- --dry        # compute and print, never write
 *   npm run tune -- --min=10     # lower the sample gate (testing only; the default 50 is the product rule)
 *
 * Schedule (Monday 6 AM Eastern, after the weekend's finals are graded):
 *   cron:    0 6 * * 1  cd /path/to/web && npm run tune >> data/tune.log 2>&1
 *   Windows: schtasks /Create /TN "EdgeSheet tune" /SC WEEKLY /D MON /ST 06:00 /TR "cmd /c cd /d C:\path\to\web && npm run tune >> data\tune.log 2>&1"
 *   pm2:     pm2 start npm --name scout-tune --cron "0 6 * * 1" --no-autorestart -- run tune
 *
 * What it measures (graded entries only):
 *   (a) edge threshold: the percentile gap at which a unit matchup is called, swept 15..40, scored by played-out rate of the called edges
 *   (b) Scout Score: correlation of the score and of each component with the excitement index (proposal only, weights live in code)
 *   (c) projection: winner rate and side-vs-number by lean strength; eloWeight/edgeDivisor re-blend when the locked parts are archived
 *   (d) total: mean model total minus market total, and minus the final, which drives the total baseline offset
 *
 * Applies only: edgeThreshold, totalBaselineOffset, eloWeight, edgeDivisor, inside APPLIED_BOUNDS from src/lib/weights.ts,
 * only when the graded sample is at least MIN_GAMES and a 200-resample bootstrap says the gain is outside noise.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPLIED_BOUNDS, APPLIED_DEFAULTS } from "../src/lib/weights.ts";
import { WEIGHTS as SCORE_WEIGHTS } from "../src/lib/score.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const WEIGHTS_FILE = path.join(root, "data", "weights.json");
const CHANGELOG_FILE = path.join(root, "data", "changelog.json");
const ARCHIVE_DIR = path.join(root, "data", "archive");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const MIN_GAMES = Number((args.find((a) => a.startsWith("--min=")) ?? "--min=50").slice(6)) || 50;
const RESAMPLES = 200;
const NOW = new Date().toISOString();

const log = (...a) => console.log(...a);
const pct = (n) => (n == null || !Number.isFinite(n) ? "–" : `${Math.round(n * 100)}%`);
const f1 = (n) => (n == null || !Number.isFinite(n) ? "–" : (Math.round(n * 10) / 10).toFixed(1));
const sign = (n) => (n > 0 ? "+" : "");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const quantile = (xs, q) => {
  const a = [...xs].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))));
  return a[i];
};
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
/** Deterministic resampling so two runs on the same archive agree. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrap(items, stat, seed = 7) {
  const r = rng(seed);
  const out = [];
  for (let k = 0; k < RESAMPLES; k++) {
    const sample = [];
    for (let i = 0; i < items.length; i++) sample.push(items[Math.floor(r() * items.length)]);
    out.push(stat(sample));
  }
  return out;
}

/* ------------------------------------------------------------ load */

async function loadEntries() {
  try {
    const mod = await import("../src/lib/archive.ts");
    return mod.listEntries();
  } catch (e) {
    log(`(archive module import failed, reading data/archive directly: ${e instanceof Error ? e.message : e})`);
    const out = [];
    if (!existsSync(ARCHIVE_DIR)) return out;
    for (const s of readdirSync(ARCHIVE_DIR)) {
      const d = path.join(ARCHIVE_DIR, s);
      for (const f of readdirSync(d)) {
        if (!f.endsWith(".json")) continue;
        try { out.push(JSON.parse(readFileSync(path.join(d, f), "utf8"))); } catch {}
      }
    }
    return out;
  }
}

function readWeightsFile() {
  if (!existsSync(WEIGHTS_FILE)) return {};
  try { return JSON.parse(readFileSync(WEIGHTS_FILE, "utf8")); } catch { return {}; }
}
function currentApplied(raw) {
  const a = { ...APPLIED_DEFAULTS };
  const got = raw.applied ?? {};
  for (const k of Object.keys(APPLIED_BOUNDS)) {
    const v = got[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= APPLIED_BOUNDS[k].min && v <= APPLIED_BOUNDS[k].max) a[k] = v;
  }
  return a;
}

/* ------------------------------------------------------------ (a) edge threshold */

/** Regrade one edge at a given threshold with the current archive.ts rules. Returns a verdict or null when it cannot be measured. */
function regradeEdge(e, T) {
  if (e.gap === undefined || Math.abs(e.gap) < T) return null;
  const edge = e.gap > 0 ? "offense" : "defense";
  const rush = /(\d+) rush yds on (\d+) carries/.exec(e.actual ?? "");
  const pass = /(\d+) pass yds, longest play (\d+)/.exec(e.actual ?? "");
  if ((e.axis === "rush" || e.axis === "line") && rush) {
    const yds = Number(rush[1]), car = Number(rush[2]);
    const ypc = car ? yds / car : 0;
    if (edge === "offense") return ypc >= 4.6 || yds >= 170 ? "played out" : ypc < 3.4 && yds < 110 ? "did not play out" : "mixed";
    return ypc <= 3.5 ? "played out" : ypc >= 4.8 ? "did not play out" : "mixed";
  }
  if (e.axis === "pass" && pass) {
    const yds = Number(pass[1]), lng = Number(pass[2]);
    if (edge === "offense") return yds >= 250 || lng >= 40 ? "played out" : yds < 160 && lng < 30 ? "did not play out" : "mixed";
    return yds <= 180 && lng < 35 ? "played out" : yds >= 260 || lng >= 45 ? "did not play out" : "mixed";
  }
  // Passing downs (play-by-play) and anything else: only the stored verdict exists, and only where the lock called the edge.
  if (e.edge !== "even" && e.edge === edge && e.verdict && e.verdict !== "unmeasured") return e.verdict;
  return null;
}

function edgeRateAt(games, T) {
  let played = 0, measured = 0;
  for (const g of games) for (const e of g.edges) {
    const v = regradeEdge(e, T);
    if (!v) continue;
    measured++;
    if (v === "played out") played++;
  }
  return { rate: measured ? played / measured : NaN, n: measured, played };
}

function tuneEdgeThreshold(graded, applied) {
  const games = graded.map((g) => ({ edges: (g.postgame?.edges ?? []).map((e) => ({ ...e })) }));
  const withGap = games.reduce((s, g) => s + g.edges.filter((e) => e.gap !== undefined).length, 0);
  const total = games.reduce((s, g) => s + g.edges.length, 0);
  const cur = applied.edgeThreshold;
  const sweep = [];
  for (let T = APPLIED_BOUNDS.edgeThreshold.min; T <= APPLIED_BOUNDS.edgeThreshold.max; T += 5) sweep.push({ T, ...edgeRateAt(games, T) });
  const atCur = edgeRateAt(games, cur);
  const candidates = sweep.filter((s) => s.n >= 30 && Number.isFinite(s.rate));
  const best = candidates.sort((a, b) => b.rate - a.rate || Math.abs(a.T - cur) - Math.abs(b.T - cur))[0];
  let proposal = null;
  if (best && best.T !== cur && atCur.n >= 30 && best.rate - atCur.rate >= 0.03) {
    const diffs = bootstrap(games, (s) => edgeRateAt(s, best.T).rate - edgeRateAt(s, cur).rate, 11);
    const p5 = quantile(diffs, 0.05);
    proposal = { to: best.T, from: cur, p5, evidence: `played-out rate ${pct(best.rate)} vs ${pct(atCur.rate)}, n=${best.n}, bootstrap 5th pct ${sign(p5)}${f1(p5 * 100)} pts`, significant: p5 > 0 };
  }
  return { sweep, atCur, withGap, total, proposal };
}

/* ------------------------------------------------------------ (b) Scout Score vs excitement */

function scoreVsExcitement(graded) {
  const rows = graded.filter((g) => g.postgame?.excitement != null && Number.isFinite(g.postgame.excitement));
  const r = pearson(rows.map((g) => g.pregame.scoutScore), rows.map((g) => g.postgame.excitement));
  const comps = [];
  const withComps = rows.filter((g) => g.pregame.scoreComponents);
  for (const k of Object.keys(SCORE_WEIGHTS)) {
    const pairs = withComps.filter((g) => typeof g.pregame.scoreComponents[k] === "number");
    if (pairs.length < 3) { comps.push({ k, n: pairs.length, r: NaN, weight: SCORE_WEIGHTS[k] }); continue; }
    const xs = pairs.map((g) => g.pregame.scoreComponents[k]);
    const ys = pairs.map((g) => g.postgame.excitement);
    const rr = pearson(xs, ys);
    const boots = bootstrap(pairs, (s) => pearson(s.map((g) => g.pregame.scoreComponents[k]), s.map((g) => g.postgame.excitement)), 23);
    comps.push({ k, n: pairs.length, r: rr, p5: quantile(boots, 0.05), p95: quantile(boots, 0.95), weight: SCORE_WEIGHTS[k] });
  }
  const proposals = [];
  for (const c of comps) {
    if (c.n < MIN_GAMES || !Number.isFinite(c.r)) continue;
    if (c.weight > 0 && c.r < -0.1 && c.p95 < 0) proposals.push({ metric: `Scout Score weight ${c.k}`, from: c.weight, to: 0, evidence: `correlation with excitement ${f1(c.r * 100) / 100 < 0 ? "" : ""}${c.r.toFixed(2)} (bootstrap 95th pct ${c.p95.toFixed(2)}), n=${c.n}` });
    else if (c.weight === 0 && c.r > 0.15 && c.p5 > 0) proposals.push({ metric: `Scout Score weight ${c.k}`, from: 0, to: 0.1, evidence: `correlation with excitement ${c.r.toFixed(2)} (bootstrap 5th pct ${c.p5.toFixed(2)}), n=${c.n}` });
  }
  return { n: rows.length, r, comps, withComps: withComps.length, proposals };
}

/* ------------------------------------------------------------ (c) projection */

function projectionRows(graded) {
  const rows = [];
  for (const g of graded) {
    const p = g.pregame.projection;
    const res = g.postgame?.projectionResult;
    if (!p || !res || !g.postgame?.score) continue;
    const homeAbbr = g.pregame.abbr.home;
    const modelHome = p.winner === homeAbbr ? p.margin : -p.margin;
    const actualHome = g.postgame.score.home - g.postgame.score.away;
    let marketHome;
    if (g.pregame.spread) marketHome = g.pregame.spread.team === homeAbbr ? -g.pregame.spread.line : g.pregame.spread.line;
    const sideGap = marketHome === undefined ? undefined : Math.abs(modelHome - marketHome);
    rows.push({ modelHome, actualHome, marketHome, sideGap, winnerRight: res.winnerRight, sideCovered: res.modelSideCovered, eloMargin: p.eloMargin, netEdge: p.netEdge, home: g.pregame.home, away: g.pregame.away });
  }
  return rows;
}

function byLean(rows) {
  const buckets = [
    { label: "under 3", lo: 0, hi: 3 },
    { label: "3 to 6", lo: 3, hi: 6 },
    { label: "6 and up", lo: 6, hi: 1e9 },
  ];
  return buckets.map((b) => {
    const rs = rows.filter((r) => r.sideGap !== undefined && r.sideGap >= b.lo && r.sideGap < b.hi);
    const sided = rs.filter((r) => r.sideCovered !== undefined);
    return { label: b.label, n: rs.length, winner: rs.length ? rs.filter((r) => r.winnerRight).length / rs.length : NaN, sideN: sided.length, side: sided.length ? sided.filter((r) => r.sideCovered).length / sided.length : NaN };
  });
}

function tuneBlend(rows, applied) {
  const parts = rows.filter((r) => typeof r.eloMargin === "number" && typeof r.netEdge === "number");
  const mae = (rs, w, d) => mean(rs.map((r) => Math.abs(r.actualHome - (r.eloMargin + (1 - w) * r.netEdge / d))));
  const cur = { eloWeight: applied.eloWeight, edgeDivisor: applied.edgeDivisor };
  if (parts.length < 10) return { n: parts.length, cur, proposal: null, grid: [] };
  const grid = [];
  for (let w = 0.3; w <= 0.9 + 1e-9; w += 0.1) for (let d = 20; d <= 80; d += 10) grid.push({ eloWeight: Math.round(w * 10) / 10, edgeDivisor: d, mae: mae(parts, Math.round(w * 10) / 10, d) });
  const curMae = mae(parts, cur.eloWeight, cur.edgeDivisor);
  const best = [...grid].sort((a, b) => a.mae - b.mae)[0];
  let proposal = null;
  if (best && (best.eloWeight !== cur.eloWeight || best.edgeDivisor !== cur.edgeDivisor) && curMae - best.mae >= 0.1) {
    const diffs = bootstrap(parts, (s) => mae(s, best.eloWeight, best.edgeDivisor) - mae(s, cur.eloWeight, cur.edgeDivisor), 31);
    const p95 = quantile(diffs, 0.95);
    proposal = { to: best, from: cur, significant: p95 < 0, evidence: `margin error ${f1(best.mae)} vs ${f1(curMae)}, n=${parts.length}, bootstrap 95th pct ${sign(p95)}${f1(p95)}` };
  }
  return { n: parts.length, cur, curMae, best, proposal, grid };
}

/* ------------------------------------------------------------ (d) total bias */

function tuneTotal(graded, applied) {
  const rows = [];
  for (const g of graded) {
    const mt = g.pregame.projection?.modelTotal;
    if (typeof mt !== "number" || !g.postgame?.score) continue;
    rows.push({ model: mt, market: g.pregame.total, actual: g.postgame.score.home + g.postgame.score.away });
  }
  const vsMarket = rows.filter((r) => typeof r.market === "number");
  const biasMarket = mean(vsMarket.map((r) => r.model - r.market));
  const biasActual = mean(rows.map((r) => r.model - r.actual));
  const leanRows = graded.filter((g) => g.postgame?.projectionResult?.totalLeanRight !== undefined);
  const leanRight = leanRows.length ? leanRows.filter((g) => g.postgame.projectionResult.totalLeanRight).length / leanRows.length : NaN;
  let proposal = null;
  if (rows.length >= 10 && Number.isFinite(biasActual) && Math.abs(biasActual) >= 1) {
    const boots = bootstrap(rows, (s) => mean(s.map((r) => r.model - r.actual)), 41);
    const p5 = quantile(boots, 0.05), p95 = quantile(boots, 0.95);
    const significant = biasActual > 0 ? p5 > 0 : p95 < 0;
    // Each team gets the offset, so the total moves by twice the offset. Half points, at most 2 points per run, inside bounds.
    const step = clamp(Math.round((-biasActual / 2) * 2) / 2, -2, 2);
    const to = clamp(Math.round((applied.totalBaselineOffset + step) * 2) / 2, APPLIED_BOUNDS.totalBaselineOffset.min, APPLIED_BOUNDS.totalBaselineOffset.max);
    if (to !== applied.totalBaselineOffset) proposal = { from: applied.totalBaselineOffset, to, significant, evidence: `model total ran ${sign(biasActual)}${f1(biasActual)} vs the final and ${sign(biasMarket)}${f1(biasMarket)} vs the market, n=${rows.length}, bootstrap 90% band ${sign(p5)}${f1(p5)} to ${sign(p95)}${f1(p95)}` };
  }
  return { n: rows.length, nMarket: vsMarket.length, biasMarket, biasActual, leanRight, leanN: leanRows.length, proposal };
}

/* ------------------------------------------------------------ main */

const entries = await loadEntries();
const graded = entries.filter((e) => e.postgame);
log(`tune: ${entries.length} archived games, ${graded.length} graded (gate ${MIN_GAMES})${DRY ? ", dry run" : ""}`);

const rawWeights = readWeightsFile();
const applied = currentApplied(rawWeights);
log(`applied now: edgeThreshold ${applied.edgeThreshold}, totalBaselineOffset ${applied.totalBaselineOffset}, eloWeight ${applied.eloWeight}, edgeDivisor ${applied.edgeDivisor}`);

const a = tuneEdgeThreshold(graded, applied);
log(`\n(a) edge threshold: ${a.withGap} of ${a.total} graded edges carry a gap (older locks do not; they re-lock with one)`);
for (const s of a.sweep) log(`    T=${s.T}: played out ${pct(s.rate)} of ${s.n} called${s.T === applied.edgeThreshold ? "  <- current" : ""}`);
if (a.proposal) log(`    best ${a.proposal.to} vs current ${a.proposal.from}: ${a.proposal.evidence} -> ${a.proposal.significant ? "outside noise" : "inside noise"}`);
else log(`    no threshold beats the current one by 3 points with 30 or more calls`);

const b = scoreVsExcitement(graded);
log(`\n(b) Scout Score vs excitement: r=${Number.isFinite(b.r) ? b.r.toFixed(2) : "–"} over ${b.n} games with an excitement index; ${b.withComps} carry components`);
for (const c of b.comps) log(`    ${c.k.padEnd(16)} weight ${c.weight}  r=${Number.isFinite(c.r) ? c.r.toFixed(2) : "–"}  n=${c.n}`);
for (const p of b.proposals) log(`    proposal: ${p.metric} ${p.from} to ${p.to} (${p.evidence})`);

const rows = projectionRows(graded);
const winner = rows.length ? rows.filter((r) => r.winnerRight).length / rows.length : NaN;
const sided = rows.filter((r) => r.sideCovered !== undefined);
log(`\n(c) projection: winner ${pct(winner)} of ${rows.length}; model side covered ${pct(sided.length ? sided.filter((r) => r.sideCovered).length / sided.length : NaN)} of ${sided.length}`);
for (const bk of byLean(rows)) log(`    lean ${bk.label.padEnd(9)} n=${bk.n}  winner ${pct(bk.winner)}  side ${pct(bk.side)} of ${bk.sideN}`);
const c = tuneBlend(rows, applied);
if (c.n < 10) log(`    blend re-fit needs locked parts (eloMargin, netEdge): ${c.n} games carry them so far`);
else {
  log(`    blend: current eloWeight ${c.cur.eloWeight}, edgeDivisor ${c.cur.edgeDivisor} margin error ${f1(c.curMae)}; best ${c.best.eloWeight}/${c.best.edgeDivisor} at ${f1(c.best.mae)} on ${c.n}`);
  if (c.proposal) log(`    ${c.proposal.evidence} -> ${c.proposal.significant ? "outside noise" : "inside noise"}`);
}

const d = tuneTotal(graded, applied);
log(`\n(d) total: model minus final ${sign(d.biasActual)}${f1(d.biasActual)} (n=${d.n}); model minus market ${sign(d.biasMarket)}${f1(d.biasMarket)} (n=${d.nMarket}); total lean right ${pct(d.leanRight)} of ${d.leanN}`);
if (d.proposal) log(`    offset ${d.proposal.from} to ${d.proposal.to}: ${d.proposal.evidence} -> ${d.proposal.significant ? "outside noise" : "inside noise"}`);

/* ------------------------------------------------------------ decide and write */

if (graded.length < MIN_GAMES) {
  log(`\nnot enough data: ${graded.length} of ${MIN_GAMES} graded games. Nothing written. This was a dry-run summary.`);
  process.exit(0);
}

const changes = [];
const next = { ...applied };
if (a.proposal) changes.push({ date: NOW, metric: "edge threshold", from: a.proposal.from, to: a.proposal.to, evidence: a.proposal.evidence, applied: a.proposal.significant, key: "edgeThreshold" });
if (d.proposal) changes.push({ date: NOW, metric: "total baseline offset", from: d.proposal.from, to: d.proposal.to, evidence: d.proposal.evidence, applied: d.proposal.significant, key: "totalBaselineOffset" });
if (c.proposal) {
  const sig = c.proposal.significant;
  if (c.proposal.to.eloWeight !== c.proposal.from.eloWeight) changes.push({ date: NOW, metric: "eloWeight", from: c.proposal.from.eloWeight, to: c.proposal.to.eloWeight, evidence: c.proposal.evidence, applied: sig, key: "eloWeight" });
  if (c.proposal.to.edgeDivisor !== c.proposal.from.edgeDivisor) changes.push({ date: NOW, metric: "edgeDivisor", from: c.proposal.from.edgeDivisor, to: c.proposal.to.edgeDivisor, evidence: c.proposal.evidence, applied: sig, key: "edgeDivisor" });
}
for (const p of b.proposals) changes.push({ date: NOW, metric: p.metric, from: p.from, to: p.to, evidence: p.evidence, applied: false });

if (!changes.length) {
  log(`\nnothing to change: every parameter is inside noise on ${graded.length} graded games. Nothing written.`);
  process.exit(0);
}

for (const ch of changes) {
  if (ch.applied && ch.key) {
    const b2 = APPLIED_BOUNDS[ch.key];
    const v = clamp(ch.to, b2.min, b2.max);
    if (v !== ch.to) { ch.evidence += `; clamped to ${v}`; ch.to = v; }
    next[ch.key] = v;
  }
  log(`${ch.applied ? "APPLY   " : "PROPOSE "} ${ch.metric} ${ch.from} to ${ch.to} (${ch.evidence})`);
}

if (DRY) {
  log(`\ndry run: nothing written.`);
  process.exit(0);
}

const anyApplied = changes.some((ch) => ch.applied);
if (anyApplied) {
  next.updatedAt = NOW;
  const out = { ...rawWeights, applied: next };
  mkdirSync(path.dirname(WEIGHTS_FILE), { recursive: true });
  writeFileSync(WEIGHTS_FILE, JSON.stringify(out, null, 2));
  log(`wrote ${path.relative(root, WEIGHTS_FILE)} applied: ${JSON.stringify(next)}`);
}
let changelog = [];
if (existsSync(CHANGELOG_FILE)) {
  try { changelog = JSON.parse(readFileSync(CHANGELOG_FILE, "utf8")); } catch { changelog = []; }
  if (!Array.isArray(changelog)) changelog = [];
}
for (const ch of changes) changelog.push({ date: ch.date, metric: ch.metric, from: ch.from, to: ch.to, evidence: ch.evidence, applied: ch.applied });
writeFileSync(CHANGELOG_FILE, JSON.stringify(changelog, null, 1));
log(`wrote ${changes.length} changelog entr${changes.length === 1 ? "y" : "ies"} to ${path.relative(root, CHANGELOG_FILE)}`);
