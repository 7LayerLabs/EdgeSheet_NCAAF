/**
 * Backtest: replay the radar, draft forecast, and game projection on past seasons
 * and grade them against what actually happened.
 *
 *   node scripts/backtest.mjs                 # seasons 2022..2025, reuses data/backtest/<season>/ digests if present
 *   SEASONS=2023,2024 node scripts/backtest.mjs
 *   REFETCH=1 node scripts/backtest.mjs       # ignore cached digests and pull from CFBD again
 *   SKIP_NFL=1 node scripts/backtest.mjs      # skip the nflverse download
 *
 * Writes:
 *   data/backtest/<season>/{players,teams,games,lines,draft,meta}.json   compact digests (same shapes as data/generated)
 *   data/backtest/nflverse_draft_picks.csv                                nflverse draft picks with career value (public)
 *   data/backtest/results.json                                            every metric, per season and overall
 *   data/weights.json                                                     recommended weights with the evidence
 *
 * CFBD calls are sequential with a pause and a 429 backoff. One season's failure skips that season and says so.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, makeGet, digestPlayers, digestTeams, digestDraft } from "./lib/digest.mjs";
import {
  DRIFT, buildRadar, forecastBoard, DRAFT_GROUP_OF, buildTendencies, eloMargin, edgeNet, modelTotal, blendMargin, LIVE, probFromMargin,
  spearman, pearson, mean,
} from "./lib/models.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "backtest");
const SEASONS = (process.env.SEASONS ?? "2022,2023,2024,2025").split(",").map(Number);
const REFETCH = !!process.env.REFETCH;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const KEY = await loadKey(root);
if (!KEY) {
  console.error("backtest: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}
const get = makeGet(KEY, log, { pause: 150 });

const exists = async (f) => access(f).then(() => true, () => false);
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
const writeJson = (f, v, pretty = false) => writeFile(f, pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v));

/* ----------------------------------------------------------- helpers */

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return undefined;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const half = (n) => Math.round(n * 2) / 2;
const r3 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1000) / 1000);
const rate = (a, b) => (b ? r3(a / b) : null);

const normName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/* ------------------------------------------------- caches across seasons */
const recruitCache = new Map();
const draftCache = new Map();
async function recruits(y) {
  if (!recruitCache.has(y)) recruitCache.set(y, await get(`/recruiting/players?year=${y}&classification=HighSchool`, { optional: true }));
  return recruitCache.get(y);
}
async function draftPicks(y) {
  if (!draftCache.has(y)) draftCache.set(y, await get(`/draft/picks?year=${y}`, { optional: true }));
  return draftCache.get(y);
}

/* ------------------------------------------------------- fetch + digest */

