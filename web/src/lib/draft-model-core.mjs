/**
 * Draft model core, shared by scripts/draft-fit.mjs (fitting and backtest) and src/lib/forecast.ts (live).
 *
 * Predicts where a draft-eligible player goes IF he declares, as a draft value
 *   v = ln(262 / overall pick)        (pick 1 = 5.57, pick 32 = 2.10, pick 100 = 0.96, undrafted = 0)
 * from inputs a scout would weigh, each with its own weight per position group:
 *   prod   production percentile inside his division and position, this season blended with last
 *          season by games played (this season counts more as it fills in)
 *   rk     national recruiting rank, log scale (No. 1 = 1, No. 3000 = 0)
 *   rt     recruiting rating (0.80 to 1.00 mapped to 0 to 1)
 *   hz, wz height and weight against the position's draft-pool average, in standard deviations
 * plus shared terms for usage share, senior year, power-conference school, FCS, and team strength (Elo).
 *
 * Fitted with ridge regression on 2022 to 2025 seasons against the 2023 to 2026 drafts; see
 * data/draft-model.json for the weights and the leave-one-season-out results.
 */

export const GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", C: "OL", G: "OL", T: "OL",
  DL: "DL", DT: "DL", NT: "DL", DE: "EDGE", EDGE: "EDGE", OLB: "EDGE",
  LB: "LB", ILB: "LB", MLB: "LB",
  DB: "CB", CB: "CB", S: "S", FS: "S", SS: "S",
};
export const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "CB", "S"];
export const POWER = new Set(["SEC", "Big Ten", "Big 12", "ACC", "Pac-12", "FBS Independents"]);
/** Prior season counts as this many games of evidence when blended with the current season. */
export const PRIOR_GAMES = 4;

export const groupOf = (pos) => GROUP[pos ?? ""] ?? null;
export const valueOfPick = (overall) => (overall ? Math.log(262 / overall) : 0);
export const pickOfValue = (v) => Math.max(1, Math.round(262 / Math.exp(Math.max(0, v))));

/** Raw production for one season line (same formula as the radar). Linemen have none. */
export function production(p, group) {
  const s = p.s ?? {};
  const g = Math.max(1, p.g ?? 1);
  switch (group) {
    case "QB": {
      if ((s.pa ?? 0) < 40) return 0;
      const ypa = s.ypa ?? (s.py ?? 0) / Math.max(1, s.pa ?? 1);
      const pct = (s.pc ?? 0) / Math.max(1, s.pa ?? 1);
      return ((s.py ?? 0) / g) * 0.5 + (s.ptd ?? 0) * 12 - (s.pint ?? 0) * 14 + ypa * 18 + pct * 120 + ((s.ry ?? 0) / g) * 0.6 + (s.rtd ?? 0) * 6;
    }
    case "RB": {
      if ((s.ra ?? 0) < 20) return 0;
      const ypc = s.ypc ?? (s.ry ?? 0) / Math.max(1, s.ra ?? 1);
      return ((s.ry ?? 0) / g) * 1.0 + (s.rtd ?? 0) * 10 + ypc * 12 + ((s.rcy ?? 0) / g) * 0.8 + (s.rec ?? 0) * 1.5;
    }
    case "WR":
    case "TE": {
      if ((s.rec ?? 0) < 5) return 0;
      const ypr = s.ypr ?? (s.rcy ?? 0) / Math.max(1, s.rec ?? 1);
      return ((s.rcy ?? 0) / g) * 1.2 + ((s.rec ?? 0) / g) * 6 + (s.rctd ?? 0) * 10 + ypr * (group === "TE" ? 2.5 : 2);
    }
    case "EDGE":
    case "DL":
      return (s.sk ?? 0) * 22 + (s.tfl ?? 0) * 10 + (s.hur ?? 0) * 6 + ((s.tk ?? 0) / g) * 3 + (s.pd ?? 0) * 3 + (s.fr ?? 0) * 5;
    case "LB":
      return ((s.tk ?? 0) / g) * 7 + (s.tfl ?? 0) * 8 + (s.sk ?? 0) * 12 + (s.pd ?? 0) * 5 + (s.int ?? 0) * 12 + (s.hur ?? 0) * 3;
    case "CB":
    case "S":
      return (s.int ?? 0) * 25 + (s.pd ?? 0) * 10 + ((s.tk ?? 0) / g) * 4 + (s.tfl ?? 0) * 5 + (s.dtd ?? 0) * 15;
    default:
      return 0;
  }
}

/** id -> production percentile (0..100) inside classification and position group, for one season's players. */
export function productionPercentiles(players) {
  const raw = new Map();
  const tables = new Map();
  for (const p of players) {
    const g = groupOf(p.p);
    if (!g || !p.c) continue;
    const v = production(p, g);
    if (v <= 0) continue;
    raw.set(p.id, { v, key: `${p.c}:${g}` });
    (tables.get(`${p.c}:${g}`) ?? tables.set(`${p.c}:${g}`, []).get(`${p.c}:${g}`)).push(v);
  }
  for (const a of tables.values()) a.sort((x, y) => x - y);
  const out = new Map();
  for (const [id, { v, key }] of raw) {
    const a = tables.get(key);
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; }
    out.set(id, Math.round((lo / a.length) * 100));
  }
  return out;
}

/** Blend this season's production percentile with last season's by games played. */
export function blendProduction(cur, prior, games) {
  if (prior == null) return cur ?? 0;
  const g = Math.max(0, games ?? 0);
  return ((cur ?? 0) * g + prior * PRIOR_GAMES) / (g + PRIOR_GAMES);
}

/**
 * Named features for one player. `prod` is the blended production percentile (0..100).
 * `size` holds per-group height and weight mean and sd from the training pool.
 */
export function features(p, group, prod, size, teamElo = null) {
  const r = p.r ?? {};
  const rk = r.rk ? Math.max(0, Math.min(1, 1 - Math.log10(r.rk) / Math.log10(3000))) : 0;
  const rt = r.rt ? Math.max(0, Math.min(1, (r.rt - 0.8) / 0.2)) : 0;
  const sz = size?.[group];
  const hz = sz && p.h ? Math.max(-3, Math.min(3, (p.h - sz.hMean) / (sz.hSd || 1))) : 0;
  const wz = sz && p.w ? Math.max(-3, Math.min(3, (p.w - sz.wMean) / (sz.wSd || 1))) : 0;
  const f = {
    [`b:${group}`]: 1,
    [`prod:${group}`]: (prod ?? 0) / 100,
    [`rk:${group}`]: rk,
    [`rt:${group}`]: rt,
    [`hz:${group}`]: hz,
    [`wz:${group}`]: wz,
    usage: Math.min(1, (p.u?.o ?? 0) * 3),
    senior: p.y === 4 ? 1 : 0,
    power: POWER.has(p.cf) ? 1 : 0,
    fcs: p.c === "fcs" ? 1 : 0,
    noRec: r.rk || r.rt ? 0 : 1,
    // Team strength: end-of-season (or current) Elo of his school, 1500 = average FBS team.
    team: teamElo == null ? 0 : Math.max(-2, Math.min(2, (teamElo - 1500) / 300)),
  };
  return f;
}

export function predict(weights, f) {
  let v = 0;
  for (const [k, x] of Object.entries(f)) v += (weights[k] ?? 0) * x;
  return v;
}
