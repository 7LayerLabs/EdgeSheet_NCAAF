/**
 * Opener edges: a paper-trading ledger for the one angle the backtest supports.
 *
 * The rule, fixed before any live result (scripts/edge-study.mjs, 2022 to 2025): when the model's
 * margin and the book's line differ by LEAN points or more, take the model's side. Bet early:
 * against the opener the rule covered 55.9% on 576 games (57.4% on 390 with our own Elo), against
 * the close only 53.8%, because the line tends to move toward the model during the week.
 *
 * Locking: the first time scripts/edges.mjs sees a qualifying gap, the pick is frozen at the line
 * available at that moment (from data/lines/, DraftKings via ESPN). Nothing is ever re-picked.
 * Grading: against the locked line; closing-line value is how far the close moved toward the pick.
 *
 * Every number is a simulation at -110. Not betting advice.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const LEAN = 5;
export const MIN_WEEK = 4;
/** A pick only counts when we first saw the line this long before kickoff: the edge is an early-week edge. */
export const MIN_LEAD_HOURS = 48;
const WIN = 100 / 110;

export interface LineRecord {
  id: string;
  season: number;
  week: number;
  kickoff: string;
  home: { id: string; name: string; abbr: string };
  away: { id: string; name: string; abbr: string };
  neutral: boolean;
  book: string;
  open: { spread: number | null; total: number | null };
  snapshots: { at: string; spread: number | null; total: number | null }[];
  close?: { at: string; spread: number | null; total: number | null };
}

export interface EdgePick {
  gameId: string;
  season: number;
  week: number;
  kickoff: string;
  home: string;
  away: string;
  homeAbbr: string;
  awayAbbr: string;
  side: "home" | "away";
  pick: string; // "ALA -2.5"
  lockedAt: string;
  lockLine: number; // home margin the market implied at lock
  openLine: number | null;
  model: number; // model home margin at lock
  gap: number; // |model - lockLine|
  eloMargin?: number;
  netEdge?: number;
  book: string;
  // Filled when graded.
  closeLine?: number | null;
  clv?: number | null; // points the close moved toward the pick (positive is good)
  final?: { home: number; away: number };
  result?: "win" | "loss" | "push";
  units?: number;
}

export interface EdgeLedger {
  season: number;
  rule: string;
  picks: Record<string, EdgePick>;
}

const root = () => process.cwd();
const ledgerFile = (season: number) => path.join(root(), "data", "edges", `${season}.json`);
const linesDir = (season: number) => path.join(root(), "data", "lines", String(season));

export const RULE_TEXT = `Model margin vs the book line differs by ${LEAN}+ points, FBS vs FBS, week ${MIN_WEEK} on, model built on both Elo and unit edges. Locked at the first line we see, only when we saw it ${MIN_LEAD_HOURS}+ hours before kickoff; never re-picked.`;

/** Hours between our first look at the line and kickoff. */
export const leadHours = (r: LineRecord) => (r.snapshots[0] ? (new Date(r.kickoff).getTime() - new Date(r.snapshots[0].at).getTime()) / 3600_000 : 0);

export function readLedger(season: number): EdgeLedger {
  const f = ledgerFile(season);
  if (existsSync(f)) {
    try {
      return JSON.parse(readFileSync(f, "utf8")) as EdgeLedger;
    } catch {}
  }
  return { season, rule: RULE_TEXT, picks: {} };
}

export function writeLedger(l: EdgeLedger) {
  const f = ledgerFile(l.season);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(l, null, 1));
}

export function readLines(season: number): LineRecord[] {
  const d = linesDir(season);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(d, f), "utf8")) as LineRecord;
      } catch {
        return undefined;
      }
    })
    .filter((x): x is LineRecord => Boolean(x));
}

export const currentLine = (r: LineRecord) => r.snapshots.at(-1)?.spread ?? null;

/** "ALA -2.5" style text for a side at a home-margin line. */
export function pickText(side: "home" | "away", homeMargin: number, homeAbbr: string, awayAbbr: string): string {
  const spread = side === "home" ? -homeMargin : homeMargin;
  const s = spread === 0 ? "PK" : spread > 0 ? `+${spread}` : `${spread}`;
  return `${side === "home" ? homeAbbr : awayAbbr} ${s}`;
}

/** Decide a pick from the model's home margin and the current line, or undefined when the gap is under LEAN. */
export function decide(model: number, line: number): { side: "home" | "away"; gap: number } | undefined {
  const diff = model - line;
  if (Math.abs(diff) < LEAN) return undefined;
  return { side: diff > 0 ? "home" : "away", gap: Math.round(Math.abs(diff) * 10) / 10 };
}

/** Grade one pick in place from the final score and the closing line. */
export function grade(p: EdgePick, final: { home: number; away: number }, closeLine: number | null) {
  const actual = final.home - final.away;
  p.final = final;
  p.closeLine = closeLine;
  p.clv = closeLine == null ? null : Math.round((p.side === "home" ? closeLine - p.lockLine : p.lockLine - closeLine) * 10) / 10;
  if (actual === p.lockLine) p.result = "push";
  else p.result = (p.side === "home" ? actual > p.lockLine : actual < p.lockLine) ? "win" : "loss";
  p.units = p.result === "win" ? Math.round(WIN * 100) / 100 : p.result === "loss" ? -1 : 0;
}

export interface EdgeStats {
  picks: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null; // percent, pushes excluded
  units: number;
  roi: number | null; // percent of units risked
  clvAvg: number | null;
  clvPositive: number | null; // percent of graded picks with the close moving toward the pick
  pending: number;
}

export function edgeStats(picks: EdgePick[]): EdgeStats {
  const graded = picks.filter((p) => p.result);
  const wins = graded.filter((p) => p.result === "win").length;
  const losses = graded.filter((p) => p.result === "loss").length;
  const pushes = graded.filter((p) => p.result === "push").length;
  const units = Math.round(graded.reduce((a, p) => a + (p.units ?? 0), 0) * 100) / 100;
  const withClv = graded.filter((p) => p.clv != null);
  const moved = withClv.filter((p) => p.clv !== 0);
  return {
    picks: picks.length,
    graded: graded.length,
    wins,
    losses,
    pushes,
    winRate: wins + losses ? Math.round((1000 * wins) / (wins + losses)) / 10 : null,
    units,
    roi: wins + losses ? Math.round((1000 * units) / (wins + losses)) / 10 : null,
    clvAvg: withClv.length ? Math.round((10 * withClv.reduce((a, p) => a + (p.clv ?? 0), 0)) / withClv.length) / 10 : null,
    clvPositive: moved.length ? Math.round((1000 * moved.filter((p) => (p.clv ?? 0) > 0).length) / moved.length) / 10 : null,
    pending: picks.length - graded.length,
  };
}
