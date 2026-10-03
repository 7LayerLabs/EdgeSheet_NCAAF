/**
 * Team tendencies from CollegeFootballData advanced season stats.
 * Produces the Team Style cards, the pressure point, unit matchups, and the
 * style-contrast input to the Scout Score. Every label is a threshold rule
 * over a published metric, with the team's rank inside its classification.
 */
import { genTeams, type GenTeam, type GenUnit } from "./generated";
import { memoSync } from "./memo";

export interface Metric {
  key: string;
  label: string;
  value: string;
  rank?: number; // 1 = best for that side
  of?: number;
  pct?: number; // 0..100, 100 = best
}

export interface UnitStyle {
  label: string;
  summary: string;
  metrics: Metric[];
  sample: "full" | "small";
}

export interface TeamStyle {
  team: string;
  classification: string | null;
  games: number | null;
  offense: UnitStyle;
  defense: UnitStyle;
  raw: GenTeam;
}

type Dir = "high" | "low";
interface Def { key: keyof GenUnit; label: string; off: Dir; def: Dir; fmt: (n: number) => string; }

const pctF = (n: number) => `${Math.round(n * 100)}%`;
const f2 = (n: number) => n.toFixed(2);
const f1 = (n: number) => n.toFixed(1);

/** Offense wants high, defense wants low, unless noted. */
const DEFS: Def[] = [
  { key: "passRate", label: "Pass rate", off: "high", def: "high", fmt: pctF },
  { key: "sr", label: "Success rate", off: "high", def: "low", fmt: pctF },
  { key: "ex", label: "Explosiveness", off: "high", def: "low", fmt: f2 },
  { key: "ppa", label: "EPA per play", off: "high", def: "low", fmt: f2 },
  { key: "rushSr", label: "Rush success", off: "high", def: "low", fmt: pctF },
  { key: "passSr", label: "Pass success", off: "high", def: "low", fmt: pctF },
  { key: "passEx", label: "Pass explosiveness", off: "high", def: "low", fmt: f2 },
  { key: "ly", label: "Line yards", off: "high", def: "low", fmt: f2 },
  { key: "stuff", label: "Stuff rate", off: "low", def: "high", fmt: pctF },
  { key: "havoc", label: "Havoc rate", off: "low", def: "high", fmt: pctF },
  { key: "havocF7", label: "Front-seven havoc", off: "low", def: "high", fmt: pctF },
  { key: "pdSr", label: "Passing-downs success", off: "high", def: "low", fmt: pctF },
  { key: "ppo", label: "Points per trip inside 40", off: "high", def: "low", fmt: f2 },
];

interface Tables { off: Map<string, number[]>; def: Map<string, number[]> }

function tables(): Map<string, Tables> {
  return memoSync("tend:tables", 3600, () => {
    const byCls = new Map<string, Tables>();
    for (const t of genTeams()) {
      const c = t.c ?? "fbs";
      const tb = byCls.get(c) ?? byCls.set(c, { off: new Map(), def: new Map() }).get(c)!;
      for (const d of DEFS) {
        const o = t.off[d.key];
        const de = t.def[d.key];
        if (typeof o === "number") (tb.off.get(d.key) ?? tb.off.set(d.key, []).get(d.key)!).push(o);
        if (typeof de === "number") (tb.def.get(d.key) ?? tb.def.set(d.key, []).get(d.key)!).push(de);
      }
    }
    for (const tb of byCls.values()) {
      for (const arr of tb.off.values()) arr.sort((a, b) => a - b);
      for (const arr of tb.def.values()) arr.sort((a, b) => a - b);
    }
    return byCls;
  });
}

function rankIn(sorted: number[], v: number, wantHigh: boolean): { rank: number; of: number; pct: number } {
  const n = sorted.length;
  let below = 0;
  while (below < n && sorted[below] < v) below++;
  const rank = wantHigh ? n - below : below + 1;
  const pct = Math.round(((wantHigh ? below : n - below - 1) / Math.max(1, n - 1)) * 100);
  return { rank: Math.max(1, Math.min(n, rank)), of: n, pct: Math.max(0, Math.min(100, pct)) };
}

