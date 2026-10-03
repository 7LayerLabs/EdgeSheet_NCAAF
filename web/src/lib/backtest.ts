/**
 * Reads data/backtest/results.json, written by scripts/backtest.mjs. Server only (node:fs).
 * Missing file is not an error: the Track record page says the backtest has not been run.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

const FILE = path.join(process.cwd(), "data", "backtest", "results.json");
const WEIGHTS = path.join(process.cwd(), "data", "weights.json");

export type BlendForm = "additive" | "weighted";

export interface GridRow {
  form: BlendForm;
  eloWeight: number;
  edgeDivisor: number;
  net: "live" | "raw";
  games: number;
  winnerRate: number | null;
  winnerRight: number;
  winnerGraded: number;
  mae: number | null;
  rmse: number | null;
  coverRate: number | null;
  coverRight: number;
  coverGraded: number;
  lean2CoverRate: number | null;
  lean2Graded: number;
  lean4CoverRate: number | null;
  lean4Graded: number;
}

export interface MarketRow extends GridRow {
  favoriteCoverRate: number | null;
  favoriteGraded: number;
}

export interface TotalGrade {
  avgPpg: number;
  bias: number | null;
  graded: number;
  leans: number;
  leanRate: number | null;
  leanRight: number;
  overLeans: number;
  overRate: number | null;
  underLeans: number;
  underRate: number | null;
  modelMae: number | null;
  marketMae: number | null;
  pushes: number;
}

export interface ProjectionGrade {
  season?: number;
  seasons?: number[];
  mode: "full" | "walk";
  counts: { fbsCompleted: number; graded: number; noElo: number; notCharted: number; noClosingLine: number };
  market: MarketRow;
  grid: GridRow[];
  total: TotalGrade;
  totalOld: TotalGrade;
  calibration: { bucket: string; games: number; winRate: number | null }[];
}

export interface ProjectionSection {
  overall: ProjectionGrade;
  best: GridRow | null;
  bestWeighted?: GridRow | null;
  bestCover?: GridRow | null;
  live: { form: BlendForm; eloWeight: number; edgeDivisor: number };
  minWeek?: number;
  leaky?: boolean;
  perSeason: ProjectionGrade[];
}

export interface DraftAcc {
  drafted: number;
  onRadar: number;
  onRadarRate: number | null;
  inPool: number;
  inPoolRate: number | null;
  r1: number;
  r1Hit: number;
  r1HitRate: number | null;
  top100: number;
  top100Hit: number;
  top100HitRate: number | null;
  matchedById: number;
  matchedByName: number;
  rankCorrelation: number | null;
  correlationN: number;
}

export interface BandRow {
  band: string;
  entries: number;
  drafted: number;
  draftedRate: number | null;
  r1: number;
  top100: number;
}

export interface DraftGrade {
  season: number;
  draftYear: number;
  available: boolean;
  reason?: string;
  poolSize?: number;
  boardSize?: number;
  radarSize?: number;
  bands?: BandRow[];
  total?: DraftAcc;
  byGroup?: Record<string, DraftAcc>;
}

export interface DraftSection {
  overall: { draftYears: number[]; bands: BandRow[]; total: DraftAcc; byGroup: Record<string, DraftAcc> };
  perSeason: DraftGrade[];
}

export interface Corr {
  n: number;
  pearson: number | null;
  spearman: number | null;
}

export interface ExcitementGrade {
  season: number;
  games: number;
  competitive: Corr;
  styleContrast: Corr;
  proxy: Corr;
  byCompetitiveBucket: { label: string; games: number; avgExcitement: number | null }[];
}

export interface NflSummary {
  group: string;
  n: number;
  avgValuePerSeason: number | null;
  production: number | null;
  pedigree: number | null;
  usage: number | null;
  radarScore: number | null;
  realPick: number | null;
}

export interface NflSection {
  source: string;
  lastNflSeason: number;
  matched: number;
  ofRadarDraftees: number;
  valueMetric: string;
  overall: NflSummary;
  byGroup: NflSummary[];
  byDraftYear: (NflSummary & { draftYear: number })[];
  error?: string;
}

export interface BacktestResults {
  generatedAt: string;
  seasons: number[];
  skipped: { season: number; reason: string }[];
  drift: string[];
  notes: string[];
  walkForward: ProjectionSection | null;
  projection: ProjectionSection | null;
  excitement: { perSeason: ExcitementGrade[] } | null;
  draft: DraftSection | null;
  nfl: NflSection | null;
}

export interface Weights {
  projection?: { form?: BlendForm; eloWeight?: number; edgeDivisor?: number };
  projectionBestVsClosingLine?: { form?: BlendForm; eloWeight: number; edgeDivisor: number; lean4CoverRate: number | null; lean4Graded: number; mae: number | null } | null;
  projectionWeightedForm?: { form?: BlendForm; eloWeight: number; edgeDivisor: number; mae: number | null; winnerRate: number | null } | null;
  total?: { avgPpg: number; bias: number | null; biasAtOld: number | null };
  radar?: Record<string, number>;
  comment?: string;
  generatedAt?: string;
}

function stamp(f: string) {
  try {
    return String(statSync(f).mtimeMs);
  } catch {
    return "missing";
  }
}

function readJson<T>(f: string): T | undefined {
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export const backtestResults = (): BacktestResults | undefined => memoSync(`backtest:${stamp(FILE)}`, 300, () => readJson<BacktestResults>(FILE));
export const recommendedWeights = (): Weights | undefined => memoSync(`weights:${stamp(WEIGHTS)}`, 300, () => readJson<Weights>(WEIGHTS));