async function loadSeason(season) {
  const dir = path.join(OUT, String(season));
  const files = ["players", "teams", "games", "lines", "draft", "advWeeks", "meta"].map((f) => path.join(dir, `${f}.json`));
  if (!REFETCH && (await Promise.all(files.map(exists))).every(Boolean)) {
    log(season, "using cached digests");
    const [players, teams, games, lines, draft, advWeeks, meta] = await Promise.all(files.map(readJson));
    return { players, teams, games, lines, draft, advWeeks, meta };
  }
  log(season, "fetching");
  const teamsRaw = await get(`/teams?year=${season}`);
  const roster = await get(`/roster?year=${season}`);
  const stats = await get(`/stats/player/season?year=${season}`);
  const usage = await get(`/player/usage?year=${season}`, { optional: true });
  const records = await get(`/records?year=${season}`, { optional: true });
  const advFbs = await get(`/stats/season/advanced?year=${season}`, { optional: true });
  log(season, "teams", teamsRaw.length, "roster", roster.length, "stat rows", stats.length, "usage", usage.length, "adv", advFbs.length);
  const recruiting = [];
  for (const y of [season - 4, season - 3, season - 2, season - 1, season]) recruiting.push(...(await recruits(y)));
  const draft = [];
  for (const y of [season - 4, season - 3, season - 2, season - 1, season, season + 1]) draft.push(...(await draftPicks(y)));
  const gamesRaw = await get(`/games?year=${season}&seasonType=regular`);
  const linesRaw = await get(`/lines?year=${season}&seasonType=regular`);
  log(season, "recruits", recruiting.length, "draft", draft.length, "games", gamesRaw.length, "lines", linesRaw.length);

  // Walk-forward tables: advanced stats through each week, so week W games can be graded on what was known before them.
  // Team game counts come from the completed schedule through that week (all divisions, so FBS vs DII games count for pace).
  const lastWeek = Math.max(...gamesRaw.map((g) => g.week ?? 0));
  const advWeeks = {};
  for (let w = 1; w < lastWeek; w++) {
    const rows = await get(`/stats/season/advanced?year=${season}&endWeek=${w}`, { optional: true });
    if (!rows.length) continue;
    const played = new Map();
    for (const g of gamesRaw) {
      if (!g.completed || (g.week ?? 99) > w) continue;
      played.set(g.homeTeam, (played.get(g.homeTeam) ?? 0) + 1);
      played.set(g.awayTeam, (played.get(g.awayTeam) ?? 0) + 1);
    }
    const rec = [...played].map(([team, games]) => ({ team, total: { games } }));
    advWeeks[w] = digestTeams({ teams: teamsRaw, records: rec, advFbs: rows, advFcs: [] });
  }
  log(season, "walk-forward weeks", Object.keys(advWeeks).join(","));

  const { players } = digestPlayers({ teams: teamsRaw, roster, stats, usage, records, recruiting });
  const teams = digestTeams({ teams: teamsRaw, records, advFbs, advFcs: [] });
  const draftOut = digestDraft(draft);
  const games = gamesRaw
    .filter((g) => (g.homeClassification === "fbs" || g.homeClassification === "fcs") || (g.awayClassification === "fbs" || g.awayClassification === "fcs"))
    .map((g) => ({
      id: g.id, wk: g.week, start: g.startDate, neutral: !!g.neutralSite, conf: !!g.conferenceGame, completed: !!g.completed,
      home: g.homeTeam, away: g.awayTeam, hc: g.homeClassification, ac: g.awayClassification,
      hp: g.homePoints ?? null, ap: g.awayPoints ?? null, hElo: g.homePregameElo ?? null, aElo: g.awayPregameElo ?? null, ex: g.excitementIndex ?? null,
    }));
  const lines = linesRaw
    .map((l) => {
      const rows = (l.lines ?? []).filter((x) => x.spread != null);
      if (!rows.length) return null;
      const spread = half(median(rows.map((x) => x.spread)));
      const spreadOpen = median(rows.map((x) => x.spreadOpen).filter((n) => n != null));
      const total = median(rows.map((x) => x.overUnder).filter((n) => n != null));
      const totalOpen = median(rows.map((x) => x.overUnderOpen).filter((n) => n != null));
      return { id: l.id, spread, spreadOpen: spreadOpen === undefined ? null : half(spreadOpen), total: total === undefined ? null : half(total), totalOpen: totalOpen === undefined ? null : half(totalOpen), books: rows.length };
    })
    .filter(Boolean);
  const meta = {
    ingestedAt: new Date().toISOString(), season, players: players.length, teams: teams.length, games: games.length, lines: lines.length,
    draftPicks: draftOut.length, draftYears: [...new Set(draftOut.map((d) => d.year))].sort(), recruits: recruiting.length,
    walkForwardWeeks: Object.keys(advWeeks).map(Number),
  };
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "players.json"), players);
  await writeJson(path.join(dir, "teams.json"), teams);
  await writeJson(path.join(dir, "games.json"), games);
  await writeJson(path.join(dir, "lines.json"), lines);
  await writeJson(path.join(dir, "draft.json"), draftOut);
  await writeJson(path.join(dir, "advWeeks.json"), advWeeks);
  await writeJson(path.join(dir, "meta.json"), meta, true);
  log(season, "wrote", dir);
  return { players, teams, games, lines, draft: draftOut, advWeeks, meta };
}

/* ----------------------------------------------------- projection grade */

const ELO_WEIGHTS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const DIVISORS = [20, 30, 40, 60];

