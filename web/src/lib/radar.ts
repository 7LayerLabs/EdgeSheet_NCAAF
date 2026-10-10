/**
 * Scouting Radar: who NFL scouts are looking at, by draft class, built only
 * from verified inputs: the roster (class, size), season production,
 * usage share, recruiting pedigree, and the team's level of play.
 *
 * This is not a draft projection and never claims to be one. It ranks
 * evidence. Every number on a card can be traced to a source row.
 */
import { genPlayers, genMeta, type GenPlayer } from "./generated";
import { memoSync } from "./memo";
import { adjustedIndex, type QocLabel } from "./adjusted";
import { movementFor, movementStamp } from "./movement";

export type PosGroup = "QB" | "RB" | "WR" | "TE" | "OL" | "DL" | "EDGE" | "LB" | "CB" | "S" | "ST";
export type RadarTier = "Eligible" | "Future" | "Sleeper" | "Watch";

export interface Evidence {
  label: string; // "612 rec yds"
  note?: string; // "top 4% of FBS WR"
  kind: "production" | "pedigree" | "size" | "usage" | "unit";
}

export interface RadarPlayer {
  id: string;
  name: string;
  team: string;
  classification: "fbs" | "fcs" | "ii" | "iii" | null;
  conference: string | null;
  pos: string;
  group: PosGroup;
  classYear: number | null; // 1..4
  cls: string; // Fr So Jr Sr
  draftClass: number; // 2027, 2028, 2029
  eligibilityNote: string;
  height: number | null;
  weight: number | null;
  jersey: number | null;
  score: number; // 0..100
  production: number; // 0..100 percentile within classification + group
  pedigree: number; // 0..100
  usage: number; // 0..100
  size: boolean | null; // meets NFL size norms for the position; null when unknown
  tier: RadarTier;
  evidence: Evidence[];
  stat: string; // one-line stat summary
  statLine: { label: string; value: string }[];
  watch: string; // what to watch, position-specific
  stars: number | null;
  recruitRank: number | null;
  hometown: string | null;
  gamesPlayed: number | null;
  /** Raw production percentile before the opponent adjustment (same as `production` when no game log exists). */
  rawProduction: number;
  /** Opponent-adjusted production percentile, when a game log exists. */
  adjustedProduction: number | null;
  /** Quality of competition: average opponent percentile faced on his production axis (100 = toughest). */
  qoc: number | null;
  qocLabel: QocLabel;
  /** Radar score change between the last two weekly snapshots. null until two snapshots exist. */
  delta: number | null;
}

/* ----------------------------------------------------------- helpers */

const GROUP: Record<string, PosGroup> = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", C: "OL", G: "OL", T: "OL",
  DL: "DL", DT: "DL", NT: "DL", DE: "EDGE", EDGE: "EDGE", OLB: "EDGE",
  LB: "LB", ILB: "LB", MLB: "LB",
  DB: "CB", CB: "CB", S: "S", FS: "S", SS: "S",
  PK: "ST", K: "ST", P: "ST", LS: "ST",
};

export const GROUP_LABEL: Record<PosGroup, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end", OL: "Offensive line",
  DL: "Interior D-line", EDGE: "Edge", LB: "Linebacker", CB: "Cornerback", S: "Safety", ST: "Specialist",
};

const CLS = ["", "Fr", "So", "Jr", "Sr"];

/** NFL size norms (height inches, weight lbs). Rough, public, position-standard. */
const SIZE: Partial<Record<PosGroup, { h?: number; w?: number }>> = {
  QB: { h: 73 }, RB: { w: 205 }, WR: { h: 72 }, TE: { h: 76, w: 240 }, OL: { h: 75, w: 300 },
  DL: { w: 290 }, EDGE: { h: 75, w: 245 }, LB: { w: 228 }, CB: { h: 71 }, S: { w: 195 },
};

const LEVEL: Record<string, number> = { fbs: 1, fcs: 0.72, ii: 0.5, iii: 0.38 };

function nextDraftYear(): number {
  const m = genMeta();
  return (m?.season ?? new Date().getFullYear()) + 1;
}

/** Raw production number per group. Higher is better. Per-game where it matters. */
function production(p: GenPlayer, group: PosGroup): number {
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
      return 0; // no box-score stats; unit evidence is attached elsewhere
    case "ST":
      if ((s.fga ?? 0) >= 6) return (s.fgm ?? 0) * 5 + (s.fgp ?? 0) * 0.6 + (s.fglg ?? 0) * 0.5;
      if ((s.pno ?? 0) >= 10) return (s.ypp ?? 0) * 2 + (s.pin20 ?? 0) * 2;
      return 0;
  }
}

