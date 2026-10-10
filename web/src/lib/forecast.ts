/**
 * NFL Draft forecast for the next class.
 *
 * Since October 2026 the order comes from the draft model (src/lib/draft-model-core.mjs, fitted by
 * scripts/draft-fit.mjs into data/draft-model.json): production this season blended with last season,
 * national recruiting rank and rating, size against the position, team strength (Elo), conference,
 * usage, and class, each weighted per position from where 2022 to 2025 players actually went in the
 * 2023 to 2026 drafts. Graded on drafts it never saw, it put 43% of real first-rounders in its Round 1
 * range (the old method: 18%) and 47% of real top-100 picks in its top 100 (old: 22%).
 *
 * The model orders each position; the last five drafts set each position's share of round one, the
 * top 100, and the draft, so the board has a real draft's position mix. The question
 * it answers is "where does he go if he declares"; juniors marked returning drop off the board.
 * Without data/draft-model.json it falls back to the old method below.
 *
 * It is a model, not a scouting consensus, and every page that shows it says so.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { genDraft, genMeta, genPlayers, type GenPlayer } from "./generated";
import { blendProduction, features, groupOf, predict, productionPercentiles, type SizeTable } from "./draft-model-core.mjs";
import { teamElo } from "./elo";
import { memoSync } from "./memo";
import { radarIndex, type PosGroup, type RadarPlayer } from "./radar";
import { readDeclarations, type Decision } from "./declarations";

export type Band = "Round 1 range" | "Day 2 range" | "Day 3 range" | "Priority free agent";

export interface ForecastEntry {
  player: RadarPlayer;
  overall: number; // 1..N on the forecast board
  posRank: number;
  band: Band;
  adjusted: number; // score after position-demand adjustment
  decision: Decision; // juniors: declared / returning / undecided; seniors: undecided means eligible
  estPick: number; // point estimate of the pick, from the board position
  estLow: number;
  estHigh: number;
}

export interface Demand {
  group: PosGroup;
  perDraft: number; // average picks per draft
  r1: number; // average round-one picks per draft
  top100: number;
  premium: number; // r1 share / overall share; >1 means teams pay up early for this position
}

const GROUP_OF: Record<string, PosGroup> = {
  Quarterback: "QB", "Running Back": "RB", "Wide Receiver": "WR", "Tight End": "TE",
  "Offensive Tackle": "OL", "Offensive Guard": "OL", Center: "OL",
  "Defensive Edge": "EDGE", "Defensive End": "EDGE", "Defensive Tackle": "DL", Linebacker: "LB",
  Cornerback: "CB", Safety: "S", "Place Kicker": "ST", Punter: "ST", "Long Snapper": "ST",
};

export function demandByGroup(): Demand[] {
  return memoSync("forecast:demand", 3600, () => {
    const picks = genDraft();
    const years = new Set(picks.map((p) => p.year));
    const n = Math.max(1, years.size);
    const totals = new Map<PosGroup, { all: number; r1: number; top100: number }>();
    for (const p of picks) {
      const g = GROUP_OF[p.pos] ?? null;
      if (!g || g === "ST") continue;
      const e = totals.get(g) ?? totals.set(g, { all: 0, r1: 0, top100: 0 }).get(g)!;
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
  });
}

export interface Forecast {
  draftYear: number;
  years: number[]; // drafts used for demand
  board: ForecastEntry[]; // overall order
  byGroup: Map<PosGroup, ForecastEntry[]>;
  demand: Demand[];
}

interface DraftModel { weights: Record<string, number>; size: SizeTable; seasons: number[]; validation?: unknown }

const MODEL_FILE = path.join(process.cwd(), "data", "draft-model.json");

function loadModel(): DraftModel | undefined {
  if (!existsSync(MODEL_FILE)) return undefined;
  return memoSync(`draftmodel:${statSync(MODEL_FILE).mtimeMs}`, 3600, () => {
    try {
      return JSON.parse(readFileSync(MODEL_FILE, "utf8")) as DraftModel;
    } catch {
      return undefined;
    }
  });
}

/** Last season's production percentiles by player id (data/backtest/<season - 1>/players.json). */
function priorPercentiles(season: number): Map<string, number> {
  const f = path.join(process.cwd(), "data", "backtest", String(season - 1), "players.json");
  if (!existsSync(f)) return new Map();
  return memoSync(`draft:prior:${season}:${statSync(f).mtimeMs}`, 86400, () => {
    try {
      return productionPercentiles(JSON.parse(readFileSync(f, "utf8")) as GenPlayer[]);
    } catch {
      return new Map();
    }
  });
}