function newAcc() {
  return { games: 0, winnerGraded: 0, winnerRight: 0, absErr: 0, sqErr: 0, coverGraded: 0, coverRight: 0, lean2Graded: 0, lean2Right: 0, lean4Graded: 0, lean4Right: 0 };
}
function grade(acc, margin, actual, marketMargin) {
  acc.games++;
  if (actual !== 0) {
    acc.winnerGraded++;
    if (Math.sign(margin) === Math.sign(actual) || (margin === 0 && actual > 0)) acc.winnerRight++;
  }
  acc.absErr += Math.abs(margin - actual);
  acc.sqErr += (margin - actual) ** 2;
  if (marketMargin != null) {
    const diff = margin - marketMargin; // positive: model likes home more than the market
    const result = actual - marketMargin; // positive: home covered
    if (result !== 0) {
      const right = Math.sign(diff >= 0 ? 1 : -1) === Math.sign(result);
      acc.coverGraded++;
      if (right) acc.coverRight++;
      if (Math.abs(diff) >= 2) { acc.lean2Graded++; if (right) acc.lean2Right++; }
      if (Math.abs(diff) >= 4) { acc.lean4Graded++; if (right) acc.lean4Right++; }
    }
  }
}
function mergeAcc(a, b) {
  for (const k of Object.keys(b)) a[k] = (a[k] ?? 0) + b[k];
  return a;
}
function finishAcc(a) {
  return {
    games: a.games,
    winnerRate: rate(a.winnerRight, a.winnerGraded), winnerRight: a.winnerRight, winnerGraded: a.winnerGraded,
    mae: a.games ? r3(a.absErr / a.games) : null, rmse: a.games ? r3(Math.sqrt(a.sqErr / a.games)) : null,
    coverRate: rate(a.coverRight, a.coverGraded), coverRight: a.coverRight, coverGraded: a.coverGraded,
    lean2CoverRate: rate(a.lean2Right, a.lean2Graded), lean2Graded: a.lean2Graded,
    lean4CoverRate: rate(a.lean4Right, a.lean4Graded), lean4Graded: a.lean4Graded,
  };
}

/**
 * mode "full": every team's full-season stats (leaks the graded game into its own inputs; flagged everywhere).
 * mode "walk": stats through the week before the game, games from MIN_WALK_WEEK on. The honest number.
 */
const MIN_WALK_WEEK = 4;
function gradeProjection(season, data, mode = "full") {
  const fullTend = buildTendencies(data.teams);
  const weekTend = new Map();
  const tendFor = (g) => {
    if (mode === "full") return fullTend;
    const w = (g.wk ?? 0) - 1;
    if (w < MIN_WALK_WEEK - 1 || !data.advWeeks?.[w]) return undefined;
    if (!weekTend.has(w)) weekTend.set(w, buildTendencies(data.advWeeks[w]));
    return weekTend.get(w);
  };
  const linesById = new Map(data.lines.map((l) => [l.id, l]));
  const configs = [];
  for (const w of ELO_WEIGHTS) for (const d of DIVISORS) {
    if (w === 1 && d !== DIVISORS[0]) continue; // Elo-only does not depend on the divisor
    configs.push({ eloWeight: w, edgeDivisor: d, net: "live", acc: newAcc() });
  }
  for (const d of DIVISORS) configs.push({ eloWeight: LIVE.eloWeight, edgeDivisor: d, net: "raw", acc: newAcc() });
  const market = newAcc();
  const favorite = { graded: 0, covered: 0 };
  const total = { graded: 0, leans: 0, leanRight: 0, over: 0, overRight: 0, under: 0, underRight: 0, modelAbsErr: 0, marketAbsErr: 0, both: 0, pushes: 0 };
  const calib = Array.from({ length: 5 }, (_, i) => ({ lo: 0.5 + i * 0.1, hi: 0.6 + i * 0.1, games: 0, wins: 0 }));
  let eligible = 0, noLine = 0, noElo = 0, notCharted = 0;

  for (const g of data.games) {
    if (!(g.hc === "fbs" && g.ac === "fbs" && g.completed && g.hp != null && g.ap != null)) continue;
    if (mode === "walk" && (g.wk ?? 0) < MIN_WALK_WEEK) continue;
    eligible++;
    const tend = tendFor(g);
    const elo = eloMargin(g.hElo, g.aElo, g.neutral);
    const net = tend ? edgeNet(tend, g.home, g.away) : undefined;
    if (elo === undefined) { noElo++; continue; }
    if (!net) { notCharted++; continue; }
    const actual = g.hp - g.ap;
    const line = linesById.get(g.id);
    const marketMargin = line ? -line.spread : null;
    if (marketMargin == null) noLine++;

    for (const c of configs) grade(c.acc, blendMargin(elo, c.net === "raw" ? net.raw : net.live, c.eloWeight, c.edgeDivisor), actual, marketMargin);

    if (marketMargin != null) {
      grade(market, marketMargin, actual, null);
      const result = actual - marketMargin;
      if (result !== 0 && marketMargin !== 0) {
        favorite.graded++;
        if (Math.sign(result) === Math.sign(marketMargin)) favorite.covered++;
      }
      // Win probability calibration for the live blend.
      const m = blendMargin(elo, net.live);
      const p = probFromMargin(Math.abs(m));
      const won = actual !== 0 && Math.sign(m) === Math.sign(actual);
      const b = calib.find((x) => p >= x.lo && (p < x.hi || (x.hi >= 1 && p <= 1)));
      if (b && actual !== 0) { b.games++; if (won) b.wins++; }
    }

    // Totals: model total from efficiency and pace against the closing total.
    const mt = modelTotal(tend, g.home, g.away, "fbs");
    if (mt && line?.total != null) {
      const actualTotal = g.hp + g.ap;
      total.graded++;
      total.modelAbsErr += Math.abs(mt.total - actualTotal);
      total.marketAbsErr += Math.abs(line.total - actualTotal);
      const gap = mt.total - line.total;
      const lean = gap >= 2.5 ? "over" : gap <= -2.5 ? "under" : "none";
      if (lean !== "none") {
        if (actualTotal === line.total) total.pushes++;
        else {
          total.leans++;
          const right = lean === "over" ? actualTotal > line.total : actualTotal < line.total;
          if (right) total.leanRight++;
          if (lean === "over") { total.over++; if (right) total.overRight++; }
          else { total.under++; if (right) total.underRight++; }
        }
      }
    }
  }

  return {
    season,
    mode,
    counts: { fbsCompleted: eligible, graded: configs[0].acc.games, noElo, notCharted, noClosingLine: noLine },
    market: { ...finishAcc(market), favoriteCoverRate: rate(favorite.covered, favorite.graded), favoriteGraded: favorite.graded },
    grid: configs.map((c) => ({ eloWeight: c.eloWeight, edgeDivisor: c.edgeDivisor, net: c.net, ...finishAcc(c.acc) })),
    total: {
      graded: total.graded, leans: total.leans, leanRate: rate(total.leanRight, total.leans), leanRight: total.leanRight,
      overLeans: total.over, overRate: rate(total.overRight, total.over), underLeans: total.under, underRate: rate(total.underRight, total.under),
      modelMae: total.graded ? r3(total.modelAbsErr / total.graded) : null, marketMae: total.graded ? r3(total.marketAbsErr / total.graded) : null, pushes: total.pushes,
    },
    calibration: calib.map((b) => ({ bucket: `${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}%`, games: b.games, winRate: rate(b.wins, b.games) })),
    _raw: { configs: configs.map((c) => c.acc), market, favorite, total, calib },
  };
}

