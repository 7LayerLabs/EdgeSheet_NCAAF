/**
 * NFL Draft forecast for the next class. Supply comes from the scouting radar
 * (production, pedigree, usage, size). Demand comes from the last five drafts:
 * how many players at each position go in round one, the top 100, and overall.
 * The forecast matches supply to demand and assigns a range, never a pick.
 *
 * It is a model, not a scouting consensus, and every page that shows it says so.
 */
import { genDraft, genMeta } from "./generated";
import { memoSync } from "./memo";
import { radarIndex, type PosGroup, type RadarPlayer } from "./radar";

export type Band = "Round 1 range" | "Day 2 range" | "Day 3 range" | "Priority free agent";

export interface ForecastEntry {
  player: RadarPlayer;
  overall: number; // 1..N on the forecast board
  posRank: number;
  band: Band;
  adjusted: number; // score after position-demand adjustment
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

export function forecastNextDraft(): Forecast {
  const idx = radarIndex();
  const meta = genMeta();
  return memoSync(`forecast:${meta?.ingestedAt ?? "none"}`, 3600, () => {
    const demand = demandByGroup();
    const years = [...new Set(genDraft().map((p) => p.year))].sort();
    const dmap = new Map(demand.map((d) => [d.group, d]));

    // Supply: draft-eligible radar players for the next class, Division I only.
    const pool = idx.all.filter((p) => p.draftClass === idx.nextDraft && (p.classification === "fbs" || p.classification === "fcs") && (p.tier === "Eligible" || p.tier === "Sleeper"));

    // Position-demand adjustment: premium positions get a bump, discounted ones a haircut, capped at +-8.
    const adjusted = pool.map((p) => {
      const d = dmap.get(p.group);
      const bump = d ? Math.max(-8, Math.min(8, (d.premium - 1) * 12)) : 0;
      return { p, adj: p.score + bump };
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
      }));
      byGroup.set(group, entries);
    }

    // Overall board: band first, then adjusted score.
    const rank: Record<Band, number> = { "Round 1 range": 0, "Day 2 range": 1, "Day 3 range": 2, "Priority free agent": 3 };
    const board = [...byGroup.values()].flat().sort((a, b) => rank[a.band] - rank[b.band] || b.adjusted - a.adjusted);
    board.forEach((e, i) => (e.overall = i + 1));
    return { draftYear: idx.nextDraft, years, board, byGroup, demand };
  });
}

/** Quick lookup for cards: the band for one player, if forecast. */
export function bandFor(id: string): Band | undefined {
  const f = forecastNextDraft();
  return f.board.find((e) => e.player.id === id)?.band;
}