const SPREAD: Record<Band, number> = { "Round 1 range": 6, "Day 2 range": 15, "Day 3 range": 40, "Priority free agent": 60 };

export function forecastNextDraft(): Forecast {
  const model = loadModel();
  if (!model) return legacyForecast();
  const idx = radarIndex();
  const meta = genMeta();
  const decl = readDeclarations();
  const declStamp = Object.keys(decl).length + ":" + Object.values(decl).map((d) => d.at).sort().pop();
  return memoSync(`forecast:model:${meta?.ingestedAt ?? "none"}:${declStamp}:${statSync(MODEL_FILE).mtimeMs}`, 3600, () => {
    const demand = demandByGroup();
    const years = [...new Set(genDraft().map((p) => p.year))].sort();
    const season = meta?.season ?? idx.nextDraft - 1;
    const players = new Map(genPlayers().map((p) => [p.id, p]));
    const cur = productionPercentiles(genPlayers());
    const prior = priorPercentiles(season);

    // Every Division I radar player in the next class, minus juniors who said they are returning.
    const pool = idx.all.filter(
      (p) => p.draftClass === idx.nextDraft && (p.classification === "fbs" || p.classification === "fcs") && (decl[p.id]?.decision ?? "undecided") !== "returning",
    );
    const scored = pool
      .map((r) => {
        const gp = players.get(r.id);
        const g = gp ? groupOf(gp.p) : null;
        if (!gp || !g) return undefined;
        const prod = blendProduction(cur.get(r.id) ?? 0, prior.has(r.id) ? prior.get(r.id)! : null, gp.g);
        const v = predict(model.weights, features(gp, g, prod, model.size, teamElo(gp.t)));
        return { r, v };
      })
      .filter((x): x is { r: RadarPlayer; v: number } => Boolean(x))
      .sort((a, b) => b.v - a.v);

    // The model orders players inside each position; the last five drafts set how many from each
    // position land in round one, the top 100, and the draft (the quota variant graded best: 43% of
    // real first-rounders in Round 1 range, 47% of real top-100 picks in the top 100).
    const dmap = new Map(demand.map((d) => [d.group, d]));
    const top = scored[0]?.v ?? 1;
    const byGroup = new Map<PosGroup, ForecastEntry[]>();
    for (const x of scored) {
      const list = byGroup.get(x.r.group) ?? byGroup.set(x.r.group, []).get(x.r.group)!;
      const d = dmap.get(x.r.group);
      const i = list.length;
      const band: Band = !d ? "Priority free agent" : i < Math.round(d.r1) ? "Round 1 range" : i < Math.round(d.top100) ? "Day 2 range" : i < Math.round(d.perDraft) ? "Day 3 range" : "Priority free agent";
      list.push({
        player: x.r,
        overall: 0,
        posRank: i + 1,
        band,
        // Draft score: model value relative to the top player on the board (100).
        adjusted: Math.max(0, Math.round((x.v / Math.max(0.01, top)) * 100)),
        decision: decl[x.r.id]?.decision ?? "undecided",
        estPick: 0,
        estLow: 0,
        estHigh: 0,
      });
    }
    const rank: Record<Band, number> = { "Round 1 range": 0, "Day 2 range": 1, "Day 3 range": 2, "Priority free agent": 3 };
    const board = [...byGroup.values()].flat().sort((a, b) => rank[a.band] - rank[b.band] || b.adjusted - a.adjusted);
    board.forEach((e, i) => {
      e.overall = i + 1;
      e.estPick = Math.min(257, e.overall);
      e.estLow = Math.max(1, e.overall - SPREAD[e.band]);
      e.estHigh = Math.min(257, e.overall + SPREAD[e.band]);
    });
    return { draftYear: idx.nextDraft, years, board, byGroup, demand };
  });
}