/* --------------------------------------------------- excitement grade */

function gradeExcitement(season, data) {
  const tend = buildTendencies(data.teams);
  const linesById = new Map(data.lines.map((l) => [l.id, l]));
  const all = []; // { ex, competitive, contrast | null }
  const buckets = [
    { label: "under 40", lo: -1, hi: 40, ex: [] },
    { label: "40 to 59", lo: 40, hi: 60, ex: [] },
    { label: "60 to 79", lo: 60, hi: 80, ex: [] },
    { label: "80 and up", lo: 80, hi: 101, ex: [] },
  ];
  for (const g of data.games) {
    if (g.ex == null || !g.completed) continue;
    const line = linesById.get(g.id);
    let competitive;
    if (line) competitive = Math.max(5, Math.round(100 - Math.abs(line.spread) * 4.2));
    else if (g.hElo != null && g.aElo != null) competitive = Math.max(5, Math.round(100 - Math.abs(g.hElo - g.aElo) / 5));
    else continue;
    const contrast = tend.styleContrast(g.away, g.home);
    all.push({ ex: g.ex, competitive, contrast });
    const b = buckets.find((x) => competitive >= x.lo && competitive < x.hi);
    if (b) b.ex.push(g.ex);
  }
  const charted = all.filter((x) => x.contrast != null);
  const corr = (rows, f) => ({ n: rows.length, pearson: r3(pearson(rows.map(f), rows.map((x) => x.ex))), spearman: r3(spearman(rows.map(f), rows.map((x) => x.ex))) });
  return {
    season,
    games: all.length,
    competitive: corr(all, (x) => x.competitive),
    styleContrast: corr(charted, (x) => x.contrast),
    proxy: corr(charted, (x) => (x.competitive + x.contrast) / 2),
    byCompetitiveBucket: buckets.map((b) => ({ label: b.label, games: b.ex.length, avgExcitement: r3(mean(b.ex)) })),
  };
}

/* -------------------------------------------------------- draft grade */

const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "CB", "S"];
const BANDS = ["Round 1 range", "Day 2 range", "Day 3 range", "Priority free agent"];

