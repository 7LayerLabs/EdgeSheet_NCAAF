/** Types for odds-core.mjs (shared by the app and scripts/odds-snapshot.mjs). */

export const SPORT: string;
export const BASE: string;
export const SLATE_MARKETS: string;
export const PROP_MARKETS: string;
export const REGIONS: string;
export const PROP_LABELS: Record<string, string>;
export const BOOK_SHORT: Record<string, string>;
export function bookShort(key: string, title?: string): string;

export interface TeamLike {
  school: string;
  mascot: string | null;
  abbreviation?: string | null;
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

export interface OddsMarket {
  key: string;
  last_update?: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsBookmaker[];
}

export interface GameRef {
  id: string;
  home: string;
  away: string;
  kickoff: string;
}

export interface Match {
  event: OddsEvent;
  swapped: boolean;
  score: number;
}

export interface BookLine {
  book: string;
  title: string;
  updated: string | null;
  /** Home spread, negative = home favored. */
  spread?: number;
  spreadPrice?: number;
  awaySpreadPrice?: number;
  total?: number;
  overPrice?: number;
  underPrice?: number;
  mlHome?: number;
  mlAway?: number;
}

export interface Consensus {
  spread?: number;
  total?: number;
  mlHome?: number;
  mlAway?: number;
  books: number;
}

export interface Snapshot {
  at: string;
  perBook: BookLine[];
  consensus: Consensus;
}

export interface PropRow {
  book: string;
  market: string;
  player: string;
  point?: number;
  overPrice?: number;
  underPrice?: number;
  yesPrice?: number;
  noPrice?: number;
}

export interface OddsFile {
  gameId: string;
  season: number;
  home: string;
  away: string;
  kickoff: string;
  eventId?: string;
  eventHome?: string;
  eventAway?: string;
  swapped?: boolean;
  lastChecked?: string;
  snapshots: Snapshot[];
  props?: { at: string; rows: PropRow[] };
}

export interface LinePoint {
  at: string;
  spread?: number;
  total?: number;
  mlHome?: number;
  mlAway?: number;
  books: number;
  hoursBeforeKick?: number;
}

export interface Usage {
  calls: number;
  lastCall?: string;
  lastCost?: number;
  remaining?: number;
  used?: number;
}

export function normalizeName(s: string | null | undefined): string;
export function teamScore(team: TeamLike, bookName: string): number;
export function matchEvents(games: GameRef[], events: OddsEvent[], teamsBySchool: Map<string, TeamLike>): Map<string, Match>;
export function parseEvent(ev: OddsEvent, swapped?: boolean): BookLine[];
export function parseProps(ev: OddsEvent): PropRow[];
export function median(nums: (number | undefined)[]): number | undefined;
export function consensusOf(perBook: BookLine[]): Consensus;
export function spreadLabel(homeSpread: number | undefined, homeAbbr: string, awayAbbr: string): string;
export function movementText(snapshots: Snapshot[], homeAbbr: string, awayAbbr: string): string;

export function oddsDir(root: string): string;
export function oddsFilePath(root: string, season: number, gameId: string): string;
export function readOddsFile(root: string, season: number, gameId: string): OddsFile | undefined;
export function writeOddsFile(root: string, file: OddsFile): void;
export function listOddsFiles(root: string, season?: number): OddsFile[];
export function appendSnapshot(
  root: string,
  args: { season: number; gameId: string; home: string; away: string; kickoff: string; event: OddsEvent; swapped: boolean; at?: string },
): { file: OddsFile; appended: boolean };
export function storeProps(root: string, file: OddsFile, event: OddsEvent, at?: string): OddsFile;
export function closingOf(file: OddsFile | undefined, kickoffIso?: string): LinePoint | undefined;
export function openingOf(file: OddsFile | undefined): LinePoint | undefined;

export function readUsage(root: string): Usage;
export function recordUsage(root: string, headers: Headers | undefined, cost: number): Usage;

export class OddsApiError extends Error {
  status: number;
}
export function fetchSlateOdds(root: string, key: string, window?: { from?: string; to?: string }): Promise<OddsEvent[]>;
export function fetchEventProps(root: string, key: string, eventId: string, markets?: string): Promise<OddsEvent>;
export function fetchEventList(key: string): Promise<OddsEvent[]>;
export function isoWindow(now?: Date): { from: string; to: string };
