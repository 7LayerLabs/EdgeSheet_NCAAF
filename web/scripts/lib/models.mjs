/**
 * Plain-Node ports of the site's models so scripts/backtest.mjs can replay them
 * on past seasons without TypeScript.
 *
 *   radar      <- src/lib/radar.ts        (score, tier, production percentile, pedigree, usage, size)
 *   forecast   <- src/lib/forecast.ts     (demand by position from five drafts, bands, board order)
 *   tendencies <- src/lib/tendencies.ts   (percentile ranks inside a classification, unitEdges gaps, styleContrast, leagueMeans)
 *   projection <- src/lib/projection.ts   (Elo margin, unit-edge margin, blend, model total)
 *
 * Formulas are copied, not re-derived. Known differences from the live code are listed in DRIFT below
 * and repeated in data/backtest/README.md.
 */

export const DRIFT = [
  "Declarations (data/declarations.json) are ignored: every junior stays in the pool, which is what the live site does before anyone declares.",
  "The forecast's demand table uses the five drafts before the one being tested (season-4 .. season), exactly like the live ingest; the tested draft is never in its own demand table.",
  "Projection replay has no weather input, so the weather tilt on the model total is zero. Live games also use the week's rosters and partial-season stats; here the stats are full-season.",
  "The live projection reads the four largest of the eight unit edges and treats any gap under 20 percentile points as zero. That is replicated here, plus a labeled variant that keeps all eight signed gaps.",
];

/* ============================================================ radar */

const GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", C: "OL", G: "OL", T: "OL",
  DL: "DL", DT: "DL", NT: "DL", DE: "EDGE", EDGE: "EDGE", OLB: "EDGE",
  LB: "LB", ILB: "LB", MLB: "LB",
  DB: "CB", CB: "CB", S: "S", FS: "S", SS: "S",
  PK: "ST", K: "ST", P: "ST", LS: "ST",
};
export const groupOfPos = (pos) => GROUP[pos ?? ""] ?? null;

const SIZE = {
  QB: { h: 73 }, RB: { w: 205 }, WR: { h: 72 }, TE: { h: 76, w: 240 }, OL: { h: 75, w: 300 },
  DL: { w: 290 }, EDGE: { h: 75, w: 245 }, LB: { w: 228 }, CB: { h: 71 }, S: { w: 195 },
};
const LEVEL = { fbs: 1, fcs: 0.72, ii: 0.5, iii: 0.38 };

function production(p, group) {
  const s = p.s ?? {};
  const g = Math.max(1, p.g ?? 1);
  switch (group) {
    case "QB": {
      if ((s.pa ?? 0) < 40) return 0;
      const ypa = s.ypa ?? (s.py ?? 0) / Math.max(1, s.pa ?? 1);
      const pct = (s.pc ?? 0) / Math.max(1, s.pa ?? 1);
      return (s.py ?? 0) / g * 0.5 + (s.ptd ?? 0) * 12 - (s.pint ?? 0) * 14 + ypa * 18 + pct * 120 + (s.ry ?? 0) / g * 0.6 + (s.rtd ?? 0) * 6;
    }
    case "RB": {
      if ((s.ra ?? 0) < 20) return 0;
      const ypc = s.ypc ?? (s.ry ?? 0) / Math.max(1, s.ra ?? 1);
      return (s.ry ?? 0) / g * 1.0 + (s.rtd ?? 0) * 10 + ypc * 12 + (s.rcy ?? 0) / g * 0.8 + (s.rec ?? 0) * 1.5;
    }
    case "WR":
    case "TE": {
      if ((s.rec ?? 0) < 5) return 0;
      const ypr = s.ypr ?? (s.rcy ?? 0) / Math.max(1, s.rec ?? 1);
      return (s.rcy ?? 0) / g * 1.2 + (s.rec ?? 0) / g * 6 + (s.rctd ?? 0) * 10 + ypr * (group === "TE" ? 2.5 : 2);
    }
    case "EDGE":
    case "DL":
      return (s.sk ?? 0) * 22 + (s.tfl ?? 0) * 10 + (s.hur ?? 0) * 6 + (s.tk ?? 0) / g * 3 + (s.pd ?? 0) * 3 + (s.fr ?? 0) * 5;
    case "LB":
      return (s.tk ?? 0) / g * 7 + (s.tfl ?? 0) * 8 + (s.sk ?? 0) * 12 + (s.pd ?? 0) * 5 + (s.int ?? 0) * 12 + (s.hur ?? 0) * 3;
    case "CB":
    case "S":
      return (s.int ?? 0) * 25 + (s.pd ?? 0) * 10 + (s.tk ?? 0) / g * 4 + (s.tfl ?? 0) * 5 + (s.dtd ?? 0) * 15;
    case "OL":
      return 0;
    case "ST":
      if ((s.fga ?? 0) >= 6) return (s.fgm ?? 0) * 5 + (s.fgp ?? 0) * 0.6 + (s.fglg ?? 0) * 0.5;
      if ((s.pno ?? 0) >= 10) return (s.ypp ?? 0) * 2 + (s.pin20 ?? 0) * 2;
      return 0;
  }
  return 0;
}