function newDraftAcc() {
  return { drafted: 0, onRadar: 0, inPool: 0, r1: 0, r1Hit: 0, r1OrDay2Hit: 0, top100: 0, top100Hit: 0, matchedById: 0, matchedByName: 0, pairs: [] };
}

function gradeDraft(season, data) {
  const draftYear = season + 1;
  const radar = buildRadar(data.players, draftYear);
  const demandPicks = data.draft.filter((d) => d.year >= season - 4 && d.year <= season);
  const test = data.draft.filter((d) => d.year === draftYear);
  if (!test.length) return { season, draftYear, available: false, reason: `CFBD has no ${draftYear} draft picks yet` };
  const fc = forecastBoard(radar, draftYear, demandPicks);
  const entryById = new Map(fc.board.map((e) => [e.player.id, e]));
  const radarById = new Map(radar.map((p) => [p.id, p]));
  const byNameTeam = new Map();
  const byName = new Map();
  for (const p of radar) {
    const n = normName(p.name);
    byNameTeam.set(`${n}|${p.team}`, p);
    (byName.get(n) ?? byName.set(n, []).get(n)).push(p);
  }

  const total = newDraftAcc();
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, newDraftAcc()]));
  const bandTruth = Object.fromEntries(BANDS.map((b) => [b, { entries: 0, drafted: 0, r1: 0, top100: 0 }]));
  for (const e of fc.board) bandTruth[e.band].entries++;
  const matched = []; // for the NFL join

  for (const d of test) {
    const group = DRAFT_GROUP_OF[d.pos] ?? null;
    if (!group || group === "ST") continue;
    let p = d.collegeAthleteId != null ? radarById.get(String(d.collegeAthleteId)) : undefined;
    let how = p ? "id" : null;
    if (!p) {
      const n = normName(d.name);
      p = byNameTeam.get(`${n}|${d.college}`);
      if (!p) { const c = byName.get(n); if (c?.length === 1) p = c[0]; }
      if (p) how = "name";
    }
    const e = p ? entryById.get(p.id) : undefined;
    const accs = [total, byGroup[group] ?? (byGroup[group] = newDraftAcc())];
    for (const a of accs) {
      a.drafted++;
      if (p) { a.onRadar++; if (how === "id") a.matchedById++; else a.matchedByName++; }
      if (e) a.inPool++;
      if (d.round === 1) { a.r1++; if (e?.band === "Round 1 range") a.r1Hit++; }
      if (d.overall <= 100) { a.top100++; if (e && (e.band === "Round 1 range" || e.band === "Day 2 range")) a.top100Hit++; }
      if (e) a.pairs.push([e.overall, d.overall]);
    }
    if (e) {
      bandTruth[e.band].drafted++;
      if (d.round === 1) bandTruth[e.band].r1++;
      if (d.overall <= 100) bandTruth[e.band].top100++;
    }
    matched.push({ draftYear, name: d.name, college: d.college, group, overall: d.overall, round: d.round, radar: p ? { id: p.id, score: p.score, production: p.production, pedigree: p.pedigree, usage: p.usage, size: p.size, tier: p.tier, stars: p.stars, classYear: p.classYear } : null, forecast: e ? { overall: e.overall, band: e.band } : null });
  }

  const finish = (a) => ({
    drafted: a.drafted, onRadar: a.onRadar, onRadarRate: rate(a.onRadar, a.drafted), inPool: a.inPool, inPoolRate: rate(a.inPool, a.drafted),
    r1: a.r1, r1Hit: a.r1Hit, r1HitRate: rate(a.r1Hit, a.r1), top100: a.top100, top100Hit: a.top100Hit, top100HitRate: rate(a.top100Hit, a.top100),
    matchedById: a.matchedById, matchedByName: a.matchedByName,
    rankCorrelation: a.pairs.length >= 3 ? r3(spearman(a.pairs.map((x) => x[0]), a.pairs.map((x) => x[1]))) : null, correlationN: a.pairs.length,
  });
  return {
    season, draftYear, available: true,
    poolSize: fc.poolSize, boardSize: fc.board.length, radarSize: radar.length,
    bands: BANDS.map((b) => ({ band: b, entries: bandTruth[b].entries, drafted: bandTruth[b].drafted, draftedRate: rate(bandTruth[b].drafted, bandTruth[b].entries), r1: bandTruth[b].r1, top100: bandTruth[b].top100 })),
    total: finish(total),
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, finish(byGroup[g])])),
    _raw: { total, byGroup, bandTruth, matched },
  };
}