function unit(t: GenTeam, side: "off" | "def"): UnitStyle {
  const tb = tables().get(t.c ?? "fbs");
  const u = t[side];
  const metrics: Metric[] = [];
  for (const d of DEFS) {
    const v = u[d.key];
    if (typeof v !== "number") continue;
    const wantHigh = (side === "off" ? d.off : d.def) === "high";
    const sorted = tb?.[side].get(d.key);
    // Pass rate is a style, not a quality: no rank.
    const r = sorted && d.key !== "passRate" ? rankIn(sorted, v, wantHigh) : undefined;
    metrics.push({ key: d.key, label: d.label, value: d.fmt(v), rank: r?.rank, of: r?.of, pct: r?.pct });
  }
  const games = t.games ?? 0;
  const sample: UnitStyle["sample"] = games >= 4 ? "full" : "small";
  const m = (k: string) => metrics.find((x) => x.key === k);

  if (side === "off") {
    const pr = u.passRate ?? 0.5;
    const pace = u.drives ? u.plays / u.drives : 0;
    const balance = pr >= 0.58 ? "Pass-first" : pr <= 0.42 ? "Run-first" : "Balanced";
    const quality = (m("sr")?.pct ?? 50) >= 75 ? "efficient" : (m("ex")?.pct ?? 50) >= 75 ? "explosive" : (m("sr")?.pct ?? 50) <= 25 ? "struggling" : "average";
    const trench = (m("ly")?.pct ?? 50) >= 75 ? "wins the line" : (m("ly")?.pct ?? 50) <= 25 ? "loses the line" : null;
    const label = `${balance}, ${quality}${trench ? `, ${trench}` : ""}`;
    const summary = `${Math.round(pr * 100)}% pass. Success rate ${pctF(u.sr)} (No. ${m("sr")?.rank ?? "–"} of ${m("sr")?.of ?? "–"}), explosiveness ${f2(u.ex)} (No. ${m("ex")?.rank ?? "–"}). ${pace ? `${f1(pace)} plays per drive.` : ""}`;
    return { label, summary, metrics, sample };
  }
  const havoc = u.havoc ?? 0;
  const front = (m("havocF7")?.pct ?? 50) >= 70 ? "disruptive front" : (m("ly")?.pct ?? 50) >= 70 ? "stout front" : (m("ly")?.pct ?? 50) <= 30 ? "soft front" : "average front";
  const back = (m("passEx")?.pct ?? 50) >= 70 ? "limits deep shots" : (m("passEx")?.pct ?? 50) <= 30 ? "gives up explosives" : "average on explosives";
  const label = `${havoc >= 0.19 ? "Havoc" : havoc <= 0.13 ? "Bend-don't-break" : "Balanced"} defense, ${front}`;
  const summary = `Havoc ${pctF(havoc)} (No. ${m("havoc")?.rank ?? "–"} of ${m("havoc")?.of ?? "–"}). Success allowed ${pctF(u.sr)} (No. ${m("sr")?.rank ?? "–"}). ${back[0].toUpperCase()}${back.slice(1)}.`;
  return { label, summary, metrics, sample };
}

export function styleFor(school: string): TeamStyle | undefined {
  const t = genTeams().find((x) => x.team === school);
  if (!t) return undefined;
  return memoSync(`tend:${school}`, 3600, () => ({ team: t.team, classification: t.c, games: t.games, offense: unit(t, "off"), defense: unit(t, "def"), raw: t }));
}

/* ------------------------------------------------- matchup derivations */

type Axis = "rush" | "pass" | "line" | "pd";