/** The pre-October-2026 method: radar score plus demand and pedigree bumps, slotted by five-year position demand. */
function legacyForecast(): Forecast {
  const idx = radarIndex();
  const meta = genMeta();
  const decl = readDeclarations();
  const declStamp = Object.keys(decl).length + ":" + Object.values(decl).map((d) => d.at).sort().pop();
  return memoSync(`forecast:${meta?.ingestedAt ?? "none"}:${declStamp}`, 3600, () => {
    const demand = demandByGroup();
    const years = [...new Set(genDraft().map((p) => p.year))].sort();
    const dmap = new Map(demand.map((d) => [d.group, d]));

    // Supply: draft-eligible radar players for the next class, Division I only.
    // Juniors stay on the board until they say they are returning. Seniors marked returning (extra year) also drop.
    const pool = idx.all.filter(
      (p) =>
        p.draftClass === idx.nextDraft &&
        (p.classification === "fbs" || p.classification === "fcs") &&
        (p.tier === "Eligible" || p.tier === "Sleeper") &&
        (decl[p.id]?.decision ?? "undecided") !== "returning",
    );

    // Position-demand adjustment: premium positions get a bump, discounted ones a haircut, capped at +-8.
    const adjusted = pool.map((p) => {
      const d = dmap.get(p.group);
      const demandBump = d ? Math.max(-8, Math.min(8, (d.premium - 1) * 12)) : 0;
      // Pedigree bump: the league pays for a five-star with starter reps even in an average month of box scores.
      // Production still decides the order; this keeps a top-50 recruit who starts from falling off the board.
      const pedigreeBump = p.stars === 5 && p.usage >= 25 ? 12 : p.stars === 5 ? 6 : (p.recruitRank ?? 9999) <= 50 && p.usage >= 25 ? 6 : 0;
      return { p, adj: p.score + demandBump + pedigreeBump };
    });

    // Within each position, fill the five-year average number of slots: r1, then day 2 (top 100), then day 3 (all picks).
    const byGroup = new Map<PosGroup, ForecastEntry[]>();
    for (const [group, d] of dmap) {
      const list = adjusted.filter((x) => x.p.group === group).sort((a, b) => b.adj - a.adj);
      const r1 = Math.round(d.r1);
      const day2 = Math.round(d.top100);
      const all = Math.round(d.perDraft);
      const entries: ForecastEntry[] = list.map((x, i) => ({
        player: x.p,
        overall: 0,
        posRank: i + 1,
        band: i < r1 ? "Round 1 range" : i < day2 ? "Day 2 range" : i < all ? "Day 3 range" : "Priority free agent",
        adjusted: Math.round(x.adj),
        decision: decl[x.p.id]?.decision ?? "undecided",
        estPick: 0,
        estLow: 0,
        estHigh: 0,
      }));
      byGroup.set(group, entries);
    }

    // Overall board: band first, then adjusted score.
    const rank: Record<Band, number> = { "Round 1 range": 0, "Day 2 range": 1, "Day 3 range": 2, "Priority free agent": 3 };
    const board = [...byGroup.values()].flat().sort((a, b) => rank[a.band] - rank[b.band] || b.adjusted - a.adjusted);
    // Estimated pick: the board position is the point estimate; the spread widens down the board.
    // Round one +-6, day two +-15, day three +-40. Undrafted range stays open-ended.
    board.forEach((e, i) => {
      e.overall = i + 1;
      const spread = e.band === "Round 1 range" ? 6 : e.band === "Day 2 range" ? 15 : e.band === "Day 3 range" ? 40 : 60;
      e.estPick = Math.min(257, e.overall);
      e.estLow = Math.max(1, e.overall - spread);
      e.estHigh = Math.min(257, e.overall + spread);
    });
    return { draftYear: idx.nextDraft, years, board, byGroup, demand };
  });
}

/** Quick lookup for cards: the band for one player, if forecast. */
export function bandFor(id: string): Band | undefined {
  return entryFor(id)?.band;
}

export function entryFor(id: string): ForecastEntry | undefined {
  const f = forecastNextDraft();
  return f.board.find((e) => e.player.id === id);
}

export function pickText(e: ForecastEntry): string {
  if (e.band === "Priority free agent") return "Outside the 257";
  return `Est. pick ${e.estPick} (${e.estLow} to ${e.estHigh})`;
}