/* ------------------------------------------------------------ nflverse */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function loadNflverse() {
  const f = path.join(OUT, "nflverse_draft_picks.csv");
  if (!(await exists(f))) {
    const url = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv";
    log("nflverse download", url);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`nflverse -> ${res.status}`);
    await writeFile(f, await res.text());
  }
  return parseCsv(await readFile(f, "utf8"));
}

function gradeNfl(nfl, matchedAll) {
  const num = (v) => (v === "" || v == null || v === "NA" ? null : Number(v));
  const key = (name, year) => `${normName(name)}|${year}`;
  const byKey = new Map();
  for (const r of nfl) {
    const yr = num(r.season);
    if (!yr || yr < 2023) continue;
    (byKey.get(key(r.pfr_player_name, yr)) ?? byKey.set(key(r.pfr_player_name, yr), []).get(key(r.pfr_player_name, yr))).push(r);
  }
  const current = Math.max(...nfl.map((r) => num(r.to) ?? 0));
  const rows = [];
  for (const m of matchedAll) {
    if (!m.radar) continue;
    const cands = byKey.get(key(m.name, m.draftYear)) ?? [];
    const r = cands.length === 1 ? cands[0] : cands.find((c) => normName(c.college) === normName(m.college)) ?? cands.find((c) => num(c.pick) === m.overall);
    if (!r) continue;
    const wav = num(r.w_av);
    const carav = num(r.car_av);
    const to = num(r.to);
    const seasons = to != null ? Math.max(1, to - m.draftYear + 1) : null;
    rows.push({ ...m, nfl: { wav, carav, seasons, games: num(r.games), started: num(r.seasons_started), to } });
  }
  const avOf = (x) => (x.nfl.wav ?? x.nfl.carav ?? 0) / Math.max(1, x.nfl.seasons ?? 1);
  const summarize = (list, label) => {
    const n = list.length;
    const av = list.map(avOf);
    return {
      group: label, n,
      avgValuePerSeason: r3(mean(av)),
      production: r3(spearman(list.map((x) => x.radar.production), av)),
      pedigree: r3(spearman(list.map((x) => x.radar.pedigree), av)),
      usage: r3(spearman(list.map((x) => x.radar.usage), av)),
      radarScore: r3(spearman(list.map((x) => x.radar.score), av)),
      realPick: r3(spearman(list.map((x) => -x.overall), av)),
    };
  };
  const byDraft = {};
  for (const r of rows) (byDraft[r.draftYear] ??= []).push(r);
  return {
    source: "nflverse-data draft_picks.csv (w_av, car_av, to, games). Joined on normalized name + draft year, college or pick as a tie-breaker.",
    lastNflSeason: current,
    matched: rows.length,
    ofRadarDraftees: matchedAll.filter((m) => m.radar).length,
    valueMetric: "approximate value (w_av, falling back to car_av) divided by seasons played, so a 2023 pick and a 2025 pick are on the same footing",
    overall: summarize(rows, "all"),
    byGroup: GROUPS.map((g) => summarize(rows.filter((x) => x.group === g), g)).filter((x) => x.n >= 8),
    byDraftYear: Object.entries(byDraft).map(([y, list]) => ({ draftYear: Number(y), ...summarize(list, "all") })),
  };
}

/* ---------------------------------------------------------------- run */

const seasonsDone = [];
const skipped = [];
const projection = [], walk = [], excitement = [], draft = [];
const matchedAll = [];

for (const season of SEASONS) {
  let data;
  try {
    data = await loadSeason(season);
  } catch (e) {
    log(season, "FAILED", e.message);
    skipped.push({ season, reason: e.message });
    continue;
  }
  seasonsDone.push(season);
  const liveRow = (p) => p.grid.find((c) => c.eloWeight === LIVE.eloWeight && c.edgeDivisor === LIVE.edgeDivisor && c.net === "live");
  const pj = gradeProjection(season, data, "full");
  projection.push(pj);
  log(season, "full-season replay", pj.counts.graded, "games; live blend winner", liveRow(pj)?.winnerRate, "mae", liveRow(pj)?.mae);
  const wk = gradeProjection(season, data, "walk");
  walk.push(wk);
  log(season, "walk-forward", wk.counts.graded, "games; live blend winner", liveRow(wk)?.winnerRate, "mae", liveRow(wk)?.mae, "cover", liveRow(wk)?.coverRate);
  excitement.push(gradeExcitement(season, data));
  const dr = gradeDraft(season, data);
  draft.push(dr);
  if (dr.available) { matchedAll.push(...dr._raw.matched); log(season, "draft", dr.draftYear, "R1 hit", dr.total.r1Hit, "of", dr.total.r1, "; on radar", dr.total.onRadar, "of", dr.total.drafted); }
  else log(season, "draft", dr.reason);
}