function pct(sorted, v) {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sorted.length) * 100);
}

/**
 * Build the radar for one season's players.json. `nextDraft` is season + 1.
 * Returns the same fields the site uses for scoring and forecasting (no prose fields).
 */
export function buildRadar(players, nextDraft, opts = {}) {
  const W = { prod: 0.55, pedigree: 0.22, usage: 0.13, size: 0.10, ...(opts.weights ?? {}) };
  const tables = new Map();
  const raw = new Map();
  for (const p of players) {
    const group = GROUP[p.p ?? ""] ?? null;
    if (!group || !p.c) continue;
    const v = production(p, group);
    raw.set(p.id, v);
    if (v > 0) {
      const key = `${p.c}:${group}`;
      (tables.get(key) ?? tables.set(key, []).get(key)).push(v);
    }
  }
  for (const arr of tables.values()) arr.sort((a, b) => a - b);

  const out = [];
  for (const p of players) {
    const group = GROUP[p.p ?? ""] ?? null;
    if (!group || !p.c || !p.p) continue;
    if (group === "ST") continue;
    const level = LEVEL[p.c] ?? 0.5;
    const v = raw.get(p.id) ?? 0;
    const prodPct = v > 0 ? pct(tables.get(`${p.c}:${group}`) ?? [], v) : 0;

    const stars = p.r?.st ?? null;
    const pedigree = stars === 5 ? 100 : stars === 4 ? 72 : stars === 3 ? 38 : stars === 2 ? 15 : 0;
    const usageShare = p.u?.o ?? 0;
    const usage = Math.min(100, Math.round(usageShare * (group === "QB" ? 150 : 300)));

    const norm = SIZE[group];
    const size = norm && (p.h || p.w) ? (norm.h ? (p.h ?? 0) >= norm.h : true) && (norm.w ? (p.w ?? 0) >= norm.w : true) : null;

    const y = p.y ?? null;
    const draftClass = y === 4 ? nextDraft : y === 3 ? nextDraft : y === 2 ? nextDraft + 1 : nextDraft + 2;

    const prodWeight = group === "OL" ? 0 : W.prod;
    const base = prodWeight * prodPct + W.pedigree * pedigree + W.usage * usage + W.size * (size ? 100 : size === null ? 40 : 0);
    const olBonus = group === "OL" ? (y && y >= 3 ? 25 : 10) + (size ? 20 : 0) : 0;
    const score = Math.round(Math.min(100, (base + olBonus) * level));

    let tier = null;
    const upper = y === 3 || y === 4;
    if (upper && score >= 62) tier = "Eligible";
    else if (upper && score >= 45) tier = "Sleeper";
    else if (!upper && (score >= 55 || (pedigree >= 72 && usage >= 20))) tier = "Future";
    else if (pedigree >= 72 || (upper && score >= 36) || (!upper && score >= 45)) tier = "Watch";
    if (!tier) continue;

    out.push({
      id: p.id, name: p.n, team: p.t, classification: p.c, conference: p.cf, pos: p.p, group, classYear: y, draftClass,
      height: p.h, weight: p.w, score, production: prodPct, pedigree, usage, size, tier, stars, recruitRank: p.r?.rk ?? null,
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out;
}

/* ========================================================= forecast */

export const DRAFT_GROUP_OF = {
  Quarterback: "QB", "Running Back": "RB", "Wide Receiver": "WR", "Tight End": "TE",
  "Offensive Tackle": "OL", "Offensive Guard": "OL", Center: "OL",
  "Defensive Edge": "EDGE", "Defensive End": "EDGE", "Defensive Tackle": "DL", Linebacker: "LB",
  Cornerback: "CB", Safety: "S", "Place Kicker": "ST", Punter: "ST", "Long Snapper": "ST",
};

export function demandByGroup(picks) {
  const years = new Set(picks.map((p) => p.year));
  const n = Math.max(1, years.size);
  const totals = new Map();
  for (const p of picks) {
    const g = DRAFT_GROUP_OF[p.pos] ?? null;
    if (!g || g === "ST") continue;
    const e = totals.get(g) ?? totals.set(g, { all: 0, r1: 0, top100: 0 }).get(g);
    e.all++;
    if (p.round === 1) e.r1++;
    if (p.overall <= 100) e.top100++;
  }
  const allPicks = [...totals.values()].reduce((s, e) => s + e.all, 0);
  const allR1 = [...totals.values()].reduce((s, e) => s + e.r1, 0);
  return [...totals].map(([group, e]) => ({
    group,
    perDraft: e.all / n,
    r1: e.r1 / n,
    top100: e.top100 / n,
    premium: allPicks && allR1 ? (e.r1 / allR1) / (e.all / allPicks) : 1,
  })).sort((a, b) => b.perDraft - a.perDraft);
}

const BAND_RANK = { "Round 1 range": 0, "Day 2 range": 1, "Day 3 range": 2, "Priority free agent": 3 };

/** Forecast board for `nextDraft` from a radar list and the demand drafts. No declarations. */
export function forecastBoard(radar, nextDraft, demandPicks) {
  const demand = demandByGroup(demandPicks);
  const dmap = new Map(demand.map((d) => [d.group, d]));
  const pool = radar.filter(
    (p) => p.draftClass === nextDraft && (p.classification === "fbs" || p.classification === "fcs") && (p.tier === "Eligible" || p.tier === "Sleeper"),
  );
  const adjusted = pool.map((p) => {
    const d = dmap.get(p.group);
    const demandBump = d ? Math.max(-8, Math.min(8, (d.premium - 1) * 12)) : 0;
    const pedigreeBump = p.stars === 5 && p.usage >= 25 ? 12 : p.stars === 5 ? 6 : (p.recruitRank ?? 9999) <= 50 && p.usage >= 25 ? 6 : 0;
    return { p, adj: p.score + demandBump + pedigreeBump };
  });
  const entries = [];
  for (const [group, d] of dmap) {
    const list = adjusted.filter((x) => x.p.group === group).sort((a, b) => b.adj - a.adj);
    const r1 = Math.round(d.r1);
    const day2 = Math.round(d.top100);
    const all = Math.round(d.perDraft);
    list.forEach((x, i) => {
      entries.push({
        player: x.p,
        overall: 0,
        posRank: i + 1,
        band: i < r1 ? "Round 1 range" : i < day2 ? "Day 2 range" : i < all ? "Day 3 range" : "Priority free agent",
        adjusted: Math.round(x.adj),
      });
    });
  }
  const board = entries.sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band] || b.adjusted - a.adjusted);
  board.forEach((e, i) => {
    e.overall = i + 1;
    e.estPick = Math.min(257, e.overall);
  });
  return { draftYear: nextDraft, board, demand, poolSize: pool.length };
}

/* ======================================================= tendencies */

const DEFS = [
  { key: "passRate", off: "high", def: "high" },
  { key: "sr", off: "high", def: "low" },
  { key: "ex", off: "high", def: "low" },
  { key: "ppa", off: "high", def: "low" },
  { key: "rushSr", off: "high", def: "low" },
  { key: "passSr", off: "high", def: "low" },
  { key: "passEx", off: "high", def: "low" },
  { key: "ly", off: "high", def: "low" },
  { key: "stuff", off: "low", def: "high" },
  { key: "havoc", off: "low", def: "high" },
  { key: "havocF7", off: "low", def: "high" },
  { key: "pdSr", off: "high", def: "low" },
  { key: "ppo", off: "high", def: "low" },
];

function rankIn(sorted, v, wantHigh) {
  const n = sorted.length;
  let below = 0;
  while (below < n && sorted[below] < v) below++;
  const rank = wantHigh ? n - below : below + 1;
  const p = Math.round(((wantHigh ? below : n - below - 1) / Math.max(1, n - 1)) * 100);
  return { rank: Math.max(1, Math.min(n, rank)), of: n, pct: Math.max(0, Math.min(100, p)) };
}

const AXES = [
  { key: "rushSr", axis: "rush" },
  { key: "passEx", axis: "pass" },
  { key: "ly", axis: "line" },
  { key: "pdSr", axis: "pd" },
];

/** Build a tendencies context for one season's teams.json. */
export function buildTendencies(teams) {
  const byCls = new Map();
  for (const t of teams) {
    const c = t.c ?? "fbs";
    const tb = byCls.get(c) ?? byCls.set(c, { off: new Map(), def: new Map() }).get(c);
    for (const d of DEFS) {
      const o = t.off[d.key];
      const de = t.def[d.key];
      if (typeof o === "number") (tb.off.get(d.key) ?? tb.off.set(d.key, []).get(d.key)).push(o);
      if (typeof de === "number") (tb.def.get(d.key) ?? tb.def.set(d.key, []).get(d.key)).push(de);
    }
  }
  for (const tb of byCls.values()) {
    for (const arr of tb.off.values()) arr.sort((a, b) => a - b);
    for (const arr of tb.def.values()) arr.sort((a, b) => a - b);
  }
  const byTeam = new Map(teams.map((t) => [t.team, t]));

  const metricPct = (t, side, key) => {
    const v = t[side][key];
    if (typeof v !== "number") return undefined;
    const d = DEFS.find((x) => x.key === key);
    const wantHigh = (side === "off" ? d.off : d.def) === "high";
    const sorted = byCls.get(t.c ?? "fbs")?.[side].get(key);
    if (!sorted || key === "passRate") return undefined;
    return rankIn(sorted, v, wantHigh).pct;
  };

  /** Same output as tendencies.ts unitEdges, minus the prose: [{key, gap, edge}] sorted by |gap| desc. */
  const unitEdges = (offTeam, defTeam) => {
    const o = byTeam.get(offTeam);
    const d = byTeam.get(defTeam);
    if (!o || !d) return [];
    const out = [];
    for (const a of AXES) {
      const x = metricPct(o, "off", a.key);
      const y = metricPct(d, "def", a.key);
      if (x === undefined || y === undefined) continue;
      const gap = x - y;
      const edge = gap >= 20 ? "offense" : gap <= -20 ? "defense" : "even";
      out.push({ key: a.key, axis: a.axis, gap, edge, offTeam, defTeam });
    }
    return out.sort((p, q) => Math.abs(q.gap) - Math.abs(p.gap));
  };

  const styleContrast = (a, b) => {
    const x = byTeam.get(a);
    const y = byTeam.get(b);
    if (!x || !y) return null;
    const pr = Math.abs((x.off.passRate ?? 0.5) - (y.off.passRate ?? 0.5)) * 100;
    const paceX = x.off.drives ? x.off.plays / x.off.drives : 0;
    const paceY = y.off.drives ? y.off.plays / y.off.drives : 0;
    const pace = Math.abs(paceX - paceY) * 10;
    const havoc = Math.abs((x.def.havoc ?? 0.15) - (y.def.havoc ?? 0.15)) * 200;
    return Math.round(Math.min(100, pr * 1.8 + pace + havoc));
  };

  const means = new Map();
  const leagueMeans = (cls) => {
    if (means.has(cls)) return means.get(cls);
    const t = teams.filter((x) => (x.c ?? "fbs") === cls);
    let m;
    if (!t.length) m = { offPpa: 0.16, defPpa: 0.06, plays: 67, teams: 0 };
    else {
      const avg = (f) => t.reduce((s, x) => s + f(x), 0) / t.length;
      m = { offPpa: avg((x) => x.off.ppa), defPpa: avg((x) => x.def.ppa), plays: avg((x) => x.off.plays / Math.max(1, x.games ?? 1)), teams: t.length };
    }
    means.set(cls, m);
    return m;
  };

  return { byTeam, unitEdges, styleContrast, leagueMeans, metricPct };
}

/* ======================================================= projection */

export const HOME_ELO = 65;
export const ELO_PER_POINT = 28;
export const SIGMA = 16;
/** League-average points per team per game. The live site used 28.5 until October 2026 and now uses 25.6; both are graded. */
export const AVG_PPG_OLD = 28.5;
export const AVG_PPG = 25.6;

function erf(x) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const probFromMargin = (m) => 0.5 * (1 + erf(m / (SIGMA * Math.SQRT2)));

export function eloMargin(homeElo, awayElo, neutral, homeEdge = HOME_ELO) {
  if (homeElo == null || awayElo == null) return undefined;
  return (homeElo + (neutral ? 0 : homeEdge) - awayElo) / ELO_PER_POINT;
}

/**
 * Net unit-edge percentile points toward the home team, two ways:
 *   live: the four largest of the eight edges, gaps under 20 count as zero (what projection.ts does today)
 *   raw:  all eight signed gaps, no threshold
 * Returns undefined when the teams are not charted.
 */
export function edgeNet(tend, homeSchool, awaySchool) {
  const rows = [...tend.unitEdges(awaySchool, homeSchool), ...tend.unitEdges(homeSchool, awaySchool)];
  if (!rows.length) return undefined;
  const top4 = [...rows].sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap)).slice(0, 4);
  let live = 0;
  for (const m of top4) {
    const mag = Math.abs(m.gap);
    const g = m.edge === "offense" ? mag : m.edge === "defense" ? -mag : 0;
    live += m.offTeam === homeSchool ? g : -g;
  }
  let raw = 0;
  for (const m of rows) raw += m.offTeam === homeSchool ? m.gap : -m.gap;
  return { live, raw, matchups: top4.length, edges: rows.length };
}