function statLine(p: GenPlayer, group: PosGroup): { line: string; table: { label: string; value: string }[] } {
  const s = p.s ?? {};
  const t: { label: string; value: string }[] = [];
  const add = (label: string, v: number | undefined, fmt: (n: number) => string = (n) => String(n)) => {
    if (v !== undefined && v !== null) t.push({ label, value: fmt(v) });
  };
  switch (group) {
    case "QB":
      add("Comp / Att", s.pc !== undefined && s.pa !== undefined ? 0 : undefined, () => `${s.pc} / ${s.pa}`);
      add("Pass yds", s.py); add("TD", s.ptd); add("INT", s.pint); add("Y/A", s.ypa, (n) => n.toFixed(1)); add("Rush yds", s.ry); add("Rush TD", s.rtd);
      return { line: `${s.py ?? 0} pass yds, ${s.ptd ?? 0} TD, ${s.pint ?? 0} INT${s.ypa ? `, ${s.ypa.toFixed(1)} Y/A` : ""}`, table: t };
    case "RB":
      add("Carries", s.ra); add("Rush yds", s.ry); add("Y/C", s.ypc, (n) => n.toFixed(1)); add("Rush TD", s.rtd); add("Rec", s.rec); add("Rec yds", s.rcy); add("Long", s.rlg);
      return { line: `${s.ry ?? 0} rush yds on ${s.ra ?? 0} carries, ${s.rtd ?? 0} TD${s.rcy ? `, ${s.rcy} rec yds` : ""}`, table: t };
    case "WR":
    case "TE":
      add("Rec", s.rec); add("Rec yds", s.rcy); add("Y/R", s.ypr, (n) => n.toFixed(1)); add("TD", s.rctd); add("Long", s.rclg); add("Rush yds", s.ry);
      return { line: `${s.rec ?? 0} rec, ${s.rcy ?? 0} yds, ${s.rctd ?? 0} TD${s.ypr ? `, ${s.ypr.toFixed(1)} Y/R` : ""}`, table: t };
    case "EDGE":
    case "DL":
    case "LB":
      add("Tackles", s.tk); add("Solo", s.solo); add("TFL", s.tfl); add("Sacks", s.sk); add("QB hurries", s.hur); add("PD", s.pd); add("INT", s.int); add("Fum rec", s.fr);
      return { line: `${s.tk ?? 0} tkl, ${s.tfl ?? 0} TFL, ${s.sk ?? 0} sacks${s.hur ? `, ${s.hur} hurries` : ""}`, table: t };
    case "CB":
    case "S":
      add("Tackles", s.tk); add("INT", s.int); add("PD", s.pd); add("TFL", s.tfl); add("INT yds", s.inty); add("Def TD", s.dtd);
      return { line: `${s.int ?? 0} INT, ${s.pd ?? 0} PD, ${s.tk ?? 0} tkl`, table: t };
    case "OL":
      return { line: "No box-score stats for linemen. See unit evidence.", table: t };
    case "ST":
      if ((s.fga ?? 0) > 0) { add("FG", 0, () => `${s.fgm} / ${s.fga}`); add("Long", s.fglg); add("Pct", s.fgp, (n) => `${n}%`); return { line: `${s.fgm ?? 0}/${s.fga ?? 0} FG, long ${s.fglg ?? 0}`, table: t }; }
      add("Punts", s.pno); add("Avg", s.ypp, (n) => n.toFixed(1)); add("Inside 20", s.pin20);
      return { line: `${s.pno ?? 0} punts, ${s.ypp?.toFixed(1) ?? "0"} avg`, table: t };
  }
}

/** Position-specific scouting checklist. Domain knowledge, not a claim about the player. */
const WATCH: Record<PosGroup, string> = {
  QB: "Ball placement outside the numbers, how he resets his feet when the first read is covered, and whether he throws on time against pressure.",
  RB: "Contact balance through the first tackler, vision on zone cuts, and whether he is trusted in pass protection on third down.",
  WR: "Release against press, separation at the top of the route, and hands away from his frame in traffic.",
  TE: "Whether he stays in to block on early downs, how he wins in the seam, and if the offense trusts him on third down.",
  OL: "Pass-set depth against speed off the edge, hand placement on first contact, and whether he climbs cleanly to linebackers.",
  DL: "First-step quickness, anchor against double teams, and whether his pass-rush plan has a counter when the first move fails.",
  EDGE: "Get-off at the snap, bend around the arc, and whether he sets the edge against the run instead of only chasing sacks.",
  LB: "Diagnosis speed on run fits, sideline-to-sideline range, and how he handles tight ends and backs in coverage.",
  CB: "Press technique at the line, hip fluidity in transition, and ball production when the throw comes his way.",
  S: "Alignment versatility (deep, slot, box), tackling angles in space, and range from the middle of the field.",
  ST: "Leg strength on long attempts, operation time, and consistency in wind.",
};