/* -------------------------------------------------------- aggregate */

function aggregateProjection(projection) {
  if (!projection.length) return null;
  const n = projection[0]._raw.configs.length;
  const configs = Array.from({ length: n }, () => newAcc());
  const market = newAcc();
  const favorite = { graded: 0, covered: 0 };
  const total = { graded: 0, leans: 0, leanRight: 0, over: 0, overRight: 0, under: 0, underRight: 0, modelAbsErr: 0, marketAbsErr: 0, both: 0, pushes: 0 };
  const calib = projection[0]._raw.calib.map((b) => ({ ...b, games: 0, wins: 0 }));
  const counts = { fbsCompleted: 0, graded: 0, noElo: 0, notCharted: 0, noClosingLine: 0 };
  for (const p of projection) {
    p._raw.configs.forEach((c, i) => mergeAcc(configs[i], c));
    mergeAcc(market, p._raw.market);
    favorite.graded += p._raw.favorite.graded; favorite.covered += p._raw.favorite.covered;
    mergeAcc(total, p._raw.total);
    p._raw.calib.forEach((b, i) => { calib[i].games += b.games; calib[i].wins += b.wins; });
    for (const k of Object.keys(counts)) counts[k] += p.counts[k];
  }
  const grid = projection[0].grid.map((c, i) => ({ eloWeight: c.eloWeight, edgeDivisor: c.edgeDivisor, net: c.net, ...finishAcc(configs[i]) }));
  return {
    seasons: seasonsDone,
    mode: projection[0].mode,
    counts,
    market: { ...finishAcc(market), favoriteCoverRate: rate(favorite.covered, favorite.graded), favoriteGraded: favorite.graded },
    grid,
    total: {
      graded: total.graded, leans: total.leans, leanRate: rate(total.leanRight, total.leans), leanRight: total.leanRight,
      overLeans: total.over, overRate: rate(total.overRight, total.over), underLeans: total.under, underRate: rate(total.underRight, total.under),
      modelMae: total.graded ? r3(total.modelAbsErr / total.graded) : null, marketMae: total.graded ? r3(total.marketAbsErr / total.graded) : null, pushes: total.pushes,
    },
    calibration: calib.map((b) => ({ bucket: `${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}%`, games: b.games, winRate: rate(b.wins, b.games) })),
  };
}

function aggregateDraft() {
  const avail = draft.filter((d) => d.available);
  if (!avail.length) return null;
  const total = newDraftAcc();
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, newDraftAcc()]));
  const bandTruth = Object.fromEntries(BANDS.map((b) => [b, { entries: 0, drafted: 0, r1: 0, top100: 0 }]));
  const add = (a, b) => { for (const k of Object.keys(b)) a[k] = k === "pairs" ? a.pairs.concat(b.pairs) : a[k] + b[k]; };
  for (const d of avail) {
    add(total, d._raw.total);
    for (const g of GROUPS) if (d._raw.byGroup[g]) add(byGroup[g], d._raw.byGroup[g]);
    for (const b of BANDS) for (const k of Object.keys(bandTruth[b])) bandTruth[b][k] += d._raw.bandTruth[b][k];
  }
  const finish = (a) => ({
    drafted: a.drafted, onRadar: a.onRadar, onRadarRate: rate(a.onRadar, a.drafted), inPool: a.inPool, inPoolRate: rate(a.inPool, a.drafted),
    r1: a.r1, r1Hit: a.r1Hit, r1HitRate: rate(a.r1Hit, a.r1), top100: a.top100, top100Hit: a.top100Hit, top100HitRate: rate(a.top100Hit, a.top100),
    matchedById: a.matchedById, matchedByName: a.matchedByName,
    rankCorrelation: a.pairs.length >= 3 ? r3(spearman(a.pairs.map((x) => x[0]), a.pairs.map((x) => x[1]))) : null, correlationN: a.pairs.length,
  });
  return {
    draftYears: avail.map((d) => d.draftYear),
    bands: BANDS.map((b) => ({ band: b, entries: bandTruth[b].entries, drafted: bandTruth[b].drafted, draftedRate: rate(bandTruth[b].drafted, bandTruth[b].entries), r1: bandTruth[b].r1, top100: bandTruth[b].top100 })),
    total: finish(total),
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, finish(byGroup[g])])),
  };
}

