/**
 * Saturday plan: a 30-minute-block viewing plan for one day's Division I slate.
 *
 * Inputs are the app's own data: the day's games (Scout Score, network, status,
 * live overlay), the follows mirror (teams and players), the model leans, and the
 * per-player live logs for followed players in live games. The pick for each
 * block and the switch triggers are code rules over that data. Nothing here
 * invents a number; every figure in a sentence comes from a Game field.
 *
 * Game windows are assumed to run 3 hours 30 minutes from kickoff when the feed
 * does not say otherwise. Blocks before "now" use what is known now (a final
 * game was "on" during its window), so the past part of the plan is a record of
 * what the rules would have said, not a replay of live data.
 */
import type { Follows } from "./follows";
import { modelLeans, type Lean } from "./digests";
import { kickoffTime } from "./format";
import type { PlayerLog } from "./playerlog";
import { scoutScore } from "./score";
import { escapeHtml as h } from "./telegram";
import type { Game, GameStatus } from "./types";

/* ------------------------------------------------------------------ types */

export interface PlanPlayer {
  id: string;
  name: string;
  team: string; // school name
  pos: string;
  gameId?: string;
}

export interface PlanPick {
  gameId: string;
  label: string; // "No. 5 Texas at No. 12 Oklahoma"
  short: string; // "TEX-OU"
  network: string;
  score: number; // Scout Score
  status: GameStatus;
  why: string;
  /** Live line when the game is in progress: "TEX 21, OU 17, 4th 8:12". */
  liveLine?: string;
  rank: number; // block rank score, for the UI meter
}

export interface PlanBlock {
  start: string; // ISO
  end: string;
  label: string; // "3:30 PM"
  status: "past" | "now" | "upcoming";
  pick?: PlanPick;
  /** Up to two "flip to X if Y" lines, each about a different game. */
  triggers: string[];
  /** Other games on in this block, best first, for the UI. */
  others: { gameId: string; short: string; network: string; status: GameStatus }[];
}

export interface Plan {
  date: string;
  generatedAt: string;
  liveNow: boolean;
  blocks: PlanBlock[];
  followedTeams: string[];
  followedPlayers: PlanPlayer[];
  gamesConsidered: number;
  notes: string[];
}

/* -------------------------------------------------------------- constants */

const BLOCK_MS = 30 * 60_000;
const GAME_MS = 3.5 * 3600_000;
const ET = "America/New_York";

const isD1 = (g: Game) => g.division === "FBS" || g.division === "FCS";

const label = (g: Game) => {
  const t = (x: Game["home"]) => `${x.rank ? `No. ${x.rank} ` : ""}${x.short}`;
  return `${t(g.away)} at ${t(g.home)}`;
};
const short = (g: Game) => `${g.away.abbr}-${g.home.abbr}`;
const hasTv = (g: Game) => !!g.network && !/^(tba|n\/a|not available|none)$/i.test(g.network.trim());
const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : n === 5 ? "OT" : `${n - 4}OT`);

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
}

function floorToBlock(ms: number): number {
  return Math.floor(ms / BLOCK_MS) * BLOCK_MS;
}

/* -------------------------------------------------------------- scoring */

interface Ctx {
  follows: Follows;
  followedTeams: Set<string>;
  playersByGame: Map<string, PlanPlayer[]>;
  leans: Map<string, Lean[]>;
  logs: Record<string, PlayerLog>;
  now: number;
}

function liveLine(g: Game): string | undefined {
  if (g.status !== "live" || !g.score) return undefined;
  const clock = g.live ? `${ordinal(g.live.period)} ${g.live.clock}`.trim() : g.score.clock;
  return `${g.away.abbr} ${g.score.away}, ${g.home.abbr} ${g.score.home}, ${clock}`;
}

function withinOneScore(g: Game): boolean {
  return !!g.score && Math.abs(g.score.home - g.score.away) <= 8;
}