/**
 * What to watch for this player, picked from his own numbers so two quarterbacks
 * on the same slate never read the same. Each rule cites a real stat and asks the
 * question a scout would ask of that profile; WATCH[group] is the fallback when
 * nothing in the line stands out.
 */
function watchFor(p: GenPlayer, group: PosGroup, prodPct: number): string {
  const s = p.s ?? {};
  const g = Math.max(1, p.g ?? 1);
  const per = (n?: number) => (n ?? 0) / g;
  const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
  const stars = p.r?.st ?? 0;
  const ht = p.h ? `${Math.floor(p.h / 12)}-${p.h % 12}` : null;
  const blue = stars >= 4 && prodPct < 40;
  const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  switch (group) {
    case "QB": {
      const pa = s.pa ?? 0;
      const comp = pa ? Math.round((100 * (s.pc ?? 0)) / pa) : 0;
      const ypa = s.ypa ?? (pa ? (s.py ?? 0) / pa : 0);
      if (pa < 40) return `Only ${pl(pa, "throw")} so far. Watch how much the staff trusts him on third down and in two-minute.`;
      if ((s.pint ?? 0) / pa >= 0.03) return `${pl(s.pint ?? 0, "pick")} in ${pa} throws. Watch whether the turnovers come from forcing it into coverage or from pressure in his face.`;
      if (per(s.ry) >= 40) return `Adds ${Math.round(per(s.ry))} rushing yards a game. Watch whether he escapes to keep the play alive downfield or tucks it at the first sign of pressure.`;
      if (blue) return `A ${stars}-star still waiting on the production to match. Watch his timing and whether he throws receivers open or waits for them to come free.`;
      if (comp < 58) return `Completing ${comp}% of his throws. Accuracy is the question, especially outside the numbers and on the move.`;
      if (ypa >= 9.5 && (s.pint ?? 0) <= 2) return `Big plays with almost no turnovers. The test is whether he still pushes the ball when the first read is covered and the pocket gets muddy.`;
      if (comp >= 70) return `Completing ${comp}%. Watch how much is quick game and screens versus throws into tight windows past the sticks.`;
      return WATCH.QB;
    }
    case "RB": {
      const ypc = s.ypc ?? ((s.ry ?? 0) / Math.max(1, s.ra ?? 1));
      if (per(s.ra) >= 20) return `A workhorse at ${f1(per(s.ra))} carries a game. Watch his burst and ball security in the fourth quarter.`;
      if ((s.ra ?? 0) >= 40 && ypc < 4) return `Only ${f1(ypc)} a carry. Is that him or the blocking? Watch his yards after first contact.`;
      if (per(s.rec) >= 2.5) return `Catches ${f1(per(s.rec))} balls a game. Watch his routes out of the backfield and whether he stays in to block on third down.`;
      if (ypc >= 6.5) return `${f1(ypc)} yards a carry. Watch how much of that is him making defenders miss versus the holes his line opens.`;
      if ((s.rtd ?? 0) >= 5) return `The goal-line back with ${pl(s.rtd ?? 0, "rushing TD")}. Watch his pad level and patience in short yardage.`;
      if (blue) return `A ${stars}-star who has not found volume yet. Watch whether he gets the ball in the second half or loses snaps to the rotation.`;
      return WATCH.RB;
    }
    case "WR": {
      const ypr = s.ypr ?? ((s.rcy ?? 0) / Math.max(1, s.rec ?? 1));
      if (per(s.rec) >= 6) return `The go-to target at ${f1(per(s.rec))} catches a game. Watch his release against press and who the defense rolls coverage toward.`;
      if ((s.rec ?? 0) >= 8 && ypr >= 17) return `${f1(ypr)} yards a catch says vertical threat. Watch whether he also wins underneath and makes people miss after the catch.`;
      if ((s.rctd ?? 0) >= 4 && (s.rctd ?? 0) / Math.max(1, s.rec ?? 1) >= 0.2) return `${pl(s.rctd ?? 0, "TD")} on ${s.rec} catches. Watch him in the red zone: body control and hands on contested balls.`;
      if (p.h && p.h >= 75) return `At ${ht}, watch him on 50-50 balls and back-shoulder throws, and whether he can sink his hips on short routes.`;
      if (blue) return `A ${stars}-star with only ${pl(s.rec ?? 0, "catch", "catches")}. Watch whether he is getting open and missed, or lost in the rotation.`;
      if (p.h && p.h <= 70) return `A smaller receiver at ${ht}. Watch his quickness out of breaks and whether he holds up against physical corners.`;
      return WATCH.WR;
    }
    case "TE": {
      if (per(s.rec) >= 4) return `A real receiving weapon at ${f1(per(s.rec))} catches a game. Watch his seam routes and whether he still stays in to block on early downs.`;
      if ((s.rec ?? 0) <= 6) return `Mostly a blocker so far (${pl(s.rec ?? 0, "catch", "catches")}). Watch his hand placement in the run game and whether he gets a target on third down.`;
      return WATCH.TE;
    }
    case "EDGE":
    case "DL": {
      const sk = s.sk ?? 0;
      const tfl = s.tfl ?? 0;
      const hur = s.hur ?? 0;
      if (sk >= 5) return group === "DL"
        ? `${f1(sk)} sacks from the interior. Watch whether he wins with power or quickness, and how he handles the double team.`
        : `${f1(sk)} sacks already. Watch whether he wins with a counter move or only with speed around the edge.`;
      if (hur >= 5 && hur >= 2 * sk) return `${pl(hur, "hurry", "hurries")} but ${f1(sk)} sacks. He gets home; watch whether he finishes.`;
      if (tfl >= 5 && tfl >= 2 * sk + 2) return `${f1(tfl)} tackles for loss, mostly against the run. Watch whether the pass rush catches up to the run defense.`;
      if (blue) return `A ${stars}-star with ${f1(sk)} sacks. Watch whether he is drawing chips and double teams or getting stonewalled one-on-one.`;
      if (p.w && p.w >= 300) return `${p.w} pounds in the middle. Watch his anchor against the run and whether he can collapse the pocket on passing downs.`;
      return WATCH[group];
    }
    case "LB": {
      if (per(s.tk) >= 8) return `Piles up ${f1(per(s.tk))} tackles a game. Watch how many come near the line versus five yards downfield after a gain.`;
      if ((s.pd ?? 0) + (s.int ?? 0) >= 4) return `${pl((s.pd ?? 0) + (s.int ?? 0), "ball", "balls")} defended from linebacker. Watch him matched up on backs and tight ends.`;
      if ((s.sk ?? 0) >= 3) return `${f1(s.sk ?? 0)} sacks from linebacker. Watch his timing on blitzes and whether he can still drop into coverage.`;
      if (blue) return `A ${stars}-star still growing into the job. Watch how fast he reads run or pass and fills his gap.`;
      return WATCH.LB;
    }
    case "CB": {
      if ((s.int ?? 0) >= 3) return `${pl(s.int ?? 0, "interception")}. Watch whether quarterbacks still test him or start throwing the other way.`;
      if ((s.pd ?? 0) >= 6) return `${s.pd} passes defended. The ball skills are there; watch his hips when receivers break.`;
      if (per(s.tk) >= 5) return `${f1(per(s.tk))} tackles a game is a lot for a corner, which usually means he is being thrown at. Watch his coverage on early downs.`;
      if (p.h && p.h >= 73) return `A long corner at ${ht}. Watch his press at the line and whether he can turn and run with speed.`;
      return WATCH.CB;
    }
    case "S": {
      if (per(s.tk) >= 7) return `Lives near the line at ${f1(per(s.tk))} tackles a game. Watch his angles in space and whether he can also play deep.`;
      if ((s.int ?? 0) + (s.pd ?? 0) >= 5) return `A ball hawk with ${pl((s.int ?? 0) + (s.pd ?? 0), "ball", "balls")} defended. Watch his range from the middle of the field.`;
      return WATCH.S;
    }
    case "OL": {
      if (p.w && p.w >= 320) return `${ht ?? ""}${ht ? ", " : ""}${p.w} lb. Power is not the question; watch his feet against speed off the edge.`;
      if (p.w && p.w < 300) return `Light for the position at ${p.w} lb. Watch whether he holds up against bull rushes and anchors on the move.`;
      return WATCH.OL;
    }
    case "ST":
      return WATCH.ST;
  }
}

