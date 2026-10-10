/**
 * The matchup board: the same five position matchups for every game, for both offenses.
 *
 *   O-line vs D-line          line yards, stuffed runs, front-seven havoc (who wins first contact)
 *   Running back vs front 7   second-level yards, open-field yards, explosive runs (what happens after)
 *   Receivers vs secondary    pass success and explosiveness, against DB havoc
 *   QB vs the defense         passing-downs success and havoc (sacks, turnovers) on the money downs
 *   Red zone                  points per trip inside the 40
 *
 * Each unit gets the mean of its metric percentiles inside the division (100 = best for that side),
 * and a rank among the division's units on that composite. The gap uses the same thresholds as the
 * unit edges (data/weights.json edgeThreshold; 40 clear, 55 mismatch).
 *
 * Display only. The projection still reads the four largest unit edges from tendencies.ts, the inputs
 * the backtest graded, so this board changes nothing in the model.
 */
import { genGamelogs, gamelogsStamp, genMeta, genPlayers, genTeams, type GenPlayer, type GenTeam, type GenUnit } from "./generated";
import { eloAsOf, ourPregameElo } from "./elo";
import { memoSync } from "./memo";
import { radarForTeam, radarPlayer, type RadarPlayer } from "./radar";
import { appliedWeights } from "./weights";
import { adjustedProduction } from "./adjusted";

export type RowKey = "trenches" | "run" | "pass" | "qb" | "redzone";
type Dir = "high" | "low";
/** `label` is the short evidence name; `offName` / `defName` read from each side's point of view on the board. */
interface MetricDef { key: keyof GenUnit; label: string; offName: string; defName: string; off: Dir; fmt: (n: number) => string }

const pct = (n: number) => `${Math.round(n * 100)}%`;
const f2 = (n: number) => n.toFixed(2);

/** Offense direction given; the defense wants the opposite on every metric here. */
const ROWS: { key: RowKey; title: string; offUnit: string; defUnit: string; offLabel: string; defLabel: string; metrics: MetricDef[] }[] = [
  {
    key: "trenches", title: "O-line vs D-line", offUnit: "O-line", defUnit: "D-line", offLabel: "O-line", defLabel: "D-line",
    metrics: [
      { key: "ly", label: "line yards per carry", offName: "Line yards per carry", defName: "Line yards allowed per carry", off: "high", fmt: f2 },
      { key: "stuff", label: "runs stuffed", offName: "Runs stuffed", defName: "Runs stuffed", off: "low", fmt: pct },
      { key: "havocF7", label: "front-seven havoc", offName: "Backfield penetration allowed", defName: "Backfield penetration", off: "low", fmt: pct },
    ],
  },
  {
    key: "run", title: "Running back vs front seven", offUnit: "run game", defUnit: "front seven", offLabel: "Run game", defLabel: "Front 7",
    metrics: [
      { key: "sly", label: "second-level yards", offName: "Second-level yards per carry", defName: "Second-level yards allowed", off: "high", fmt: f2 },
      { key: "ofy", label: "open-field yards", offName: "Open-field yards per carry", defName: "Open-field yards allowed", off: "high", fmt: f2 },
      { key: "rushEx", label: "explosive runs", offName: "Explosive runs", defName: "Explosive runs allowed", off: "high", fmt: f2 },
    ],
  },
  {
    key: "pass", title: "Receivers vs secondary", offUnit: "receivers", defUnit: "secondary", offLabel: "Receivers", defLabel: "Secondary",
    metrics: [
      { key: "passSr", label: "pass success", offName: "Pass success rate", defName: "Pass success allowed", off: "high", fmt: pct },
      { key: "passEx", label: "pass explosiveness", offName: "Explosive passes", defName: "Explosive passes allowed", off: "high", fmt: f2 },
      { key: "havocDB", label: "DB havoc", offName: "Picks and breakups allowed", defName: "Picks and breakups (DBs)", off: "low", fmt: pct },
    ],
  },
  {
    key: "qb", title: "Quarterback vs pass defense", offUnit: "quarterback", defUnit: "pass defense", offLabel: "QB", defLabel: "Pass D",
    // The offense side of this row is replaced by the quarterback himself (qbProfile); these metrics rank the pass defense.
    metrics: [
      { key: "passSr", label: "pass success", offName: "Pass success rate", defName: "Pass success allowed", off: "high", fmt: pct },
      { key: "passEx", label: "pass explosiveness", offName: "Explosive passes", defName: "Explosive passes allowed", off: "high", fmt: f2 },
      { key: "pdSr", label: "passing-downs success", offName: "Passing-downs success", defName: "Third-and-long success allowed", off: "high", fmt: pct },
      { key: "havoc", label: "havoc (sacks, turnovers, TFL)", offName: "Havoc allowed (sacks, TOs, TFL)", defName: "Havoc created (sacks, TOs, TFL)", off: "low", fmt: pct },
    ],
  },
  {
    key: "redzone", title: "Red zone", offUnit: "red zone offense", defUnit: "red zone defense", offLabel: "Red zone O", defLabel: "Red zone D",
    metrics: [{ key: "ppo", label: "points per trip inside the 40", offName: "Points per trip inside the 40", defName: "Points allowed per trip inside the 40", off: "high", fmt: f2 }],
  },
];

