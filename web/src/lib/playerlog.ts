/**
 * Per-player play logs from ESPN's summary play-by-play (Division I only).
 *
 * ESPN's college play text is stat-crew style. Verified 2026-10-03 on SEC, Big Ten,
 * ACC, Big 12, AAC, and FCS games (see AGENT-REPORT-liveplan.md for the full catalog):
 *
 *   (14:14) Shotgun #28 S.Alexander rush middle for 7 yards gain to the UGA49 (#5 R.Wilson; #8 D.Jones), 1ST DOWN
 *   (12:28) Shotgun #14 G.Stockton pass complete short left to #23 J.Reddell caught at UGA19, for 6 yards to the UGA26 (#11 B.Longwell)
 *   (12:48) Shotgun #1 B.Berlowitz pass incomplete short right thrown to UGA30
 *   (11:03) Shotgun #14 G.Stockton sacked for loss of 7 yards to the UGA01 (#8 C.Heard)
 *   (12:26) ... #1 B.Berlowitz pass intercepted by #1 E.Robinson IV at UGA30 #1 E.Robinson IV return 0 yards to the UGA30 (#0 J.Sherrill)
 *   (00:52) ... for 22 yards to the ISU41 fumbled by #2 D.Epps at ISU40 forced by #24 B.Miller recovered by ISU #3 S.Johnson at ISU41
 *   (15:00) #91 P.Woodring kickoff 65 yards to the VAN00, Touchback
 *   (12:30) #91 P.Woodring field goal attempt from 39 yards GOOD (H: #14 G.Stockton, LS: #51 W.Snellings), clock 12:27
 *
 * Players are "#<jersey> <Initial>.<Last>" with suffixes kept ("#1 E.Robinson IV", "#3 M.Hawkins Jr.",
 * "#18 B.Edmiston, Jr.") and multi-word last names kept ("#2 R.Vander Zee"). A second, narrative style
 * shows up on scoring plays before the detailed text lands and in scoringPlays[]:
 *   "Devin McCuin 15 Yd pass from Julian Sayin (Connor Hawkins Kick)"
 * Some plays name a team instead of a player ("Charlotte rush middle for 20 yards loss"); those never match.
 * Penalty plays that end in "NO PLAY" are nullified and skipped. The leading "(mm:ss)" is the snap clock;
 * play.clock is the clock after the play. Plays carry start.down/distance, period, homeScore/awayScore,
 * scoringPlay, statYardage, and teamParticipants (offense/defense team ids, with kick plays flipped).
 *
 * Matching is strict: jersey plus first initial plus last name (suffix stripped), on the player's own
 * roster from data/generated/players.json. Jersey numbers repeat inside a team (Georgia has two 14s), so
 * all three parts are required. If another player in the game shares all three, the log is flagged
 * ambiguous and still returned so the UI can say so. Nothing here invents a play.
 */
import { memo } from "./memo";
import { genPlayers, type GenPlayer } from "./generated";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

/* --------------------------------------------------------------- raw shapes */

interface RawTeam {
  id: string;
  abbreviation?: string;
  location?: string;
  displayName?: string;
}

interface RawPlay {
  id: string;
  sequenceNumber?: string;
  text?: string;
  type?: { id?: string; text?: string; abbreviation?: string };
  period?: { number: number };
  clock?: { displayValue?: string };
  homeScore?: number;
  awayScore?: number;
  scoringPlay?: boolean;
  statYardage?: number;
  start?: { down?: number; distance?: number; yardLine?: number; yardsToEndzone?: number; downDistanceText?: string; team?: { id: string } };
  teamParticipants?: { id: string; type: "offense" | "defense"; order?: number }[];
}