function pct(sorted: number[], v: number): number {
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

/* ----------------------------------------------------------- index */

export interface RadarIndex {
  byId: Map<string, RadarPlayer>;
  byTeam: Map<string, RadarPlayer[]>;
  all: RadarPlayer[]; // sorted by score desc
  nextDraft: number;
}

function buildIndex(): RadarIndex {
  const players = genPlayers();
  const nextDraft = nextDraftYear();
  const adjIdx = adjustedIndex();

  // Percentile tables per classification + group over players with real volume.
  const tables = new Map<string, number[]>();
  const raw = new Map<string, number>();
  for (const p of players) {
    const group = GROUP[p.p ?? ""] ?? null;
    if (!group || !p.c) continue;
    const v = production(p, group);
    raw.set(p.id, v);
    if (v > 0) {
      const key = `${p.c}:${group}`;
      (tables.get(key) ?? tables.set(key, []).get(key)!).push(v);
    }
  }
  for (const arr of tables.values()) arr.sort((a, b) => a - b);

  const out: RadarPlayer[] = [];
  for (const p of players) {
    const group = GROUP[p.p ?? ""] ?? null;
    if (!group || !p.c || !p.p) continue;
    if (group === "ST") continue;
    const level = LEVEL[p.c] ?? 0.5;
    const v = raw.get(p.id) ?? 0;
    const rawPct = v > 0 ? pct(tables.get(`${p.c}:${group}`) ?? [], v) : 0;
    // Opponent adjustment: when a game log exists, production is half the raw season percentile and half the
    // percentile of opponent-weighted per-game production (see adjusted.ts). Without a log it is the raw percentile.
    const adj = adjIdx.byId.get(p.id);
    const prodPct = adj && v > 0 ? Math.round(0.5 * rawPct + 0.5 * adj.adjPct) : rawPct;

    const stars = p.r?.st ?? null;
    const pedigree = stars === 5 ? 100 : stars === 4 ? 72 : stars === 3 ? 38 : stars === 2 ? 15 : 0;
    const usageShare = p.u?.o ?? 0;
    // 33% of team usage = 100. Quarterbacks touch every pass, so their share is halved to keep the board honest across positions.
    const usage = Math.min(100, Math.round(usageShare * (group === "QB" ? 150 : 300)));

    const norm = SIZE[group];
    const size = norm && (p.h || p.w) ? (norm.h ? (p.h ?? 0) >= norm.h : true) && (norm.w ? (p.w ?? 0) >= norm.w : true) : null;

    const y = p.y ?? null;
    const cls = y ? CLS[y] ?? "" : "";
    const draftClass = y === 4 ? nextDraft : y === 3 ? nextDraft : y === 2 ? nextDraft + 1 : nextDraft + 2;
    const eligibilityNote =
      y === 4 ? "Senior. Eligible for the next draft." :
      y === 3 ? "Junior. Eligible to declare for the next draft." :
      y === 2 ? "Sophomore. Earliest eligible the draft after next unless redshirted." :
      y === 1 ? "Freshman. Earliest eligible in two drafts; redshirt status unknown." : "Class unknown.";

    // Position weights from the 2022-2025 backtest against NFL outcomes (nflverse value per season):
    // production is the better signal at RB, QB, TE, and interior DL; pedigree wins at WR, CB, S, LB, EDGE.
    // Linemen have no box-score stats, so production is zero and unit evidence is added by the game report.
    const PROD_FIRST = new Set<PosGroup>(["RB", "QB", "TE", "DL"]);
    const prodWeight = group === "OL" ? 0 : PROD_FIRST.has(group) ? 0.55 : 0.35;
    const pedWeight = group === "OL" ? 0.22 : PROD_FIRST.has(group) ? 0.22 : 0.42;
    const base = prodWeight * prodPct + pedWeight * pedigree + 0.13 * usage + 0.10 * (size ? 100 : size === null ? 40 : 0);
    const olBonus = group === "OL" ? (y && y >= 3 ? 25 : 10) + (size ? 20 : 0) : 0;
    const score = Math.round(Math.min(100, (base + olBonus) * level));

    // Tiering. Honest labels: nothing here says "Round 2".
    let tier: RadarTier | null = null;
    const upper = y === 3 || y === 4;
    if (upper && score >= 62) tier = "Eligible";
    else if (upper && score >= 45) tier = "Sleeper";
    else if (!upper && (score >= 55 || (pedigree >= 72 && usage >= 20))) tier = "Future";
    else if (pedigree >= 72 || (upper && score >= 36) || (!upper && score >= 45)) tier = "Watch";
    if (!tier) continue;

    const evidence: Evidence[] = [];
    const sl = statLine(p, group);
    if (v > 0) evidence.push({ kind: "production", label: sl.line, note: prodPct >= 50 ? `top ${Math.max(1, 100 - prodPct)}% of ${p.c.toUpperCase()} ${group}` : undefined });
    if (stars) evidence.push({ kind: "pedigree", label: `${stars}-star recruit${p.r?.rk ? `, No. ${p.r.rk} in the ${p.r.yr} class` : ""}`, note: p.r?.rt ? `rating ${p.r.rt.toFixed(4)}` : undefined });
    if (p.h && p.w) evidence.push({ kind: "size", label: `${Math.floor(p.h / 12)}-${p.h % 12}, ${p.w} lb`, note: size ? "NFL size for the position" : size === false ? "under NFL size norms" : undefined });
    if (usageShare >= 0.1) evidence.push({ kind: "usage", label: `${Math.round(usageShare * 100)}% of team usage`, note: p.u?.pd ? `${Math.round(p.u.pd * 100)}% on passing downs` : undefined });

    out.push({
      id: p.id,
      name: p.n,
      team: p.t,
      classification: p.c,
      conference: p.cf,
      pos: p.p,
      group,
      classYear: y,
      cls,
      draftClass,
      eligibilityNote,
      height: p.h,
      weight: p.w,
      jersey: p.j,
      score,
      production: prodPct,
      pedigree,
      usage,
      size,
      tier,
      evidence,
      stat: sl.line,
      statLine: sl.table,
      watch: watchFor(p, group, prodPct),
      stars,
      recruitRank: p.r?.rk ?? null,
      hometown: p.home,
      gamesPlayed: p.g,
      rawProduction: rawPct,
      adjustedProduction: adj && v > 0 ? adj.adjPct : null,
      qoc: adj?.qoc ?? null,
      qocLabel: adj?.qocLabel ?? "unmeasured",
      delta: movementFor(p.id)?.scoreDelta ?? null,
    });
  }

  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const byId = new Map(out.map((p) => [p.id, p]));
  const byTeam = new Map<string, RadarPlayer[]>();
  for (const p of out) (byTeam.get(p.team) ?? byTeam.set(p.team, []).get(p.team)!).push(p);
  return { byId, byTeam, all: out, nextDraft };
}

export const radarIndex = (): RadarIndex => memoSync(`radar:${genMeta()?.ingestedAt ?? "none"}:${adjustedIndex().stamp}:${movementStamp()}`, 3600, buildIndex);

export const radarForTeam = (school: string): RadarPlayer[] => radarIndex().byTeam.get(school) ?? [];
export const radarPlayer = (id: string): RadarPlayer | undefined => radarIndex().byId.get(id);

export interface BoardFilter {
  draftClass?: number;
  group?: PosGroup;
  classification?: "fbs" | "fcs" | "ii" | "iii";
  q?: string;
  limit?: number;
}

export function radarBoard(f: BoardFilter = {}): RadarPlayer[] {
  const q = f.q?.trim().toLowerCase();
  let list = radarIndex().all;
  if (f.draftClass) list = list.filter((p) => p.draftClass === f.draftClass);
  if (f.group) list = list.filter((p) => p.group === f.group);
  if (f.classification) list = list.filter((p) => p.classification === f.classification);
  if (q) list = list.filter((p) => `${p.name} ${p.team} ${p.pos} ${p.conference ?? ""}`.toLowerCase().includes(q));
  return list.slice(0, f.limit ?? 100);
}

/** Players a game report should surface for one team: top eligible, then future, capped. */
export function radarForGame(school: string, cap = 6): RadarPlayer[] {
  const list = radarForTeam(school);
  // Eligible names in score order, but the fourth slot has to earn it.
  const eligible = list.filter((p) => p.tier === "Eligible").filter((p, i) => i < 3 || p.score >= 75).slice(0, 4);
  const future = list.filter((p) => p.tier === "Future").filter((p, i) => i < 1 || p.score >= 65).slice(0, 2);
  const sleepers = eligible.length < 2 ? list.filter((p) => p.tier === "Sleeper").slice(0, 1) : [];
  const seen = new Set<string>();
  return [...eligible, ...future, ...sleepers].filter((p) => (seen.has(p.id) ? false : seen.add(p.id))).slice(0, cap);
}