/** Red zone from the feed's own words: "2nd & 6 at UGA 14" with VAN in possession means VAN is inside the Georgia 20. */
function inRedZone(g: Game): boolean {
  const l = g.live;
  if (!l?.downDistance || !l.possession) return false;
  const m = l.downDistance.match(/at ([A-Z&'\-]+)\s?(\d+)$/);
  return !!m && m[1] !== l.possession && Number(m[2]) <= 20;
}

/** Followed players in this game who have a play in the current quarter, per the live log. */
function onTheField(g: Game, ctx: Ctx): { player: PlanPlayer; tag: string; when: string }[] {
  const out: { player: PlanPlayer; tag: string; when: string }[] = [];
  const period = g.live?.period ?? 0;
  for (const p of ctx.playersByGame.get(g.id) ?? []) {
    const log = ctx.logs[p.id];
    const last = log?.plays[log.plays.length - 1];
    if (!last || !period || last.quarter !== period) continue;
    out.push({ player: p, tag: last.tag, when: `${ordinal(last.quarter)} ${last.clock}` });
  }
  return out;
}

interface Scored {
  g: Game;
  rank: number;
  reasons: string[];
}

/** Rank one game for one block. Returns undefined when the game is not on during the block. */
function scoreFor(g: Game, blockStart: number, ctx: Ctx): Scored | undefined {
  const k = new Date(g.kickoff).getTime();
  const blockEnd = blockStart + BLOCK_MS;
  const isNow = ctx.now >= blockStart && ctx.now < blockEnd;
  // On during the block: kicked off before the block ends and not over by the block start.
  if (k >= blockEnd) return undefined;
  if (isNow || blockStart > ctx.now) {
    // Current or future block: a final game is over, an upcoming game is on only once it kicks.
    if (g.status === "final") return undefined;
    if (!isNow && g.status === "upcoming" && k + GAME_MS <= blockStart) return undefined;
    if (!isNow && g.status === "live" && k + GAME_MS + 3600_000 <= blockStart) return undefined; // long game guard
  } else if (k + GAME_MS <= blockStart) return undefined;

  const reasons: string[] = [];
  const ss = scoutScore(g.scoreComponents);
  let rank = ss;
  reasons.push(`Scout Score ${ss}`);

  const teams = [g.away, g.home].filter((t) => ctx.followedTeams.has(t.short.toLowerCase())).map((t) => t.short);
  if (teams.length) {
    rank += 25;
    reasons.unshift(`you follow ${teams.join(" and ")}`);
  }
  const players = ctx.playersByGame.get(g.id) ?? [];
  if (players.length) {
    rank += Math.min(2, players.length) * 10;
    reasons.push(`${players.slice(0, 2).map((p) => p.name).join(" and ")}${players.length > 2 ? ` and ${players.length - 2} more` : ""} on your list`);
  }
  for (const l of ctx.leans.get(g.id) ?? []) {
    rank += l.strength === "strong" ? 10 : 5;
    reasons.push(l.kind === "side" ? `model leans ${l.team} by ${l.gap.toFixed(1)} (not a pick)` : `model leans ${l.direction} by ${l.gap.toFixed(1)} (not a pick)`);
  }
  if (!hasTv(g)) {
    rank -= 15;
    reasons.push("no network listed");
  }

  // Phase of the game inside this block: the fourth quarter is worth more than the first.
  const elapsedMin = (blockStart + BLOCK_MS / 2 - k) / 60_000;
  const phase = elapsedMin < 0 ? 0.95 : elapsedMin < 60 ? 1 : elapsedMin < 120 ? 1.05 : elapsedMin < 180 ? 1.15 : 0.7;
  rank *= phase;

  // Live rules for the current block.
  if (isNow && g.status === "live" && g.live) {
    const l = g.live;
    if (l.closeness !== undefined) rank += l.closeness * 40;
    if (l.swing !== undefined) rank += Math.min(0.4, Math.abs(l.swing)) * 60;
    if (l.period >= 4 && withinOneScore(g)) {
      rank += 25;
      reasons.unshift(`fourth quarter, within one score (${g.score!.away}-${g.score!.home})`);
    } else if (l.homeWinProb !== undefined && l.closeness !== undefined && l.closeness >= 0.7) {
      reasons.unshift(`win prob ${Math.round(Math.max(l.homeWinProb, 1 - l.homeWinProb) * 100)}-${Math.round(Math.min(l.homeWinProb, 1 - l.homeWinProb) * 100)}`);
    }
    if (inRedZone(g)) rank += 8;
    const field = onTheField(g, ctx);
    if (field.length) {
      rank += 10;
      reasons.unshift(`${field[0].player.name} just had a play (${field[0].tag}, ${field[0].when})`);
    }
  }
  if (isNow && g.status === "upcoming") rank *= 0.85; // not kicked yet inside the current block
  return { g, rank: Math.round(rank), reasons };
}

/* -------------------------------------------------------------- triggers */

function triggerFor(s: Scored, blockStart: number, ctx: Ctx): string | undefined {
  const g = s.g;
  const name = short(g);
  const isNow = ctx.now >= blockStart && ctx.now < blockStart + BLOCK_MS;
  const players = ctx.playersByGame.get(g.id) ?? [];
  if (isNow && g.status === "live" && g.live && g.score) {
    const l = g.live;
    const field = onTheField(g, ctx);
    if (field.length) return `Flip to ${name} now: ${field[0].player.name} is on the field (last play ${field[0].tag}, ${field[0].when}).`;
    if (l.period >= 4 && withinOneScore(g)) return `Flip to ${name} now: fourth quarter, within one score, ${liveLine(g)}.`;
    if (l.closeness !== undefined && l.closeness >= 0.7 && l.homeWinProb !== undefined) {
      const hp = Math.round(l.homeWinProb * 100);
      return `Flip to ${name} now: win prob ${g.home.abbr} ${hp}, ${g.away.abbr} ${100 - hp}, ${liveLine(g)}.`;
    }
    if (inRedZone(g)) return `Flip to ${name} if this drive scores: ${l.possession} has it, ${l.downDistance}, ${liveLine(g)}.`;
    if (l.swing !== undefined && Math.abs(l.swing) >= 0.15) return `Flip to ${name} if the swing holds: win prob moved ${Math.round(Math.abs(l.swing) * 100)} points toward ${l.swing > 0 ? g.home.abbr : g.away.abbr} in the last ${l.swingMinutes ?? 15} minutes.`;
    if (withinOneScore(g)) return `Flip to ${name} for the fourth if it stays within one score, ${liveLine(g)}.`;
    return `Flip to ${name} if it gets back within one score, ${liveLine(g)}.`;
  }
  const k = new Date(g.kickoff).getTime();
  if (k >= blockStart && k < blockStart + BLOCK_MS) {
    const who = players.length ? ` for ${players[0].name}'s first drive` : "";
    return `Flip to ${name} at kickoff, ${kickoffTime(g.kickoff)} ET on ${hasTv(g) ? g.network : "no listed network"}${who}.`;
  }
  const lean = (ctx.leans.get(g.id) ?? []).find((l) => l.kind === "side");
  if (players.length) return `Flip to ${name} if ${players[0].name} gets a big play; his pings land in Telegram.`;
  if (lean && lean.kind === "side") return `Flip to ${name} if it is within one score in the fourth; the model leans ${lean.team} by ${lean.gap.toFixed(1)} (not a pick).`;
  const elapsed = (blockStart - k) / 60_000;
  if (elapsed >= 120) return `Flip to ${name} if it is within one score in the fourth.`;
  return `Flip to ${name} if it is within one score at the half.`;
}

/* --------------------------------------------------------------- builder */

export interface PlanInput {
  date: string;
  games: Game[];
  follows: Follows;
  /** Followed players resolved to name, team, position (from the roster digest). */
  players: PlanPlayer[];
  /** Live logs for followed players in live games, keyed by player id. Optional. */
  logs?: Record<string, PlayerLog>;
  now?: Date;
}

export function buildPlan(input: PlanInput): Plan {
  const now = (input.now ?? new Date()).getTime();
  const games = input.games.filter(isD1);
  const followedTeams = new Set(input.follows.teams.map((t) => t.toLowerCase()));
  const playersByGame = new Map<string, PlanPlayer[]>();
  const players: PlanPlayer[] = [];
  for (const p of input.players) {
    const g = games.find((x) => x.home.short === p.team || x.away.short === p.team);
    const row = { ...p, gameId: g?.id };
    players.push(row);
    if (g) playersByGame.set(g.id, [...(playersByGame.get(g.id) ?? []), row]);
  }
  const leans = new Map<string, Lean[]>();
  for (const l of modelLeans(games)) leans.set(l.game.id, [...(leans.get(l.game.id) ?? []), l]);
  const ctx: Ctx = { follows: input.follows, followedTeams, playersByGame, leans, logs: input.logs ?? {}, now };

  const notes: string[] = [];
  const blocks: PlanBlock[] = [];
  if (games.length) {
    const kicks = games.map((g) => new Date(g.kickoff).getTime());
    const first = floorToBlock(Math.min(...kicks));
    const last = floorToBlock(Math.max(...kicks) + GAME_MS);
    for (let t = first; t <= last; t += BLOCK_MS) {
      const scored = games.map((g) => scoreFor(g, t, ctx)).filter((s): s is Scored => !!s).sort((a, b) => b.rank - a.rank);
      const status: PlanBlock["status"] = now >= t && now < t + BLOCK_MS ? "now" : t + BLOCK_MS <= now ? "past" : "upcoming";
      const top = scored[0];
      const block: PlanBlock = { start: new Date(t).toISOString(), end: new Date(t + BLOCK_MS).toISOString(), label: timeLabel(t), status, triggers: [], others: [] };
      if (top) {
        const g = top.g;
        const why = `${top.reasons.slice(0, 3).join(", ")}.`;
        block.pick = { gameId: g.id, label: label(g), short: short(g), network: hasTv(g) ? g.network : "no network listed", score: scoutScore(g.scoreComponents), status: g.status, why: why[0].toUpperCase() + why.slice(1), liveLine: status === "now" ? liveLine(g) : undefined, rank: top.rank };
        const used = new Set<string>([g.id]);
        for (const s of scored.slice(1)) {
          if (block.triggers.length >= 2 || used.has(s.g.id)) continue;
          const tr = triggerFor(s, t, ctx);
          if (tr) {
            block.triggers.push(tr);
            used.add(s.g.id);
          }
        }
        block.others = scored.slice(1, 6).map((s) => ({ gameId: s.g.id, short: short(s.g), network: hasTv(s.g) ? s.g.network : "", status: s.g.status }));
      }
      blocks.push(block);
    }
  } else notes.push("No Division I games on this date.");

  notes.push("Each block picks the highest-ranked game on at that time: Scout Score, plus 25 for a followed team, 10 per followed player (up to two), 10 for a strong model lean and 5 for a moderate one, minus 15 with no network listed, scaled up in the fourth quarter. Live blocks add closeness, win probability swing, fourth-quarter one-score games, and followed players on the field.");
  notes.push("Game windows assume 3 hours 30 minutes from kickoff. Earlier blocks use what is known now, not a replay.");
  if (!input.follows.teams.length && !input.follows.players.length) notes.push("Nothing followed yet. Follow teams and players and the plan bends toward them.");

  return {
    date: input.date,
    generatedAt: new Date(now).toISOString(),
    liveNow: games.some((g) => g.status === "live"),
    blocks,
    followedTeams: input.follows.teams,
    followedPlayers: players,
    gamesConsidered: games.length,
    notes,
  };
}

/* ----------------------------------------------------------------- text */

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00-04:00`).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric" });
}

/** Telegram HTML. Past blocks are collapsed to one line; the current and upcoming blocks are listed. */
export function planText(plan: Plan, base: string): string {
  const lines: string[] = [];
  lines.push(`<b>Saturday plan, ${h(longDate(plan.date))}</b>${plan.liveNow ? " · live" : ""}`);
  lines.push(`${plan.gamesConsidered} Division I games. Following ${plan.followedTeams.length} teams, ${plan.followedPlayers.length} players.`);
  const past = plan.blocks.filter((b) => b.status === "past");
  const rest = plan.blocks.filter((b) => b.status !== "past");
  if (past.length) lines.push(`<i>${past.length} earlier ${past.length === 1 ? "block" : "blocks"} on the site.</i>`);
  if (!rest.length && plan.blocks.length) lines.push("Every window is over. Tomorrow's plan builds when the slate does.");
  for (const b of rest) {
    lines.push("");
    if (!b.pick) {
      lines.push(`<b>${h(b.label)}</b> · nothing on`);
      continue;
    }
    lines.push(`<b>${h(b.label)}</b>${b.status === "now" ? " (now)" : ""} · <a href="${base}/game/${b.pick.gameId}">${h(b.pick.label)}</a> · ${h(b.pick.network)}`);
    lines.push(`   ${h(b.pick.liveLine ? `${b.pick.liveLine}. ${b.pick.why}` : b.pick.why)}`);
    for (const t of b.triggers) lines.push(`   Switch: ${h(t)}`);
  }
  lines.push("");
  lines.push(`<a href="${base}/plan?date=${plan.date}">Open the plan</a>`);
  return lines.join("\n");
}