interface RawSummary {
  header?: { competitions?: { status?: { type: { state: "pre" | "in" | "post"; shortDetail?: string; completed?: boolean }; period?: number; displayClock?: string }; competitors?: { homeAway: "home" | "away"; score?: string; team: RawTeam }[] }[] };
  boxscore?: { players?: { team: RawTeam; homeAway?: "home" | "away"; statistics: { athletes: { athlete: { id: string } }[] }[] }[] };
  drives?: { previous?: { plays?: RawPlay[] }[]; current?: { plays?: RawPlay[] } };
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/** Raw summary, memoized 60 seconds and shared by every player log for the game. */
function rawSummary(gameId: string): Promise<RawSummary | undefined> {
  return memo(`playerlog:raw:${gameId}`, 60, () => getJson<RawSummary>(`${BASE}/summary?event=${gameId}`));
}

/* ------------------------------------------------------------ public types */

export type PlayRole =
  | "pass" // threw it (complete or incomplete)
  | "rush"
  | "rec" // caught it
  | "target" // thrown to, incomplete
  | "sacked"
  | "int-thrown"
  | "fumble" // lost the ball
  | "sack"
  | "int"
  | "tackle"
  | "tfl"
  | "pbu"
  | "ff"
  | "fr"
  | "return"
  | "kick"
  | "punt"
  | "other";

export interface LogPlay {
  id: string;
  seq: number;
  quarter: number;
  /** Snap clock from the "(mm:ss)" prefix, else the clock after the play. */
  clock: string;
  down?: number;
  distance?: number;
  /** "2nd & 6 at VAN 44" as ESPN phrases it. */
  situation?: string;
  text: string;
  /** Yards credited to this player on the play (negative for sacks taken, losses). 0 for tackles and kicks. */
  yards: number;
  isScoring: boolean;
  /** 20+ yards for him, a touchdown, a sack, an interception, a tackle for loss, or a turnover either way. */
  isBig: boolean;
  role: PlayRole;
  /** Short fan-voice label: "41-yd TD pass to L.Roldan", "sack of G.Stockton for 7", "INT". */
  tag: string;
  type: string;
  homeScore: number;
  awayScore: number;
}

export interface ComputedLine {
  passing?: { cmp: number; att: number; yds: number; td: number; int: number; sacked: number };
  rushing?: { car: number; yds: number; td: number };
  receiving?: { tgt: number; rec: number; yds: number; td: number };
  defense?: { tkl: number; solo: number; ast: number; tfl: number; sacks: number; int: number; pbu: number; ff: number; fr: number };
  returns?: { n: number; yds: number; td: number };
  kicking?: { fgm: number; fga: number; xpm: number; xpa: number; punts: number; puntYds: number };
}

export interface PlayerLog {
  gameId: string;
  playerId: string;
  name: string;
  jersey: number | null;
  team: string;
  abbr?: string;
  side?: "home" | "away";
  state: "pre" | "in" | "post";
  detail: string;
  home: { abbr: string; score: number | null };
  away: { abbr: string; score: number | null };
  /** Ordered oldest to newest. */
  plays: LogPlay[];
  line: ComputedLine;
  /** Same voice as the box score headline, one per category with activity. */
  lineText: { category: string; headline: string }[];
  /** True when the player was found in the roster digest and had a usable match key. */
  matched: boolean;
  /** Another player in this game shares jersey, initial, and last name, so plays could be his. */
  ambiguous: boolean;
  ambiguousWith?: string;
  /** Why there is no log: no summary, no roster row, no jersey. Undefined when fine. */
  reason?: string;
  /** Total plays parsed for the game, so the UI can say "0 of 156 plays" rather than nothing. */
  playsParsed: number;
  asOf: string;
}

/* ------------------------------------------------------------- name match */

const SUFFIX = /\s*,?\s*(Jr\.?|Sr\.?|II|III|IV|V)$/i;

/** "Michael Hawkins Jr." -> { initial: "M", last: "Hawkins" }. "CJ Carr" -> C / Carr. */
export function nameKey(fullName: string): { initial: string; last: string } | undefined {
  const clean = fullName.replace(SUFFIX, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return undefined;
  return { initial: parts[0][0].toUpperCase(), last: parts.slice(1).join(" ") };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex source for the player's token in ESPN text: "#14 G\.Stockton(?: Jr\.| IV)?" */
export function tokenPattern(jersey: number, initial: string, last: string): string {
  return `#${jersey}\\s${esc(initial)}\\.${esc(last)}(?:,?\\s(?:Jr\\.?|Sr\\.?|II|III|IV|V))?(?![A-Za-z'\\-])`;
}

/** Short name for a counterpart in a tag: "#8 L.Roldan" -> "L.Roldan". */
function shortName(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const m = token.match(/#\d+\s+([A-Z]\.[A-Za-z'\-]+(?:\s[A-Z][A-Za-z'\-]+)*)/);
  return m ? m[1].replace(/\s(Jr\.?|Sr\.?|II|III|IV|V)$/, "") : undefined;
}

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : n === 5 ? "OT" : `${n - 4}OT`);

/* ------------------------------------------------------------- parsing */

interface Parsed {
  role: PlayRole;
  yards: number;
  td: boolean;
  tag: string;
  /** Extra counters the role implies (a sack taken is also a fumble, etc.). */
  extra?: Partial<{ tfl: boolean; solo: boolean; ast: boolean; fgGood: boolean; fgTry: boolean; xpGood: boolean; xpTry: boolean; punt: boolean; fairCatch: boolean }>;
}

const TD = /TOUCHDOWN/;
const GAIN = "for (\\d+) yards? (gain|loss)|for no gain";

/** Any player token: "#12 J.Smith Jr." */
const ANY_TOKEN = "#\\d+\\s[A-Z]\\.[A-Za-z'\\-]+(?:\\s[A-Z][A-Za-z'\\-]+)*(?:,?\\s(?:Jr\\.?|Sr\\.?|II|III|IV|V))?";

/**
 * Parse one play for one player token. Returns every role the player has in the
 * text (a QB can be sacked and fumble on the same play), most important first.
 */
function parseFor(text: string, T: string, fullName: string): Parsed[] {
  const out: Parsed[] = [];
  const td = TD.test(text);
  const tok = new RegExp(T);
  if (!tok.test(text) && !text.includes(fullName)) return out;
  const fullEsc = esc(fullName);

  // Passer.
  let m = text.match(new RegExp(`${T} pass (complete|incomplete|intercepted)`));
  if (m) {
    const kind = m[1];
    if (kind === "complete") {
      const y = text.match(new RegExp(`${T} pass complete[^#]*?to (${ANY_TOKEN}) caught at [A-Z&'\\- ]*\\d+, (?:${GAIN}|for (-?\\d+) yards?)`));
      const yards = y ? (y[4] != null ? Number(y[4]) : y[2] ? Number(y[2]) * (y[3] === "loss" ? -1 : 1) : 0) : 0;
      const to = shortName(y?.[1]);
      out.push({ role: "pass", yards, td, tag: td ? `${yards}-yd TD pass${to ? ` to ${to}` : ""}` : `${yards}-yd completion${to ? ` to ${to}` : ""}` });
    } else if (kind === "incomplete") {
      const y = text.match(new RegExp(`${T} pass incomplete[^#]*?to (${ANY_TOKEN})`));
      const to = shortName(y?.[1]);
      const bu = /broken up by/.test(text);
      out.push({ role: "pass", yards: 0, td: false, tag: `incomplete${to ? ` to ${to}` : ""}${bu ? ", broken up" : ""}` });
    } else {
      out.push({ role: "int-thrown", yards: 0, td: false, tag: "INT thrown" });
    }
  }
  // Two-point pass or rush attempt by the player (no yards credited).
  if (!m && new RegExp(`${T} (pass|rush) attempt (Successful|failed)`).test(text)) {
    const r = text.match(new RegExp(`${T} (pass|rush) attempt (Successful|failed)`))!;
    out.push({ role: r[1] === "pass" ? "pass" : "rush", yards: 0, td: false, tag: `2-pt ${r[1]} ${r[2] === "Successful" ? "good" : "failed"}` });
  }

  // Sacked.
  m = text.match(new RegExp(`${T} sacked for loss of (\\d+) yards?`));
  if (m) out.push({ role: "sacked", yards: -Number(m[1]), td: false, tag: `sacked for ${m[1]}` });

  // Rusher.
  m = text.match(new RegExp(`${T} rush \\w+ (?:${GAIN})`));
  if (m) {
    const yards = m[1] ? Number(m[1]) * (m[2] === "loss" ? -1 : 1) : 0;
    out.push({ role: "rush", yards, td, tag: td ? `${yards}-yd TD run` : yards < 0 ? `run for ${yards}` : `${yards}-yd run` });
  }

  // Receiver or target.
  m = text.match(new RegExp(`pass complete[^#]*?to ${T} caught at [A-Z&'\\- ]*\\d+, (?:${GAIN}|for (-?\\d+) yards?)`));
  if (m) {
    const yards = m[3] != null ? Number(m[3]) : m[1] ? Number(m[1]) * (m[2] === "loss" ? -1 : 1) : 0;
    const from = shortName(text.match(new RegExp(`(${ANY_TOKEN}) pass complete`))?.[1]);
    out.push({ role: "rec", yards, td, tag: td ? `${yards}-yd TD catch${from ? ` from ${from}` : ""}` : `${yards}-yd catch${from ? ` from ${from}` : ""}` });
  } else if (new RegExp(`pass incomplete[^#]*?to ${T}`).test(text)) {
    out.push({ role: "target", yards: 0, td: false, tag: "targeted, incomplete" });
  }

  // Interception.
  if (new RegExp(`intercepted by ${T}`).test(text)) {
    const ret = text.match(new RegExp(`${T} return (\\d+) yards?`));
    const yards = ret ? Number(ret[1]) : 0;
    const qb = shortName(text.match(new RegExp(`(${ANY_TOKEN}) pass intercepted`))?.[1]);
    out.push({ role: "int", yards, td, tag: `INT${qb ? ` off ${qb}` : ""}${yards ? `, ${yards}-yd return` : ""}${td ? ", TD" : ""}` });
  }

  // Pass broken up.
  if (new RegExp(`broken up by ${T}`).test(text)) out.push({ role: "pbu", yards: 0, td: false, tag: "pass broken up" });

  // Sack by (the player is in the tackle parens of a sack).
  const sackM = text.match(new RegExp(`(${ANY_TOKEN}) sacked for loss of (\\d+) yards? to the [A-Z&'\\- ]*\\d+ \\(([^)]*)\\)`));
  if (sackM && new RegExp(T).test(sackM[3])) {
    const shared = sackM[3].includes(";");
    out.push({ role: "sack", yards: -Number(sackM[2]), td: false, tag: `${shared ? "half sack" : "sack"} of ${shortName(sackM[1]) ?? "the QB"} for ${sackM[2]}`, extra: { tfl: true, solo: !shared, ast: shared } });
  }

  // Tackle: the paren group right after "to the XXX00" or "at XXX00" on a run, catch, or return.
  if (!sackM || !new RegExp(T).test(sackM[3])) {
    const tackleGroups = [...text.matchAll(/(?:to the|at) [A-Z&'\- ]*\d+ \(([^)]*)\)/g)].map((g) => g[1]).filter((g) => !/^H:/.test(g));
    const hit = tackleGroups.find((g) => new RegExp(T).test(g));
    if (hit) {
      const loss = /yards? loss|for loss of/.test(text) && !/return \d+ yards?/.test(text);
      const shared = hit.includes(";");
      const lossM = text.match(/for (\d+) yards? loss/);
      out.push({ role: loss ? "tfl" : "tackle", yards: 0, td: false, tag: loss ? `TFL${lossM ? `, ${lossM[1]}-yd loss` : ""}` : shared ? "assisted tackle" : "solo tackle", extra: { tfl: loss, solo: !shared, ast: shared } });
    }
  }

  // Fumbles.
  if (new RegExp(`fumbled? by ${T}`).test(text)) out.push({ role: "fumble", yards: 0, td: false, tag: /recovered by [A-Z&'\-]+ ${T}/.test(text) ? "fumbled, recovered it" : "fumble" });
  if (new RegExp(`forced by ${T}`).test(text)) out.push({ role: "ff", yards: 0, td: false, tag: "forced fumble" });
  const fr = text.match(new RegExp(`recovered by [A-Z&'\\-]+ ${T}`));
  if (fr && !new RegExp(`fumbled? by ${T}`).test(text)) {
    const ret = text.match(new RegExp(`${T} return (\\d+) yards?`));
    out.push({ role: "fr", yards: ret ? Number(ret[1]) : 0, td, tag: `fumble recovery${td ? ", TD" : ""}` });
  }

  // Kicks and punts.
  m = text.match(new RegExp(`${T} field goal attempt from (\\d+) yards? (GOOD|NO GOOD)`));
  if (m) out.push({ role: "kick", yards: Number(m[1]), td: false, tag: `${m[1]}-yd FG ${m[2] === "GOOD" ? "good" : "no good"}`, extra: { fgTry: true, fgGood: m[2] === "GOOD" } });
  m = text.match(new RegExp(`${T} kick attempt (good|failed)`));
  if (m) out.push({ role: "kick", yards: 0, td: false, tag: `PAT ${m[1]}`, extra: { xpTry: true, xpGood: m[1] === "good" } });
  m = text.match(new RegExp(`${T} kickoff (\\d+) yards?`));
  if (m) out.push({ role: "kick", yards: Number(m[1]), td: false, tag: `${m[1]}-yd kickoff${/Touchback/.test(text) ? ", touchback" : ""}` });
  m = text.match(new RegExp(`${T} punt (\\d+) yards?`));
  if (m) out.push({ role: "punt", yards: Number(m[1]), td: false, tag: `${m[1]}-yd punt`, extra: { punt: true } });

  // Kick or punt return (not an interception or fumble return, handled above).
  const ret = text.match(new RegExp(`(?:kickoff|punt) \\d+ yards? to the [A-Z&'\\- ]*\\d+ ${T} return (\\d+) yards?`));
  if (ret) out.push({ role: "return", yards: Number(ret[1]), td, tag: td ? `${ret[1]}-yd return TD` : `${ret[1]}-yd return` });
  if (new RegExp(`fair catch by ${T}`).test(text)) out.push({ role: "return", yards: 0, td: false, tag: "fair catch", extra: { fairCatch: true } });

  // Narrative style (scoring plays before the detailed text lands): "Devin McCuin 15 Yd pass from Julian Sayin (Connor Hawkins Kick)".
  if (!out.length && text.includes(fullName)) {
    let n = text.match(new RegExp(`^${fullEsc} (\\d+) Yd pass from (.+?) \\(`));
    if (n) out.push({ role: "rec", yards: Number(n[1]), td: true, tag: `${n[1]}-yd TD catch from ${n[2]}` });
    n = text.match(new RegExp(`^(.+?) (\\d+) Yd pass from ${fullEsc}`));
    if (n) out.push({ role: "pass", yards: Number(n[2]), td: true, tag: `${n[2]}-yd TD pass to ${n[1]}` });
    n = text.match(new RegExp(`^${fullEsc} (\\d+) Yd Run`));
    if (n) out.push({ role: "rush", yards: Number(n[1]), td: true, tag: `${n[1]}-yd TD run` });
    n = text.match(new RegExp(`^${fullEsc} (\\d+) Yd Field Goal`));
    if (n) out.push({ role: "kick", yards: Number(n[1]), td: false, tag: `${n[1]}-yd FG good`, extra: { fgTry: true, fgGood: true } });
    n = text.match(new RegExp(`^${fullEsc} (\\d+) Yd (?:Interception|Fumble|Kickoff|Punt) Return`));
    if (n) out.push({ role: "return", yards: Number(n[1]), td: true, tag: `${n[1]}-yd return TD` });
    if (new RegExp(`\\(${fullEsc} Kick\\)`).test(text)) out.push({ role: "kick", yards: 0, td: false, tag: "PAT good", extra: { xpTry: true, xpGood: true } });
    if (!out.length) out.push({ role: "other", yards: 0, td, tag: "involved" });
  }
  return out;
}

const BIG_ROLES: PlayRole[] = ["sack", "sacked", "int", "int-thrown", "tfl", "ff", "fr", "fumble"];

function isBig(parsed: Parsed[]): boolean {
  return parsed.some((p) => p.td || BIG_ROLES.includes(p.role) || (["pass", "rush", "rec", "return"].includes(p.role) && p.yards >= 20));
}

/* ------------------------------------------------------------- line math */

function accumulate(line: ComputedLine, parsed: Parsed[]) {
  for (const p of parsed) {
    switch (p.role) {
      case "pass": {
        const x = (line.passing ??= { cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacked: 0 });
        if (p.tag.startsWith("2-pt")) break;
        x.att++;
        if (!p.tag.startsWith("incomplete")) {
          x.cmp++;
          x.yds += p.yards;
          if (p.td) x.td++;
        }
        break;
      }
      case "int-thrown": {
        const x = (line.passing ??= { cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacked: 0 });
        x.att++;
        x.int++;
        break;
      }
      case "sacked": {
        // NCAA counts a sack as a rushing attempt for the quarterback.
        const x = (line.passing ??= { cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacked: 0 });
        x.sacked++;
        const r = (line.rushing ??= { car: 0, yds: 0, td: 0 });
        r.car++;
        r.yds += p.yards;
        break;
      }
      case "rush": {
        if (p.tag.startsWith("2-pt")) break;
        const r = (line.rushing ??= { car: 0, yds: 0, td: 0 });
        r.car++;
        r.yds += p.yards;
        if (p.td) r.td++;
        break;
      }
      case "rec": {
        const r = (line.receiving ??= { tgt: 0, rec: 0, yds: 0, td: 0 });
        r.tgt++;
        r.rec++;
        r.yds += p.yards;
        if (p.td) r.td++;
        break;
      }
      case "target": {
        const r = (line.receiving ??= { tgt: 0, rec: 0, yds: 0, td: 0 });
        r.tgt++;
        break;
      }
      case "sack":
      case "tackle":
      case "tfl":
      case "int":
      case "pbu":
      case "ff":
      case "fr": {
        const d = (line.defense ??= { tkl: 0, solo: 0, ast: 0, tfl: 0, sacks: 0, int: 0, pbu: 0, ff: 0, fr: 0 });
        if (p.role === "sack") {
          d.sacks += p.extra?.ast ? 0.5 : 1;
          d.tfl++;
          d.tkl++;
          if (p.extra?.solo) d.solo++;
          else d.ast++;
        } else if (p.role === "tackle" || p.role === "tfl") {
          d.tkl++;
          if (p.extra?.tfl) d.tfl++;
          if (p.extra?.solo) d.solo++;
          else d.ast++;
        } else if (p.role === "int") d.int++;
        else if (p.role === "pbu") d.pbu++;
        else if (p.role === "ff") d.ff++;
        else if (p.role === "fr") d.fr++;
        break;
      }
      case "return": {
        if (p.extra?.fairCatch) break;
        const r = (line.returns ??= { n: 0, yds: 0, td: 0 });
        r.n++;
        r.yds += p.yards;
        if (p.td) r.td++;
        break;
      }
      case "kick":
      case "punt": {
        const k = (line.kicking ??= { fgm: 0, fga: 0, xpm: 0, xpa: 0, punts: 0, puntYds: 0 });
        if (p.extra?.fgTry) {
          k.fga++;
          if (p.extra.fgGood) k.fgm++;
        }
        if (p.extra?.xpTry) {
          k.xpa++;
          if (p.extra.xpGood) k.xpm++;
        }
        if (p.extra?.punt) {
          k.punts++;
          k.puntYds += p.yards;
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Headlines in the same voice as src/lib/espn.ts and src/lib/boxscore.ts. */
export function lineHeadlines(line: ComputedLine): { category: string; headline: string }[] {
  const out: { category: string; headline: string }[] = [];
  if (line.passing && (line.passing.att || line.passing.sacked)) out.push({ category: "passing", headline: `${line.passing.cmp}/${line.passing.att}, ${line.passing.yds} yds, ${line.passing.td} TD, ${line.passing.int} INT${line.passing.sacked ? `, sacked ${line.passing.sacked}x` : ""}` });
  if (line.rushing && line.rushing.car) out.push({ category: "rushing", headline: `${line.rushing.car} car, ${line.rushing.yds} yds, ${line.rushing.td} TD` });
  if (line.receiving && line.receiving.tgt) out.push({ category: "receiving", headline: `${line.receiving.rec} rec, ${line.receiving.yds} yds, ${line.receiving.td} TD on ${line.receiving.tgt} tgt` });
  if (line.defense) {
    const d = line.defense;
    const extras = [d.int ? `${d.int} INT` : "", d.pbu ? `${d.pbu} PD` : "", d.ff ? `${d.ff} FF` : "", d.fr ? `${d.fr} FR` : ""].filter(Boolean);
    out.push({ category: "defensive", headline: `${d.tkl} tkl, ${d.tfl} TFL, ${d.sacks} sacks${extras.length ? `, ${extras.join(", ")}` : ""}` });
  }
  if (line.returns && line.returns.n) out.push({ category: "returns", headline: `${line.returns.n} ret, ${line.returns.yds} yds${line.returns.td ? `, ${line.returns.td} TD` : ""}` });
  if (line.kicking) {
    const k = line.kicking;
    const parts = [k.fga ? `FG ${k.fgm}/${k.fga}` : "", k.xpa ? `PAT ${k.xpm}/${k.xpa}` : "", k.punts ? `${k.punts} punts, ${(k.puntYds / k.punts).toFixed(1)} avg` : ""].filter(Boolean);
    if (parts.length) out.push({ category: "kicking", headline: parts.join(", ") });
  }
  return out;
}

/* ------------------------------------------------------------- roster side */

function playerRow(playerId: string): GenPlayer | undefined {
  return genPlayers().find((p) => p.id === String(playerId));
}

function sideFor(row: GenPlayer, s: RawSummary): { side?: "home" | "away"; abbr?: string; teamId?: string } {
  const comps = s.header?.competitions?.[0]?.competitors ?? [];
  // 1. The player's athlete id in the box score settles it.
  for (const side of s.boxscore?.players ?? []) {
    const has = side.statistics.some((c) => c.athletes.some((a) => a.athlete.id === row.id));
    if (has) {
      const comp = comps.find((c) => c.team.id === side.team.id);
      return { side: side.homeAway ?? comp?.homeAway, abbr: side.team.abbreviation ?? comp?.team.abbreviation, teamId: side.team.id };
    }
  }
  // 2. School name equals ESPN's team location ("Georgia" = "Georgia").
  const byName = comps.find((c) => c.team.location === row.t || c.team.displayName === row.t);
  if (byName) return { side: byName.homeAway, abbr: byName.team.abbreviation, teamId: byName.team.id };
  return {};
}

/* ------------------------------------------------------------------ main */

function emptyLog(gameId: string, playerId: string, row: GenPlayer | undefined, reason: string, s?: RawSummary): PlayerLog {
  const comps = s?.header?.competitions?.[0]?.competitors ?? [];
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const st = s?.header?.competitions?.[0]?.status;
  return {
    gameId,
    playerId,
    name: row?.n ?? "",
    jersey: row?.j ?? null,
    team: row?.t ?? "",
    state: st?.type.state ?? "pre",
    detail: st?.type.shortDetail ?? "",
    home: { abbr: home?.team.abbreviation ?? "HOME", score: home?.score != null ? Number(home.score) : null },
    away: { abbr: away?.team.abbreviation ?? "AWAY", score: away?.score != null ? Number(away.score) : null },
    plays: [],
    line: {},
    lineText: [],
    matched: false,
    ambiguous: false,
    reason,
    playsParsed: 0,
    asOf: new Date().toISOString(),
  };
}

function buildLog(gameId: string, playerId: string, s: RawSummary | undefined): PlayerLog {
  const row = playerRow(playerId);
  if (!row) return emptyLog(gameId, playerId, row, "Player is not in the roster digest, so plays cannot be matched by name.", s);
  if (!s || !s.header?.competitions?.[0]) return emptyLog(gameId, playerId, row, "ESPN has no summary for this game yet.");
  if (row.j == null) return emptyLog(gameId, playerId, row, "No jersey number on the roster, so plays cannot be matched strictly.", s);
  const key = nameKey(row.n);
  if (!key) return emptyLog(gameId, playerId, row, "Single-word roster name, so plays cannot be matched strictly.", s);

  const base = emptyLog(gameId, playerId, row, "", s);
  base.reason = undefined;
  const { side, abbr, teamId } = sideFor(row, s);
  base.side = side;
  base.abbr = abbr;

  // Ambiguity: anyone else in this game with the same jersey, initial, and last name.
  const comps = s.header.competitions[0].competitors ?? [];
  const schools = new Set(comps.map((c) => c.team.location).filter(Boolean) as string[]);
  const twin = genPlayers().find((p) => p.id !== row.id && p.j === row.j && schools.has(p.t) && (() => {
    const k = nameKey(p.n);
    return !!k && k.initial === key.initial && k.last.toLowerCase() === key.last.toLowerCase();
  })());
  if (twin) {
    base.ambiguous = true;
    base.ambiguousWith = `${twin.n} (${twin.t} ${twin.p ?? ""} #${twin.j})`.replace(/\s+\)/, ")");
  }

  const T = tokenPattern(row.j, key.initial, key.last);
  const drives = [...(s.drives?.previous ?? []), ...(s.drives?.current ? [s.drives.current] : [])];
  const raw = drives.flatMap((d) => d.plays ?? []);
  base.playsParsed = raw.length;
  base.matched = true;

  const line: ComputedLine = {};
  const plays: LogPlay[] = [];
  for (const p of raw) {
    // Replay reviews append the original call: "... The previous play is under automatic review - "Short of the
    // goal line". CALL OVERTURNED. (Original Play: ... TOUCHDOWN ...)". Keep only the ruling that stands.
    const text = (p.text ?? "")
      .replace(/\s*The previous play is under [\s\S]*$/, "")
      .replace(/\s*\(Original Play:[\s\S]*$/, "")
      // "for 24 yards gain (1)" on a penalty-enforced play: the number in parens is the yardage that counts.
      .replace(/for (\d+) (yards?) (gain|loss) \((\d+)\)/g, "for $4 $2 $3")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const type = p.type?.text ?? "";
    if (type === "Penalty" && /NO PLAY\s*$/.test(text)) continue; // nullified
    if (/^(End of|Timeout )/.test(text)) continue;
    const parsed = parseFor(text, T, row.n);
    if (!parsed.length) continue;
    // Side sanity on offensive roles: a jersey-and-name twin on the other team would be caught above, but
    // keep plays where the offense id disagrees with the player's team out of the log when we know both.
    const offense = p.teamParticipants?.find((t) => t.type === "offense")?.id ?? p.start?.team?.id;
    const offensiveOnly = parsed.every((x) => ["pass", "rush", "rec", "target", "sacked", "int-thrown"].includes(x.role));
    if (offensiveOnly && teamId && offense && offense !== teamId && !/kickoff|punt/i.test(type)) continue;
    accumulate(line, parsed);
    const main = parsed[0];
    const snap = text.match(/^\((\d+:\d+)\)/);
    plays.push({
      id: p.id,
      seq: Number(p.sequenceNumber ?? 0) || plays.length + 1,
      quarter: p.period?.number ?? 0,
      clock: snap?.[1] ?? p.clock?.displayValue ?? "",
      down: p.start?.down && p.start.down > 0 ? p.start.down : undefined,
      distance: p.start?.down && p.start.down > 0 ? p.start.distance : undefined,
      situation: p.start?.downDistanceText,
      text: snap ? text.slice(snap[0].length).trim() : text,
      yards: main.yards,
      isScoring: !!p.scoringPlay || parsed.some((x) => x.td),
      isBig: isBig(parsed),
      role: main.role,
      tag: parsed.map((x) => x.tag).join("; "),
      type,
      homeScore: p.homeScore ?? 0,
      awayScore: p.awayScore ?? 0,
    });
  }
  base.plays = plays;
  base.line = line;
  base.lineText = lineHeadlines(line);
  return base;
}

/**
 * Ordered plays involving the player, with a running line. Memoized 60 seconds.
 * Never throws; a log with `reason` set explains why it is empty.
 */
export function playerLog(gameId: string, playerId: string): Promise<PlayerLog> {
  const g = String(gameId);
  const p = String(playerId);
  return memo(`playerlog:${g}:${p}`, 60, async () => buildLog(g, p, await rawSummary(g)));
}

/** Logs for several players on one game, parsing the summary once. */
export async function playerLogs(gameId: string, playerIds: string[]): Promise<Record<string, PlayerLog>> {
  const g = String(gameId);
  const s = await rawSummary(g);
  const out: Record<string, PlayerLog> = {};
  for (const id of playerIds) out[id] = buildLog(g, String(id), s);
  return out;
}

export interface LastPlay {
  quarter: number;
  clock: string;
  tag: string;
  text: string;
  isBig: boolean;
  isScoring: boolean;
  /** "3rd 8:12" for the card. */
  when: string;
}

/** The newest play involving each player, for the radar cards on a live game page. Players with no play get nothing. */
export async function lastPlaysFor(gameId: string, playerIds: string[]): Promise<Record<string, LastPlay>> {
  const logs = await playerLogs(gameId, playerIds);
  const out: Record<string, LastPlay> = {};
  for (const [id, log] of Object.entries(logs)) {
    const last = log.plays[log.plays.length - 1];
    if (!last) continue;
    out[id] = { quarter: last.quarter, clock: last.clock, tag: last.tag, text: last.text, isBig: last.isBig, isScoring: last.isScoring, when: `${ordinal(last.quarter)} ${last.clock}` };
  }
  return out;
}

export { ordinal as quarterLabel };