function meaning(axis: Axis, edge: UnitEdge["edge"], mag: number, offTeam: string, defTeam: string): { verdict: string; meaning: string; watch: string } {
  const tier = mag >= 55 ? "dominant" : mag >= 40 ? "clear" : mag >= 20 ? "real" : "slight";
  const lead =
    edge === "even"
      ? "Strength on strength."
      : tier === "dominant"
        ? "This is not a lean. It is a mismatch, and a prominent one."
        : tier === "clear"
          ? "A clear edge, the kind that shapes a game plan."
          : "A real edge, not a lock.";
  const o = offTeam;
  const d = defTeam;
  if (edge === "even") {
    const m: Record<Axis, string> = {
      rush: `Neither side has shown it can impose the run on a unit this good. The first stuffed series tells you who blinks.`,
      pass: `${o} takes shots and ${d} gives up few. Whoever wins the first deep ball changes the other side's call sheet.`,
      line: `The line of scrimmage is a coin flip by the numbers. Watch first contact on the first two drives.`,
      pd: `Both sides are average on long downs. Early-down efficiency decides who sees more of them.`,
    };
    return { verdict: lead, meaning: m[axis], watch: `First quarter: who wins ${axis === "pass" ? "the first deep shot" : "first contact"}.` };
  }
  if (edge === "offense") {
    const m: Record<Axis, string> = {
      rush: tier === "dominant"
        ? `Expect ${o} to lean on the run early and often, and to keep leaning. Once ${d} loads the box, play-action is the second punch.`
        : `${o} should stay on schedule on the ground, which keeps third downs short and the clock moving.`,
      pass: tier === "dominant"
        ? `${d} does not keep the lid on. ${o} will take shots, and the market total may be underpriced if they land.`
        : `${o} has the deep ball available. Watch whether ${d} rolls a safety over after the first one.`,
      line: tier === "dominant"
        ? `The line of scrimmage belongs to ${o}. Second-level runs and play-action are live all afternoon.`
        : `${o} should win first contact more often than not, which makes every down shorter.`,
      pd: `${o} converts the long downs ${d} needs to win. A third-and-8 is not a stop here.`,
    };
    const w: Record<Axis, string> = {
      rush: `Watch ${o}'s rushing attempts by halftime. North of 20 means the plan is working.`,
      pass: `Watch the first deep shot. If it connects, ${d} changes shells and the run game opens.`,
      line: `Watch yards before contact on ${o}'s first ten carries.`,
      pd: `Watch ${o}'s third-and-long conversions. Two in the first half breaks ${d}'s plan.`,
    };
    return { verdict: lead, meaning: m[axis], watch: w[axis] };
  }
  const m: Record<Axis, string> = {
    rush: tier === "dominant"
      ? `${d} erases the run. ${o} gets pushed into passing downs, and that is where this defense makes its money.`
      : `${o} will find the run hard going. Expect more second-and-long than usual.`,
    pass: tier === "dominant"
      ? `Deep balls are the lowest-percentage play in this game. ${o} needs the underneath game and yards after catch.`
      : `${d} keeps the lid on. ${o} should expect to drive the long way.`,
    line: tier === "dominant"
      ? `${d} wins first contact. Backs get met in the backfield; screens and the quick game are the counter.`
      : `${d} should hold the line of scrimmage. ${o}'s runs will need the second level to break.`,
    pd: `${d} gets off the field on long downs. Early-down efficiency is everything for ${o}.`,
  };
  const w: Record<Axis, string> = {
    rush: `Watch ${o}'s yards per carry through the first quarter. Under 3 and the game plan has to change.`,
    pass: `Watch ${o}'s longest completion. If it is under 25 yards at the half, ${d} has won the matchup.`,
    line: `Watch tackles for loss. ${d} living in the backfield early is the tell.`,
    pd: `Watch ${o} on third-and-7 or longer. Punts there mean the defense is winning.`,
  };
  return { verdict: lead, meaning: m[axis], watch: w[axis] };
}

export interface UnitEdge {
  title: string; // "Georgia run game vs Alabama front"
  text: string;
  edge: "offense" | "defense" | "even";
  gap: number; // percentile gap
  evidence: string;
  meaning: string;
  watch: string;
  strength: "dominant" | "clear" | "real" | "slight" | "even";
}