const projOverall = aggregateProjection(projection);
const walkOverall = aggregateProjection(walk);
const draftOverall = aggregateDraft();

let nfl = null;
if (!process.env.SKIP_NFL && matchedAll.length) {
  try {
    nfl = gradeNfl(await loadNflverse(), matchedAll);
    log("nfl outcomes matched", nfl.matched, "of", nfl.ofRadarDraftees);
  } catch (e) {
    log("nfl outcomes skipped:", e.message);
    nfl = { error: e.message };
  }
}

// Best blend: lowest margin error on the WALK-FORWARD grid (no leakage), live net definition, ties broken by winner rate.
// Cover rate is reported, not optimized: it is the noisiest number here.
const pickBest = (o) => (o ? [...o.grid.filter((c) => c.net === "live" && c.mae != null)].sort((a, b) => a.mae - b.mae || b.winnerRate - a.winnerRate)[0] ?? null : null);
const best = pickBest(walkOverall);
const bestFull = pickBest(projOverall);

const strip = (o) => { const { _raw, ...rest } = o; return rest; };
const results = {
  generatedAt: new Date().toISOString(),
  seasons: seasonsDone,
  skipped,
  drift: DRIFT,
  notes: [
    "Two projection replays. 'walkForward' grades each game with advanced stats through the week before it (from week 4 on), which is what the site would have had. 'projection' uses full-season stats, so each game's own result leaks into its inputs; it is kept for comparison only and flagged.",
    "The radar and draft forecast use full-season stats, which is also what the live site has when the draft page matters most (after the regular season).",
    "Projection is graded only on completed FBS vs FBS regular-season games where both teams have pregame Elo and advanced stats.",
    "Closing line = median across books of the final spread and total that CFBD lists, rounded to the half point, same as the live slate.",
    "Draft hit rates are recall: of the players actually taken, how many did the forecast have in that range. The band table is precision: of the names the forecast put in a band, how many were drafted.",
  ],
  walkForward: walkOverall ? { overall: walkOverall, best, live: LIVE, minWeek: MIN_WALK_WEEK, perSeason: walk.map(strip) } : null,
  projection: projOverall ? { overall: projOverall, best: bestFull, live: LIVE, leaky: true, perSeason: projection.map(strip) } : null,
  excitement: excitement.length ? { perSeason: excitement } : null,
  draft: draftOverall ? { overall: draftOverall, perSeason: draft.map(strip) } : null,
  nfl,
};
await mkdir(OUT, { recursive: true });
await writeJson(path.join(OUT, "results.json"), results, true);
log("wrote", path.join(OUT, "results.json"));

if (best) {
  const liveRow = walkOverall.grid.find((c) => c.net === "live" && c.eloWeight === LIVE.eloWeight && c.edgeDivisor === LIVE.edgeDivisor);
  const eloRow = walkOverall.grid.find((c) => c.net === "live" && c.eloWeight === 1);
  const weights = {
    projection: { eloWeight: best.eloWeight, edgeDivisor: best.edgeDivisor },
    radar: { prod: 0.55, pedigree: 0.22, usage: 0.13, size: 0.1 },
    comment:
      `Walk-forward backtest ${seasonsDone.join(", ")} on ${walkOverall.counts.graded} FBS games from week ${MIN_WALK_WEEK} on, stats through the prior week only. ` +
      `Live blend (eloWeight ${LIVE.eloWeight}, edgeDivisor ${LIVE.edgeDivisor}): winner ${liveRow?.winnerRate}, margin error ${liveRow?.mae}, cover ${liveRow?.coverRate}. ` +
      `Best by margin error: eloWeight ${best.eloWeight}, edgeDivisor ${best.edgeDivisor}: winner ${best.winnerRate}, margin error ${best.mae}, cover ${best.coverRate}. ` +
      `Elo only: winner ${eloRow?.winnerRate}, margin error ${eloRow?.mae}. Closing line on the same games: winner ${walkOverall.market.winnerRate}, margin error ${walkOverall.market.mae}. ` +
      `Note eloWeight scales the Elo margin and (1 - eloWeight) / edgeDivisor is the points per percentile of unit edge, so they are two separate dials, not one slider. ` +
      `Radar weights are the current constants; the draft backtest did not fit them (see data/backtest/README.md). ` +
      `projection.ts reads this file when present; the orchestrator decides whether to adopt it.`,
    generatedAt: new Date().toISOString(),
  };
  await writeJson(path.join(root, "data", "weights.json"), weights, true);
  log("wrote data/weights.json", weights.projection);
}
log("done");
