/**
 * Postgame recap: everything the site called before kickoff, next to what happened.
 *
 * Calls come from the accountability archive (locked before kickoff, never edited): the projection,
 * the market at lock, the matchup board (src/lib/matchboard.ts), the radar names, and the opener-edge
 * paper trade if one was taken. What happened comes from ESPN's finished game (src/lib/espn-final.ts).
 *
 * Every matchup verdict is a plain rule on this game's numbers, written out next to the verdict:
 *   O-line vs D-line         offense wins at 4.5+ yards a carry with 5 or fewer tackles for loss allowed;
 *                            defense wins under 3.5 a carry or with 9+ tackles for loss
 *   Running back vs front 7  offense wins with 3+ runs of 15 yards or a 40-yard run; defense wins with no
 *                            15-yard runs and under 4 a carry
 *   Receivers vs secondary   offense wins at 8.5+ yards a throw or 4+ completions of 20; defense wins under
 *                            6 a throw with 1 or fewer
 *   QB vs pass defense       QB wins at 1+ yard a throw above his season average with 1 or fewer picks;
 *                            defense wins at 1.5 below, 2+ picks, or 4+ sacks
 *   Red zone                 offense wins at 5+ points a trip inside the 40, defense at 3 or fewer
 *                            (2+ trips needed to call it)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Game } from "./types";
import { readEntry, gradeProspect, type ArchiveEntry, type BoardLock, type BoardSideLock } from "./archive";
import { espnFinal, type EspnFinal, type Swing, type TeamGame } from "./espn-final";
import { matchBoard } from "./matchboard";
import { readLedger, type EdgePick } from "./edges";

export type CallVerdict = "right" | "wrong" | "push" | "mixed" | "no call";

export interface RecapCall {
  label: string;
  called: string;
  actual: string;
  verdict: CallVerdict;
}

export interface RecapMatchup {
  key: string;
  title: string;
  offense: string;
  defense: string;
  called: string;
  actual: string;
  winner: "offense" | "defense" | "even" | "unmeasured";
  verdict: CallVerdict;
}

export interface RecapQb {
  name: string;
  team: string;
  type: string;
  rank: number;
  of: number;
  line: string;
  vsSeason: string;
  verdict: "above his average" | "about his average" | "below his average" | "did not play";
}

export interface RecapPlayer {
  name: string;
  team: string;
  pos: string;
  line: string;
  verdict: "showed up" | "quiet" | "unmeasured";
}

export interface RecapSwing {
  when: string;
  text: string;
  team: string; // school that gained
  before: number; // that school's win chance, percent
  after: number;
}

export interface Recap {
  headline: string;
  score: { right: number; wrong: number; mixed: number };
  calls: RecapCall[];
  pressure?: { text: string; verdict: CallVerdict };
  matchups: RecapMatchup[];
  qbs: RecapQb[];
  players: RecapPlayer[];
  swings: RecapSwing[];
  teams: { away: TeamGame; home: TeamGame };
  /** True when no board was locked before kickoff and the board shown is rebuilt from the same frozen team stats. */
  reconstructed: boolean;
  lockedAt?: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtLine = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : `${n}`);
/** Board unit labels read inside a sentence. */
const UNIT: Record<string, string> = { "Run game": "run game", "Front 7": "front seven", Receivers: "receivers", Secondary: "secondary", "Red zone O": "red zone offense", "Red zone D": "red zone defense", "Pass D": "pass defense" };
const unit = (l: string) => UNIT[l] ?? l;