/** Compare one offense against one defense on the four axes that decide games. */
export function unitEdges(offTeam: string, defTeam: string): UnitEdge[] {
  const o = styleFor(offTeam);
  const d = styleFor(defTeam);
  if (!o || !d) return [];
  const om = (k: string) => o.offense.metrics.find((m) => m.key === k);
  const dm = (k: string) => d.defense.metrics.find((m) => m.key === k);
  const axes: { key: string; axis: Axis; title: string; what: string; against: string }[] = [
    { key: "rushSr", axis: "rush", title: `${offTeam} run game vs ${defTeam} run defense`, what: "rush success rate", against: "against the run" },
    { key: "passEx", axis: "pass", title: `${offTeam} deep passing vs ${defTeam} secondary`, what: "pass explosiveness", against: "at limiting explosive passes" },
    { key: "ly", axis: "line", title: `${offTeam} offensive line vs ${defTeam} front`, what: "line yards per carry", against: "at the line of scrimmage" },
    { key: "pdSr", axis: "pd", title: `${offTeam} on passing downs vs ${defTeam} pressure`, what: "passing-downs success", against: "on passing downs" },
  ];
  const out: UnitEdge[] = [];
  for (const a of axes) {
    const x = om(a.key);
    const y = dm(a.key);
    if (x?.pct === undefined || y?.pct === undefined) continue;
    const gap = x.pct - y.pct;
    const mag = Math.abs(gap);
    const edge: UnitEdge["edge"] = gap >= 20 ? "offense" : gap <= -20 ? "defense" : "even";
    const strength: UnitEdge["strength"] = edge === "even" ? "even" : mag >= 55 ? "dominant" : mag >= 40 ? "clear" : mag >= 20 ? "real" : "slight";
    const mn = meaning(a.axis, edge, mag, offTeam, defTeam);
    const text =
      edge === "offense"
        ? `${offTeam} is No. ${x.rank} of ${x.of} in ${a.what} (${x.value}). ${defTeam} ranks No. ${y.rank} ${a.against} (${y.value}). ${mn.verdict} ${mn.meaning}`
        : edge === "defense"
          ? `${defTeam} is No. ${y.rank} of ${y.of} ${a.against} (${y.value}). ${offTeam} ranks No. ${x.rank} in ${a.what} (${x.value}). ${mn.verdict} ${mn.meaning}`
          : `${offTeam} is No. ${x.rank} in ${a.what} (${x.value}) and ${defTeam} is No. ${y.rank} ${a.against} (${y.value}). ${mn.verdict} ${mn.meaning}`;
    out.push({
      title: a.title,
      text,
      edge,
      gap,
      evidence: `${a.what}: offense ${x.value} (No. ${x.rank}/${x.of}), defense ${y.value} (No. ${y.rank}/${y.of}), gap ${mag} percentile points`,
      meaning: mn.meaning,
      watch: mn.watch,
      strength,
    });
  }
  return out.sort((p, q) => Math.abs(q.gap) - Math.abs(p.gap));
}

/** The single matchup most likely to decide the game, in plain words. */
export function pressurePoint(away: string, home: string): string | undefined {
  const edges = [...unitEdges(away, home), ...unitEdges(home, away)];
  if (!edges.length) return undefined;
  const top = edges[0];
  const even = edges.filter((e) => e.edge === "even");
  if (Math.abs(top.gap) < 20 && even.length) {
    return `No unit has a clear edge. The closest thing to a swing: ${even[0].title.toLowerCase()}. ${even[0].text} ${even[0].watch}`;
  }
  return `${top.title}. ${top.text} ${top.watch}`;
}

/** 0..100 how different the two offenses are in how they play. */
export function styleContrast(a: string, b: string): number | null {
  const x = styleFor(a);
  const y = styleFor(b);
  if (!x || !y) return null;
  const pr = Math.abs((x.raw.off.passRate ?? 0.5) - (y.raw.off.passRate ?? 0.5)) * 100; // 0..~40
  const paceX = x.raw.off.drives ? x.raw.off.plays / x.raw.off.drives : 0;
  const paceY = y.raw.off.drives ? y.raw.off.plays / y.raw.off.drives : 0;
  const pace = Math.abs(paceX - paceY) * 10; // 0..~20
  const havoc = Math.abs((x.raw.def.havoc ?? 0.15) - (y.raw.def.havoc ?? 0.15)) * 200; // 0..~20
  return Math.round(Math.min(100, pr * 1.8 + pace + havoc));
}

/** League averages inside a classification, used to anchor the model total. */
export function leagueMeans(cls: string): { offPpa: number; defPpa: number; plays: number; teams: number } {
  return memoSync(`tend:means:${cls}`, 3600, () => {
    const t = genTeams().filter((x) => (x.c ?? "fbs") === cls);
    if (!t.length) return { offPpa: 0.16, defPpa: 0.06, plays: 67, teams: 0 };
    const m = (f: (x: GenTeam) => number) => t.reduce((s, x) => s + f(x), 0) / t.length;
    return { offPpa: m((x) => x.off.ppa), defPpa: m((x) => x.def.ppa), plays: m((x) => x.off.plays / Math.max(1, x.games ?? 1)), teams: t.length };
  });
}