function expectedPoints(off, def, means, plays, avgPpg) {
  const dev = (off.off.ppa - means.offPpa + (def.def.ppa - means.defPpa)) / 2;
  return Math.max(3, avgPpg + plays * dev);
}

/** Model total from efficiency and pace, rounded to a half point. No weather. */
export function modelTotal(tend, homeSchool, awaySchool, cls = "fbs", avgPpg = AVG_PPG) {
  const h = tend.byTeam.get(homeSchool);
  const a = tend.byTeam.get(awaySchool);
  if (!h || !a) return undefined;
  const means = tend.leagueMeans(cls);
  const pace = ((h.off.plays / Math.max(1, h.games ?? 1)) + (a.off.plays / Math.max(1, a.games ?? 1))) / 2;
  const hp = expectedPoints(h, a, means, pace, avgPpg);
  const ap = expectedPoints(a, h, means, pace, avgPpg);
  return { total: Math.round((hp + ap) * 2) / 2, home: hp, away: ap, pace };
}

/**
 * Two blend forms.
 *   weighted (live until October 2026): margin = w * elo + (1 - w) * net / divisor
 *   additive (live now):                margin = elo + (1 - w) * net / divisor
 * The additive form keeps the full Elo margin and adds a scaled edge term; w only sets how much edge is added.
 */
export const LIVE = { form: "additive", eloWeight: 0.6, edgeDivisor: 40 };
export const weightedMargin = (elo, net, w = 0.6, divisor = 40) => w * elo + (1 - w) * (net / divisor);
export const additiveMargin = (elo, net, w = LIVE.eloWeight, divisor = LIVE.edgeDivisor) => elo + (1 - w) * (net / divisor);
export const blendMargin = (elo, net, w = LIVE.eloWeight, divisor = LIVE.edgeDivisor, form = LIVE.form) =>
  form === "additive" ? additiveMargin(elo, net, w, divisor) : weightedMargin(elo, net, w, divisor);

/* ============================================================ stats */

export function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }

function rankArray(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function spearman(x, y) {
  if (x.length < 3) return null;
  return pearson(rankArray(x), rankArray(y));
}
