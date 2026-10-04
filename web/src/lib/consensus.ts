/**
 * Consensus of outside projection systems, shown next to the EdgeSheet model.
 * The ratings come from CollegeFootballData (SP+, FPI, SRS, Elo, and CFBD's
 * own pregame win probability). None of them are ours. The EdgeSheet model
 * is passed in and listed as one more system so the reader can see where it
 * sits in the crowd. Server-only: fetches with a 6 hour cache plus an
 * in-process memo so a slate build touches each endpoint once.
 */
import { memo } from "./memo";
import { noteCfbdResponse } from "./cfbd";
import type { Market, Team } from "./types";
import type { Projection } from "./projection";

const BASE = "https://api.collegefootballdata.com";
const SIX_HOURS = 6 * 3600;
const HOME_PTS = 2.5; // home field in points for rating-difference systems
const HOME_ELO = 65; // same as projection.ts
const ELO_PER_POINT = 28; // same as projection.ts
const SIGMA = 16; // same as projection.ts
const ON_NUMBER = 0.5; // a projection inside half a point of the line sits on the number

export type SystemKey = "sp" | "fpi" | "srs" | "elo" | "cfbdwp" | "model";

export interface SystemLine {
  key: SystemKey;
  system: string; // display name
  source: string; // where the number comes from
  ours: boolean; // the EdgeSheet model row
  available: boolean;
  margin?: number; // projected home margin, positive = home favored
  winProb?: number; // 0..1 for the favorite
  favorite?: string; // abbr
  note?: string; // why unavailable, or the inputs used
}

export interface Consensus {
  systems: SystemLine[];
  available: number; // systems with a margin
  median?: number; // median home margin across available systems
  favorite?: string; // abbr the median favors
  winProb?: number; // for the median favorite, sigma 16 normal
  marketMargin?: number; // home margin implied by the posted spread
  /** Against the number: which side most systems lean to, and how many. */
  side?: string; // abbr
  sideCount?: number;
  onNumber?: number; // systems within half a point of the posted line, counted on neither side
  modelAgrees?: boolean; // the EdgeSheet model leans the same side as the majority
  summary: string;
  asOf: string;
}

/* ------------------------------------------------------------ math */

function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const winProbFromMargin = (m: number) => 0.5 * (1 + erf(Math.abs(m) / (SIGMA * Math.SQRT2)));

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------ fetchers */

interface SpRow { team: string; rating: number; ranking: number | null }
interface FpiRow { team: string; fpi: number }
interface SrsRow { team: string; rating: number; ranking: number | null }
interface EloRow { team: string; elo: number }
interface WpRow { gameId: number; homeTeam: string; awayTeam: string; spread: number | null; homeWinProbability: number | null }