export interface Name { id: string; name: string; pos: string }

export interface SideRow {
  offense: string; // school
  defense: string;
  offPct: number; // 0..100 composite, 100 best
  defPct: number;
  offRank: number;
  defRank: number;
  of: number;
  gap: number; // offPct - defPct
  edge: "offense" | "defense" | "even";
  strength: "mismatch" | "clear" | "edge" | "even";
  offName?: Name;
  defName?: Name;
  watch: string;
  evidence: string;
  /** Every stat behind the row with its own rank, from each side's point of view (rank 1 = best for that side). */
  stats: { offName: string; defName: string; off: string; offRank: number; def: string; defRank: number }[];
  /** Plain-English read of each unit: tier plus where the strength or the problem is. */
  offRead: string;
  defRead: string;
  /** Quarterback row only: the starter himself, ranked among FBS starters. */
  qb?: QbProfile;
  /** Size of the pool the offense rank is out of when it differs from the defense (QBs vs teams). */
  offOf?: number;
}

/** The starting quarterback, ranked among FBS starters on his own numbers. */
export interface QbProfile {
  id: string;
  name: string;
  type: string; // "Dual-threat", "Efficient pocket passer", ...
  why: string; // the numbers behind the type
  rank: number; // opponent-adjusted production rank among qualifying FBS QBs
  rawRank: number; // same, on raw season production
  of: number;
  pct: number; // 0..100, 100 = best, for the matchup gap
  line: { label: string; value: string; rank: number }[];
  /** Game by game: each opponent's coverage and pass-rush rank, the multiplier, his line, and his game score before and after. */
  games: { week: number; opponent: string; homeAway: "home" | "away"; coverRank: number | null; rushRank: number | null; note: string; weight: number; line: string; raw: number; adjusted: number }[];
  rawAvg: number | null;
  adjAvg: number | null;
  /** Season rates before this game, for the postgame recap's "above or below his average". */
  season: { ypa: number; comp: number; tdr: number; intr: number; attempts: number };
}

export interface TeamContext {
  school: string;
  games: number | null; // games in the team stats
  sosRank: number | null; // 1 = toughest schedule so far among FBS teams
  of: number;
  toughest: string[]; // best opponents faced (rated 1750+)
}

export interface BoardRow {
  key: RowKey;
  title: string;
  offLabel: string; // "O-line"
  defLabel: string; // "D-line"
  away: SideRow; // away offense vs home defense
  home: SideRow; // home offense vs away defense
}

export interface MatchBoard {
  rows: BoardRow[];
  context: { away: TeamContext; home: TeamContext };
  /** When the team stats were pulled, and how many games the home and away teams had played. */
  statsAsOf?: string;
  games: { away: number | null; home: number | null };
  /** The single biggest gap on the board, in one sentence. */
  pressurePoint: string;
}

/* --------------------------------------------------------- percentiles */