function lockedClose(season: number, id: string): number | null {
  const f = path.join(process.cwd(), "data", "lines", String(season), `${id}.json`);
  if (!existsSync(f)) return null;
  try {
    const r = JSON.parse(readFileSync(f, "utf8"));
    return r.close?.spread ?? r.snapshots?.at(-1)?.spread ?? null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- matchups */

function gradeRow(key: string, side: BoardSideLock, o: TeamGame, d: TeamGame, final: EspnFinal): { actual: string; winner: RecapMatchup["winner"] } {
  const ypc = o.rushAtt ? o.rushYds / o.rushAtt : 0;
  const ypa = o.passAtt ? o.passYds / o.passAtt : 0;
  switch (key) {
    case "trenches": {
      const winner = ypc >= 4.5 && d.tfl <= 5 ? "offense" : ypc < 3.5 || d.tfl >= 9 ? "defense" : "even";
      return { winner, actual: `${o.school} ran for ${r1(ypc)} a carry; ${d.school} made ${d.tfl} tackles for loss (${d.sacks} sacks).` };
    }
    case "run": {
      const winner = o.explosiveRuns >= 3 || o.longRun >= 40 ? "offense" : o.explosiveRuns === 0 && ypc < 4 ? "defense" : "even";
      return { winner, actual: `${o.explosiveRuns} run${o.explosiveRuns === 1 ? "" : "s"} of 15+ yards, longest ${o.longRun}; ${r1(ypc)} a carry.` };
    }
    case "pass": {
      const winner = ypa >= 8.5 || o.explosivePasses >= 4 ? "offense" : ypa < 6 && o.explosivePasses <= 1 ? "defense" : "even";
      return { winner, actual: `${r1(ypa)} yards a throw, ${o.explosivePasses} completion${o.explosivePasses === 1 ? "" : "s"} of 20+ yards, longest ${o.longPass}.` };
    }
    case "qb": {
      const q = side.qb;
      const line = q ? final.box.byPlayer.get(q.id)?.find((l) => l.category === "passing") : undefined;
      if (!q || !line) return { winner: "unmeasured", actual: q ? `${q.name} did not throw a pass.` : "No quarterback on the board." };
      const [c, a] = String(line.stats["C/ATT"] ?? "0/0").split("/").map(Number);
      const yds = Number(line.stats.YDS ?? 0);
      const ints = Number(line.stats.INT ?? 0);
      const gameYpa = a ? yds / a : 0;
      const winner = gameYpa >= q.season.ypa + 1 && ints <= 1 ? "offense" : gameYpa <= q.season.ypa - 1.5 || ints >= 2 || d.sacks >= 4 ? "defense" : "even";
      return { winner, actual: `${q.name}: ${c}/${a}, ${yds} yds, ${line.stats.TD ?? 0} TD, ${ints} INT, ${r1(gameYpa)} a throw (season ${r1(q.season.ypa)}), sacked ${d.sacks} time${d.sacks === 1 ? "" : "s"}.` };
    }
    case "redzone": {
      const pts = o.tripTd * 7 + o.tripFg * 3;
      const ppt = o.trips ? pts / o.trips : 0;
      const winner = o.trips < 2 ? "unmeasured" : ppt >= 5 ? "offense" : ppt <= 3 ? "defense" : "even";
      return { winner, actual: `${o.trips} trip${o.trips === 1 ? "" : "s"} inside the 40: ${o.tripTd} TD, ${o.tripFg} FG (${r1(ppt)} points a trip).` };
    }
  }
  return { winner: "unmeasured", actual: "" };
}

function calledText(side: BoardSideLock, offLabel: string, defLabel: string): string {
  const off = side.qb ? `${side.qb.name} (No. ${side.qb.rank} of ${side.qb.of} QBs)` : `${side.offense} ${unit(offLabel)} (No. ${side.offRank})`;
  const def = `${side.defense} ${unit(defLabel)} (No. ${side.defRank})`;
  if (side.edge === "even") return `Even: ${off} vs ${def}.`;
  const strength = side.strength === "mismatch" ? "Mismatch" : side.strength === "clear" ? "Clear edge" : "Edge";
  return side.edge === "offense" ? `${strength} ${side.offense}: ${off} over ${def}.` : `${strength} ${side.defense}: ${def} over ${off}.`;
}

const verdictOf = (called: BoardSideLock["edge"], winner: RecapMatchup["winner"]): CallVerdict =>
  winner === "unmeasured" ? "no call" : called === "even" ? "no call" : winner === "even" ? "mixed" : winner === called ? "right" : "wrong";

/* --------------------------------------------------------------- build */

export async function buildRecap(game: Game): Promise<Recap | undefined> {
  if (game.status !== "final" || !game.score) return undefined;
  const final = await espnFinal(game.id, game.home.short, game.away.short).catch(() => undefined);
  if (!final?.completed) return undefined;
  const season = new Date(game.kickoff).getUTCFullYear();
  const entry: ArchiveEntry | undefined = game.archive ?? readEntry(season, game.id);
  const pre = entry?.pregame;
  const H = game.home, A = game.away;
  const hs = game.score.home, as = game.score.away;
  const homeMargin = hs - as;
  const winner = homeMargin > 0 ? H : homeMargin < 0 ? A : undefined;

  /* calls */
  const calls: RecapCall[] = [];
  const proj = pre?.projection;
  if (proj) {
    const projWinner = proj.winner === H.abbr ? H : A;
    const projHome = proj.winner === H.abbr ? proj.margin : -proj.margin;
    calls.push({
      label: "Winner",
      called: `${projWinner.short} (${Math.round(proj.winProb * 100)}% to win)`,
      actual: winner ? `${winner.short} won ${Math.max(hs, as)} to ${Math.min(hs, as)}` : `Tied ${hs} to ${as}`,
      verdict: !winner ? "push" : winner.abbr === proj.winner ? "right" : "wrong",
    });
    const err = Math.abs(homeMargin - projHome);
    calls.push({
      label: "Margin",
      called: `${projWinner.short} by ${r1(proj.margin)}`,
      actual: `${winner ? `${winner.short} by ${Math.abs(homeMargin)}` : "a tie"}, off by ${r1(err)}`,
      verdict: err <= 7 ? "right" : err <= 14 ? "mixed" : "wrong",
    });
    if (proj.modelTotal != null && pre?.total != null && proj.totalLean && proj.totalLean !== "none") {
      const pts = hs + as;
      calls.push({
        label: "Total",
        called: `${proj.totalLean} ${pre.total} (model ${proj.modelTotal})`,
        actual: `${pts} points`,
        verdict: pts === pre.total ? "push" : (pts > pre.total) === (proj.totalLean === "over") ? "right" : "wrong",
      });
    }
  }
  if (pre?.spread && proj?.modelSide) {
    const favHome = pre.spread.team === H.abbr;
    const lineHome = favHome ? -pre.spread.line : pre.spread.line; // home margin the market expected
    const sideHome = proj.modelSide === H.abbr;
    const covered = homeMargin === lineHome ? "push" : (homeMargin > lineHome) === sideHome ? "right" : "wrong";
    const close = lockedClose(season, game.id);
    calls.push({
      label: "Against the spread",
      called: `${sideHome ? H.abbr : A.abbr} ${fmtLine(sideHome ? -lineHome : lineHome)}${close != null ? ` (line closed ${close >= 0 ? H.abbr : A.abbr} ${fmtLine(-Math.abs(close))})` : ""}`,
      actual: `${winner ? `${winner.short} by ${Math.abs(homeMargin)}` : "a tie"}`,
      verdict: covered,
    });
  }
  const pick: EdgePick | undefined = readLedger(season).picks[game.id];
  if (pick) {
    calls.push({
      label: "Opener edge (paper bet)",
      called: `${pick.pick}, locked ${new Date(pick.lockedAt).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })}${pick.clv != null ? `, line moved ${pick.clv > 0 ? "+" : ""}${pick.clv} our way` : ""}`,
      actual: pick.result ? `${pick.result}${pick.units != null ? ` (${pick.units > 0 ? "+" : ""}${pick.units} units)` : ""}` : "grading",
      verdict: pick.result === "win" ? "right" : pick.result === "loss" ? "wrong" : pick.result === "push" ? "push" : "no call",
    });
  }

  /* matchups */
  let board: BoardLock | undefined = pre?.board;
  let reconstructed = false;
  if (!board && game.division === "FBS") {
    const b = matchBoard(A.short, H.short);
    if (b) {
      reconstructed = true;
      board = {
        pressurePoint: b.pressurePoint,
        rows: b.rows.map((r) => ({
          key: r.key, title: r.title, offLabel: r.offLabel, defLabel: r.defLabel,
          away: { ...r.away, qb: r.away.qb ? { ...r.away.qb } : undefined },
          home: { ...r.home, qb: r.home.qb ? { ...r.home.qb } : undefined },
        })),
      };
    }
  }
  const teamOf = (school: string) => (school === H.short ? final.home : final.away);
  const matchups: RecapMatchup[] = [];
  for (const row of board?.rows ?? []) {
    for (const side of [row.away, row.home]) {
      const o = teamOf(side.offense);
      const d = teamOf(side.defense);
      const g = gradeRow(row.key, side, o, d, final);
      matchups.push({ key: row.key, title: row.title, offense: side.offense, defense: side.defense, called: calledText(side, row.offLabel, row.defLabel), actual: g.actual, winner: g.winner, verdict: verdictOf(side.edge, g.winner) });
    }
  }
  // The pressure point is the side with the largest gap (the same rule that wrote the sentence).
  const sides = (board?.rows ?? []).flatMap((r, ri) => [r.away, r.home].map((s, i) => ({ s, m: matchups[ri * 2 + i] })));
  const biggest = [...sides].sort((a, b) => Math.abs(b.s.gap ?? 0) - Math.abs(a.s.gap ?? 0))[0];
  const pressure = board ? { text: board.pressurePoint, verdict: biggest?.m?.verdict ?? ("no call" as CallVerdict) } : undefined;

  /* quarterbacks */
  const qbs: RecapQb[] = [];
  for (const row of board?.rows.filter((r) => r.key === "qb") ?? []) {
    for (const side of [row.away, row.home]) {
      const q = side.qb;
      if (!q) continue;
      const line = final.box.byPlayer.get(q.id)?.find((l) => l.category === "passing");
      if (!line) {
        qbs.push({ name: q.name, team: side.offense, type: q.type, rank: q.rank, of: q.of, line: "Did not throw a pass.", vsSeason: "", verdict: "did not play" });
        continue;
      }
      const [, a] = String(line.stats["C/ATT"] ?? "0/0").split("/").map(Number);
      const ypa = a ? Number(line.stats.YDS ?? 0) / a : 0;
      const diff = ypa - q.season.ypa;
      qbs.push({
        name: q.name, team: side.offense, type: q.type, rank: q.rank, of: q.of, line: line.headline,
        vsSeason: `${r1(ypa)} yards a throw against his ${r1(q.season.ypa)} season average`,
        verdict: diff >= 1 ? "above his average" : diff <= -1 ? "below his average" : "about his average",
      });
    }
  }

  /* radar names */
  const players: RecapPlayer[] = (pre?.prospects ?? []).map((p) => {
    const g = gradeProspect(p, final.box);
    return { name: p.name, team: p.team, pos: p.pos, line: g.line, verdict: g.verdict };
  });

  /* turning points */
  const swings: RecapSwing[] = final.swings.slice(0, 3).map((s: Swing) => {
    const homeGained = s.homeAfter > s.homeBefore;
    const t = homeGained ? H : A;
    const before = Math.round((homeGained ? s.homeBefore : 1 - s.homeBefore) * 100);
    const after = Math.round((homeGained ? s.homeAfter : 1 - s.homeAfter) * 100);
    return { when: `Q${s.period} ${s.clock}`, text: s.text.replace(/^\(\d+:\d+\)\s*/, ""), team: t.short, before, after };
  });

  /* headline and scorecard */
  const graded = [...calls.filter((c) => c.label !== "Margin"), ...matchups];
  const score = { right: graded.filter((c) => c.verdict === "right").length, wrong: graded.filter((c) => c.verdict === "wrong").length, mixed: graded.filter((c) => c.verdict === "mixed").length };
  const w = calls.find((c) => c.label === "Winner");
  const m = calls.find((c) => c.label === "Margin");
  const headline = [
    winner ? `${winner.short} won ${Math.max(hs, as)} to ${Math.min(hs, as)}.` : `Tied ${hs} to ${as}.`,
    w && m ? `We had ${m.called}: ${w.verdict === "right" ? "right winner" : "wrong winner"}, ${m.actual.split(", ").pop()}.` : "",
    `${score.right} of ${score.right + score.wrong + score.mixed} calls right${score.mixed ? ` (${score.mixed} mixed)` : ""}.`,
  ].filter(Boolean).join(" ");

  return { headline, score, calls, pressure, matchups, qbs, players, swings, teams: { away: final.away, home: final.home }, reconstructed, lockedAt: pre?.capturedAt };
}