async function cfbd<T>(path: string): Promise<T> {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    next: { revalidate: SIX_HOURS },
  });
  // Shares the monthly-quota flag with src/lib/cfbd.ts so the whole app backs off together.
  if (await noteCfbdResponse(path, res)) throw new Error(`CFBD ${path} -> 429 monthly quota exhausted`);
  if (!res.ok) throw new Error(`CFBD ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/** One memoized map per system per season. A failed fetch resolves to undefined so one bad endpoint does not sink the rest. */
function ratingMap<T extends { team: string }>(key: string, path: string, value: (row: T) => number | null | undefined): Promise<Map<string, number> | undefined> {
  return memo(`consensus:${key}`, SIX_HOURS, async () => {
    try {
      const rows = await cfbd<T[]>(path);
      const m = new Map<string, number>();
      for (const r of rows) {
        const v = value(r);
        if (typeof v === "number" && Number.isFinite(v)) m.set(r.team, v);
      }
      return m;
    } catch {
      return undefined;
    }
  });
}

export const spRatings = (year: number) => ratingMap<SpRow>(`sp:${year}`, `/ratings/sp?year=${year}`, (r) => r.rating);
export const fpiRatings = (year: number) => ratingMap<FpiRow>(`fpi:${year}`, `/ratings/fpi?year=${year}`, (r) => r.fpi);
export const srsRatings = (year: number) => ratingMap<SrsRow>(`srs:${year}`, `/ratings/srs?year=${year}`, (r) => r.rating);
export const eloRatings = (year: number) => ratingMap<EloRow>(`elo:${year}`, `/ratings/elo?year=${year}`, (r) => r.elo);

/** CFBD's own pregame win probability and spread for a week, keyed by game id. */
export function pregameWp(year: number, week: number, seasonType = "regular"): Promise<Map<number, WpRow> | undefined> {
  return memo(`consensus:wp:${year}:${seasonType}:${week}`, SIX_HOURS, async () => {
    try {
      const rows = await cfbd<WpRow[]>(`/metrics/wp/pregame?year=${year}&week=${week}&seasonType=${seasonType}`);
      return new Map(rows.map((r) => [r.gameId, r]));
    } catch {
      return undefined;
    }
  });
}

/* ------------------------------------------------------------ build */

export interface ConsensusInput {
  gameId: string;
  season: number;
  week: number;
  seasonType?: string;
  home: Team;
  away: Team;
  homeSchool: string;
  awaySchool: string;
  neutral: boolean;
  /** Pregame Elo from the games row, when CFBD has it. Falls back to the season Elo table. */
  homeElo?: number | null;
  awayElo?: number | null;
  market: Market;
  projection?: Projection;
}

/** Market margin, home positive, from the posted spread. */
export function marketHomeMargin(market: Market, homeAbbr: string): number | undefined {
  if (!market.spread) return undefined;
  return market.spread.team === homeAbbr ? -market.spread.line : market.spread.line;
}

export async function buildConsensus(i: ConsensusInput): Promise<Consensus> {
  // Sequential on purpose: four small calls, each memoized for 6 hours, so a slate build fires them once.
  const sp = await spRatings(i.season);
  const fpi = await fpiRatings(i.season);
  const srs = await srsRatings(i.season);
  const eloTable = i.homeElo != null && i.awayElo != null ? undefined : await eloRatings(i.season);
  const wp = await pregameWp(i.season, i.week, i.seasonType ?? "regular");

  const hf = i.neutral ? 0 : HOME_PTS;
  const favOf = (m: number) => (m >= 0 ? i.home.abbr : i.away.abbr);
  const line = (key: SystemKey, system: string, source: string, ours: boolean, margin: number | undefined, winProb: number | undefined, note: string | undefined, unavailable?: string): SystemLine =>
    margin === undefined || !Number.isFinite(margin)
      ? { key, system, source, ours, available: false, note: unavailable ?? note }
      : { key, system, source, ours, available: true, margin: r1(margin), winProb: winProb ?? winProbFromMargin(margin), favorite: favOf(margin), note };

  const diffSystem = (key: SystemKey, system: string, source: string, table: Map<string, number> | undefined, tableName: string): SystemLine => {
    if (!table) return line(key, system, source, false, undefined, undefined, undefined, `${tableName} not available from CFBD right now.`);
    const h = table.get(i.homeSchool);
    const a = table.get(i.awaySchool);
    if (h === undefined || a === undefined) {
      const missing = [h === undefined ? i.home.abbr : null, a === undefined ? i.away.abbr : null].filter(Boolean).join(" and ");
      return line(key, system, source, false, undefined, undefined, undefined, `No ${tableName} rating for ${missing}.`);
    }
    return line(key, system, source, false, h - a + hf, undefined, `${i.home.abbr} ${r1(h)}, ${i.away.abbr} ${r1(a)}${hf ? `, +${hf} home` : ", neutral"}`);
  };

  const systems: SystemLine[] = [];
  systems.push(diffSystem("sp", "SP+", "Bill Connelly, via CFBD", sp, "SP+"));
  systems.push(diffSystem("fpi", "FPI", "ESPN, via CFBD", fpi, "FPI"));
  systems.push(diffSystem("srs", "SRS", "Simple Rating System, via CFBD", srs, "SRS"));

  // Elo: pregame values from the games row when present, otherwise the season table.
  {
    const h = i.homeElo ?? eloTable?.get(i.homeSchool);
    const a = i.awayElo ?? eloTable?.get(i.awaySchool);
    if (h != null && a != null) {
      const m = (h + (i.neutral ? 0 : HOME_ELO) - a) / ELO_PER_POINT;
      systems.push(line("elo", "Elo", "CFBD Elo", false, m, undefined, `${i.home.abbr} ${h}, ${i.away.abbr} ${a}${i.neutral ? ", neutral" : `, +${HOME_ELO} home`}`));
    } else systems.push(line("elo", "Elo", "CFBD Elo", false, undefined, undefined, undefined, "No Elo rating for one side."));
  }

  // CFBD pregame win probability: their spread is a home spread (positive = home underdog).
  {
    const row = wp?.get(Number(i.gameId));
    if (row && row.spread != null) {
      const m = -row.spread;
      const p = row.homeWinProbability != null ? (m >= 0 ? row.homeWinProbability : 1 - row.homeWinProbability) : undefined;
      systems.push(line("cfbdwp", "CFBD pregame", "CFBD win probability model", false, m, p, `home spread ${row.spread}, home win prob ${row.homeWinProbability != null ? Math.round(row.homeWinProbability * 100) + "%" : "n/a"}`));
    } else systems.push(line("cfbdwp", "CFBD pregame", "CFBD win probability model", false, undefined, undefined, undefined, wp ? "CFBD has not posted a pregame number for this game." : "CFBD pregame win probability not available right now."));
  }

  // Our model, home positive.
  if (i.projection) {
    const m = i.projection.winner === i.home.abbr ? i.projection.margin : -i.projection.margin;
    systems.push(line("model", "EdgeSheet model", "Elo and unit edges, this site", true, m, i.projection.winProb, `confidence ${i.projection.confidence}`));
  } else systems.push(line("model", "EdgeSheet model", "Elo and unit edges, this site", true, undefined, undefined, undefined, "No projection for this game."));

  const avail = systems.filter((s) => s.available);
  const med = median(avail.map((s) => s.margin!));
  const marketMargin = marketHomeMargin(i.market, i.home.abbr);

  let side: string | undefined;
  let sideCount: number | undefined;
  let onNumber: number | undefined;
  let modelAgrees: boolean | undefined;
  if (marketMargin !== undefined && avail.length) {
    // Inside half a point of the line is "on the number" and counts for neither side.
    const homeLean = avail.filter((s) => s.margin! - marketMargin >= ON_NUMBER);
    const awayLean = avail.filter((s) => s.margin! - marketMargin <= -ON_NUMBER);
    onNumber = avail.length - homeLean.length - awayLean.length;
    if (homeLean.length || awayLean.length) {
      const majority = homeLean.length >= awayLean.length ? homeLean : awayLean;
      side = majority === homeLean ? i.home.abbr : i.away.abbr;
      sideCount = majority.length;
      const ours = avail.find((s) => s.ours);
      if (ours) modelAgrees = majority.includes(ours) ? true : homeLean.includes(ours) || awayLean.includes(ours) ? false : undefined;
    }
  }

  const teamOf = (abbr: string) => (abbr === i.home.abbr ? i.home.short : i.away.short);
  let summary: string;
  if (!avail.length) summary = "No outside projection system has a number for this game.";
  else if (marketMargin !== undefined && side && sideCount !== undefined) {
    const tail = modelAgrees === true ? " The EdgeSheet model is one of them." : modelAgrees === false ? " The EdgeSheet model is on the other side." : avail.some((s) => s.ours) ? " The EdgeSheet model sits on the number." : "";
    const even = onNumber ? `, ${onNumber} sit${onNumber === 1 ? "s" : ""} on the number` : "";
    summary = sideCount === avail.length
      ? `All ${avail.length} systems lean ${teamOf(side)} against the number.${tail}`
      : `${sideCount} of ${avail.length} systems lean ${teamOf(side)} against the number${even}.${tail}`;
  } else if (marketMargin !== undefined && onNumber === avail.length) {
    summary = `Every available system sits on the posted number.`;
  } else {
    const fav = med !== undefined ? favOf(med) : undefined;
    const n = fav ? avail.filter((s) => s.favorite === fav).length : 0;
    summary = fav ? `No posted spread. ${n} of ${avail.length} systems have ${teamOf(fav)} winning; median margin ${Math.abs(med!).toFixed(1)}.` : "No posted spread.";
  }

  return {
    systems,
    available: avail.length,
    median: med !== undefined ? r1(med) : undefined,
    favorite: med !== undefined ? favOf(med) : undefined,
    winProb: med !== undefined ? winProbFromMargin(med) : undefined,
    marketMargin,
    side,
    sideCount,
    onNumber,
    modelAgrees,
    summary,
    asOf: new Date().toISOString(),
  };
}