interface Tables { off: Map<string, number[]>; def: Map<string, number[]>; comp: Map<string, { off: number[]; def: number[] }> }

function rankPct(sorted: number[], v: number, wantHigh: boolean): number {
  const n = sorted.length;
  if (n < 2) return 50;
  let below = 0;
  while (below < n && sorted[below] < v) below++;
  const p = (wantHigh ? below : n - below - 1) / (n - 1);
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

function unitPct(t: GenTeam, side: "off" | "def", row: (typeof ROWS)[number], tb: Tables): number | undefined {
  const ps: number[] = [];
  for (const m of row.metrics) {
    const v = t[side][m.key];
    const sorted = tb[side].get(String(m.key));
    if (typeof v !== "number" || !sorted) continue;
    const wantHigh = side === "off" ? m.off === "high" : m.off !== "high";
    ps.push(rankPct(sorted, v, wantHigh));
  }
  return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : undefined;
}

function tables(cls: string): Tables {
  return memoSync(`board:tables:${cls}:${genTeams().length}`, 3600, () => {
    const teams = genTeams().filter((t) => (t.c ?? "fbs") === cls);
    const tb: Tables = { off: new Map(), def: new Map(), comp: new Map() };
    for (const row of ROWS) for (const m of row.metrics) {
      for (const side of ["off", "def"] as const) {
        const arr = teams.map((t) => t[side][m.key]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
        tb[side].set(String(m.key), arr);
      }
    }
    for (const row of ROWS) {
      const off = teams.map((t) => unitPct(t, "off", row, tb)).filter((v): v is number => v != null).sort((a, b) => b - a);
      const def = teams.map((t) => unitPct(t, "def", row, tb)).filter((v): v is number => v != null).sort((a, b) => b - a);
      tb.comp.set(row.key, { off, def });
    }
    return tb;
  });
}

const rankOf = (desc: number[], v: number) => Math.max(1, desc.findIndex((x) => x <= v) + 1 || desc.length);

/** Rank of one value among the division, 1 = best for the side that wants `wantHigh`. */
function metricRank(sortedAsc: number[], v: number, wantHigh: boolean): number {
  return 1 + sortedAsc.filter((x) => (wantHigh ? x > v : x < v)).length;
}

export function tierOf(rank: number, of: number): string {
  const p = rank / Math.max(1, of);
  return p <= 0.1 ? "Elite" : p <= 0.3 ? "Good" : p <= 0.7 ? "Average" : p <= 0.9 ? "Below average" : "Bad";
}

/** "Below average. Weakest spot: backfield penetration allowed (No. 130)." or a mixed read when the stats disagree. */
function unitRead(rank: number, of: number, stats: { name: string; rank: number }[]): string {
  const tier = tierOf(rank, of);
  if (stats.length < 2) return `${tier}.`;
  const sorted = [...stats].sort((a, b) => a.rank - b.rank);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const lc = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  if (worst.rank - best.rank >= 50) return `${tier}, but mixed: ${lc(best.name)} is No. ${best.rank}, ${lc(worst.name)} is No. ${worst.rank}.`;
  if (tier === "Bad" || tier === "Below average") return `${tier}. Worst number: ${lc(worst.name)} (No. ${worst.rank}).`;
  if (tier === "Elite" || tier === "Good") return `${tier}. Best number: ${lc(best.name)} (No. ${best.rank}).`;
  return `${tier}. No stat stands out either way.`;
}

/* --------------------------------------------------------- quarterbacks */

interface QbRow { p: GenPlayer; ypa: number; comp: number; tdr: number; intr: number; rypg: number; adj: number; raw: number }

/** Qualifying FBS quarterbacks: at least 8 attempts per team game. Ranked on the radar's production (opponent-adjusted). */
function qbTable(): QbRow[] {
  return memoSync(`board:qbs:${genMeta()?.ingestedAt ?? ""}`, 3600, () => {
    const rows: QbRow[] = [];
    for (const p of genPlayers()) {
      const s = p.s;
      if (p.c !== "fbs" || p.p !== "QB" || !s?.pa) continue;
      const g = Math.max(1, p.g ?? 1);
      if (s.pa < 8 * g) continue;
      const r = radarPlayer(p.id);
      rows.push({
        p,
        ypa: (s.py ?? 0) / s.pa,
        comp: (s.pc ?? 0) / s.pa,
        tdr: (s.ptd ?? 0) / s.pa,
        intr: (s.pint ?? 0) / s.pa,
        rypg: (s.ry ?? 0) / g,
        adj: r?.production ?? 0,
        raw: r?.rawProduction ?? 0,
      });
    }
    return rows;
  });
}

function qbType(q: QbRow): { type: string; why: string } {
  const s = q.p.s ?? {};
  const why = `${Math.round(q.comp * 100)}% completions, ${q.ypa.toFixed(1)} yards per attempt, ${s.ptd ?? 0} TD and ${s.pint ?? 0} INT, ${Math.round(q.rypg)} rushing yards a game`;
  const type =
    q.intr >= 0.03 && q.ypa < 7 ? "Struggling"
    : q.rypg >= 40 ? "Dual-threat"
    : q.ypa >= 9 && q.intr >= 0.02 ? "Gunslinger"
    : q.ypa >= 8.5 ? "Big-play passer"
    : q.comp >= 0.67 && q.intr <= 0.015 ? "Efficient pocket passer"
    : q.ypa < 7 && q.intr <= 0.02 ? "Game manager"
    : "Balanced passer";
  return { type, why };
}

/** The team's starter (most attempts), ranked among qualifying FBS quarterbacks. */
function qbProfile(school: string): QbProfile | undefined {
  const all = qbTable();
  const starter = all.filter((q) => q.p.t === school).sort((a, b) => (b.p.s?.pa ?? 0) - (a.p.s?.pa ?? 0))[0];
  if (!starter) return undefined;
  const n = all.length;
  const rankBy = (val: (q: QbRow) => number, high = true) => {
    const v = val(starter);
    return 1 + all.filter((q) => (high ? val(q) > v : val(q) < v)).length;
  };
  const rank = 1 + all.filter((q) => q.adj > starter.adj || (q.adj === starter.adj && q.ypa > starter.ypa)).length;
  const rawRank = 1 + all.filter((q) => q.raw > starter.raw || (q.raw === starter.raw && q.ypa > starter.ypa)).length;
  const s = starter.p.s ?? {};
  const t = qbType(starter);
  const adj = adjustedProduction(starter.p.id, "QB");
  return {
    id: starter.p.id,
    name: starter.p.n,
    type: t.type,
    why: t.why,
    rank,
    rawRank,
    of: n,
    pct: Math.round(100 * (1 - (rank - 1) / Math.max(1, n - 1))),
    line: [
      { label: "Yards per attempt", value: starter.ypa.toFixed(1), rank: rankBy((q) => q.ypa) },
      { label: "Completion rate", value: `${Math.round(starter.comp * 100)}%`, rank: rankBy((q) => q.comp) },
      { label: "TD rate", value: `${s.ptd ?? 0} TD (${(starter.tdr * 100).toFixed(1)}%)`, rank: rankBy((q) => q.tdr) },
      { label: "INT rate (low is good)", value: `${s.pint ?? 0} INT (${(starter.intr * 100).toFixed(1)}%)`, rank: rankBy((q) => q.intr, false) },
      { label: "Rushing yards per game", value: String(Math.round(starter.rypg)), rank: rankBy((q) => q.rypg) },
    ],
    games: (adj?.rows ?? []).map((r) => ({
      week: r.week,
      opponent: r.opponent,
      homeAway: r.homeAway,
      coverRank: r.coverRank ?? null,
      rushRank: r.rushRank ?? null,
      note: r.oppNote,
      weight: r.weight,
      line: r.line,
      raw: Math.round(r.raw),
      adjusted: Math.round(r.adjusted),
    })),
    rawAvg: adj ? Math.round(adj.rawAvg) : null,
    adjAvg: adj ? Math.round(adj.adjAvg) : null,
    season: { ypa: +starter.ypa.toFixed(2), comp: +starter.comp.toFixed(3), tdr: +starter.tdr.toFixed(3), intr: +starter.intr.toFixed(3), attempts: s.pa ?? 0 },
  };
}

/* --------------------------------------------------------- schedule */

/**
 * Strength of schedule over the games the team stats cover: average pregame Elo of the opponents
 * in a team's first `games` games (FCS opponents count as 1200), ranked among FBS teams.
 */
function scheduleTable(): Map<string, TeamContext> {
  return memoSync(`board:sos:${gamelogsStamp()}:${eloAsOf() ?? ""}`, 3600, () => {
    const logs = genGamelogs();
    const teams = genTeams();
    const rows: { school: string; games: number | null; avg: number; toughest: string[] }[] = [];
    if (logs) {
      const list = Object.entries(logs.games).sort((a, b) => a[1].wk - b[1].wk);
      for (const t of teams) {
        const mine = list.filter(([, g]) => g.home === t.team || g.away === t.team).slice(0, t.games ?? 99);
        if (!mine.length) continue;
        const opps = mine.map(([id, g]) => {
          const home = g.home === t.team;
          const opp = home ? g.away : g.home;
          const pre = ourPregameElo(id, { school: g.home }, { school: g.away });
          return { opp, r: (home ? pre.away : pre.home) ?? 1200 };
        });
        rows.push({
          school: t.team,
          games: t.games,
          avg: opps.reduce((a, x) => a + x.r, 0) / opps.length,
          toughest: opps.filter((x) => x.r >= 1750).sort((a, b) => b.r - a.r).slice(0, 2).map((x) => x.opp),
        });
      }
    }
    rows.sort((a, b) => b.avg - a.avg);
    return new Map(rows.map((r, i) => [r.school, { school: r.school, games: r.games, sosRank: i + 1, of: rows.length, toughest: r.toughest }]));
  });
}

const contextFor = (school: string, games: number | null): TeamContext =>
  scheduleTable().get(school) ?? { school, games, sosRank: null, of: 0, toughest: [] };

/* --------------------------------------------------------- names */

/** Position groups to name per row, in order of preference. The QB row names the pass rush first. */
const GROUPS: Record<RowKey, { off: string[][]; def: string[][] }> = {
  trenches: { off: [["OL"]], def: [["DL", "EDGE"]] },
  run: { off: [["RB"]], def: [["LB"]] },
  pass: { off: [["WR", "TE"]], def: [["CB", "S"]] },
  qb: { off: [["QB"]], def: [["EDGE", "DL"], ["LB"], ["CB", "S"]] },
  redzone: { off: [], def: [] },
};

const toName = (r: RadarPlayer | undefined): Name | undefined => (r ? { id: r.id, name: r.name, pos: r.pos } : undefined);
/** Top radar player in the first preferred group that has one not already named for this team on the board. */
function top(school: string, prefs: string[][], used: Set<string>): Name | undefined {
  const list = radarForTeam(school);
  for (const groups of prefs) {
    const r = list.find((x) => groups.includes(x.group) && !used.has(x.id));
    if (r) {
      used.add(r.id);
      return toName(r);
    }
  }
  return undefined;
}

/** Red zone names come from the stat line: the offense's touchdown leader and the defense's leading tackler. */
function redZoneNames(offense: string, defense: string, usedDef: Set<string>): { off?: Name; def?: Name } {
  const players = genPlayers();
  let off: { id: string; n: string; p: string | null; td: number } | undefined;
  let def: { id: string; n: string; p: string | null; tk: number } | undefined;
  for (const p of players) {
    const s = p.s;
    if (!s) continue;
    if (p.t === offense) {
      const td = (s.rtd ?? 0) + (s.rctd ?? 0);
      if (td > 0 && (!off || td > off.td)) off = { id: p.id, n: p.n, p: p.p, td };
    }
    if (p.t === defense && !usedDef.has(p.id) && (s.tk ?? 0) > (def?.tk ?? 0)) def = { id: p.id, n: p.n, p: p.p, tk: s.tk ?? 0 };
  }
  return {
    off: off ? { id: off.id, name: off.n, pos: `${off.p ?? ""}, ${off.td} TD`.replace(/^, /, "") } : undefined,
    def: def ? { id: def.id, name: def.n, pos: `${def.p ?? ""}, ${def.tk} tkl`.replace(/^, /, "") } : undefined,
  };
}

/* --------------------------------------------------------- watch-for */

function watchFor(key: RowKey, edge: SideRow["edge"], o: string, d: string, offName?: Name): string {
  const who = offName?.name ?? o;
  const W: Record<RowKey, Record<SideRow["edge"], string>> = {
    trenches: {
      offense: `Watch yards before contact on ${o}'s first ten carries. ${o}'s line should move people.`,
      defense: `Watch tackles for loss. ${d} living in the backfield early is the tell.`,
      even: `Even up front. First contact on the first two drives tells you who blinks.`,
    },
    run: {
      offense: `${who} gets to the second level. Watch for runs of 15 yards or more.`,
      defense: `${d} tackles well in space. ${who} needs the line to win first, or it is a long day.`,
      even: `Watch who breaks the first 10-yard run. That back sets the tone.`,
    },
    pass: {
      offense: `Watch the first deep shot. If it lands, ${d} has to change coverage and the run opens up.`,
      defense: `Watch ${o}'s longest completion. Under 25 yards at the half means ${d} won this.`,
      even: `Strength on strength. The first explosive pass changes the other side's play calls.`,
    },
    qb: {
      offense: `${who} converts long downs. A third-and-8 is not a stop against this offense.`,
      defense: `Watch ${who} on third-and-7 or longer. Punts there mean ${d} is winning.`,
      even: `Third-and-long is a coin flip here. Early-down success decides who sees more of them.`,
    },
    redzone: {
      offense: `${o} turns trips inside the 40 into touchdowns. A field goal is a win for ${d}.`,
      defense: `${d} holds in the red zone. Count ${o}'s field goals.`,
      even: `Even inside the 40. Touchdowns versus field goals could swing the number.`,
    },
  };
  return W[key][edge];
}

/* --------------------------------------------------------- build */

function side(row: (typeof ROWS)[number], o: GenTeam, d: GenTeam, tb: Tables, used: Map<string, Set<string>>): SideRow | undefined {
  const qb = row.key === "qb" ? qbProfile(o.team) : undefined;
  const offPct = qb ? qb.pct : unitPct(o, "off", row, tb);
  const defPct = unitPct(d, "def", row, tb);
  if (offPct == null || defPct == null) return undefined;
  const comp = tb.comp.get(row.key)!;
  const gap = offPct - defPct;
  const threshold = appliedWeights().edgeThreshold;
  const edge: SideRow["edge"] = gap >= threshold ? "offense" : gap <= -threshold ? "defense" : "even";
  const mag = Math.abs(gap);
  const strength: SideRow["strength"] = edge === "even" ? "even" : mag >= 55 ? "mismatch" : mag >= 40 ? "clear" : "edge";
  // Each player is named once per team across the board, so the defense is not one linebacker five times.
  const usedFor = (school: string) => used.get(school) ?? used.set(school, new Set()).get(school)!;
  const names = row.key === "redzone" ? redZoneNames(o.team, d.team, usedFor(d.team)) : { off: top(o.team, GROUPS[row.key].off, usedFor(o.team)), def: top(d.team, GROUPS[row.key].def, usedFor(d.team)) };
  if (qb) names.off = { id: qb.id, name: qb.name, pos: "QB" };
  const evidence = row.metrics
    .map((m) => {
      const ov = o.off[m.key];
      const dv = d.def[m.key];
      return typeof ov === "number" && typeof dv === "number" ? `${m.label}: ${o.team} ${m.fmt(ov)}, ${d.team} allows ${m.fmt(dv)}` : undefined;
    })
    .filter(Boolean)
    .join(" · ");
  const stats = row.metrics
    .map((m) => {
      const ov = o.off[m.key];
      const dv = d.def[m.key];
      const so = tb.off.get(String(m.key));
      const sd = tb.def.get(String(m.key));
      if (typeof ov !== "number" || typeof dv !== "number" || !so || !sd) return undefined;
      return { offName: m.offName, defName: m.defName, off: m.fmt(ov), offRank: metricRank(so, ov, m.off === "high"), def: m.fmt(dv), defRank: metricRank(sd, dv, m.off !== "high") };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const offRank = qb ? qb.rank : rankOf(comp.off, offPct);
  const defRank = rankOf(comp.def, defPct);
  return {
    stats,
    qb,
    offOf: qb?.of,
    offRead: qb
      ? `${tierOf(qb.rank, qb.of)} among FBS QBs. ${qb.type}: ${qb.why}.`
      : unitRead(offRank, comp.off.length, stats.map((x) => ({ name: x.offName, rank: x.offRank }))),
    defRead: unitRead(defRank, comp.def.length, stats.map((x) => ({ name: x.defName, rank: x.defRank }))),
    offense: o.team,
    defense: d.team,
    offPct,
    defPct,
    offRank,
    defRank,
    of: comp.off.length,
    gap,
    edge,
    strength,
    offName: names.off,
    defName: names.def,
    watch: watchFor(row.key, edge, o.team, d.team, names.off),
    evidence,
  };
}

/** One line for the section header: how many of the ten unit matchups have an edge, and the biggest. */
export function boardSummary(b: MatchBoard): string {
  const sides = b.rows.flatMap((r) => [r.away, r.home]);
  const edges = sides.filter((x) => x.edge !== "even").length;
  const mismatches = sides.filter((x) => x.strength === "mismatch").length;
  return `${edges} of ${sides.length} unit matchups have an edge${mismatches ? `, ${mismatches} a mismatch` : ""}`;
}

export function matchBoard(awaySchool: string, homeSchool: string): MatchBoard | undefined {
  const teams = genTeams();
  const away = teams.find((t) => t.team === awaySchool);
  const home = teams.find((t) => t.team === homeSchool);
  if (!away || !home) return undefined;
  const tb = tables(away.c ?? "fbs");
  const rows: BoardRow[] = [];
  const used = new Map<string, Set<string>>();
  for (const row of ROWS) {
    const a = side(row, away, home, tb, used);
    const h = side(row, home, away, tb, used);
    if (a && h) rows.push({ key: row.key, title: row.title, offLabel: row.offLabel, defLabel: row.defLabel, away: a, home: h });
  }
  if (!rows.length) return undefined;
  const all = rows.flatMap((r) => [{ r, s: r.away }, { r, s: r.home }]).sort((x, y) => Math.abs(y.s.gap) - Math.abs(x.s.gap));
  const b = all[0];
  const def = ROWS.find((x) => x.key === b.r.key)!;
  const offLabel = b.s.qb ? `${b.s.qb.name} (No. ${b.s.qb.rank} of ${b.s.qb.of} FBS QBs)` : null;
  const pressurePoint =
    b.s.edge === "even"
      ? `No unit has a clear edge. The closest swing: ${offLabel ?? `${b.s.offense} ${def.offUnit} (No. ${b.s.offRank})`} against ${b.s.defense} ${def.defUnit} (No. ${b.s.defRank}). ${b.s.watch}`
      : b.s.edge === "offense"
        ? `${offLabel ?? `${b.s.offense} ${def.offUnit} (No. ${b.s.offRank})`} against ${b.s.defense} ${def.defUnit} (No. ${b.s.defRank}). ${b.s.watch}`
        : `${b.s.defense} ${def.defUnit} (No. ${b.s.defRank}) against ${offLabel ?? `${b.s.offense} ${def.offUnit} (No. ${b.s.offRank})`}. ${b.s.watch}`;
  const context = { away: contextFor(away.team, away.games), home: contextFor(home.team, home.games) };
  const meta = genMeta() as (ReturnType<typeof genMeta> & { rosterIngestedAt?: string }) | undefined;
  return { rows, context, pressurePoint, statsAsOf: meta?.rosterIngestedAt ?? meta?.ingestedAt, games: { away: away.games, home: home.games } };
}
