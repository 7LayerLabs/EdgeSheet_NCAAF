/**
 * CollegeFootballData client. Server-only. Every call goes through the Next
 * fetch cache with a revalidate window that matches how often the data moves.
 * Free tier covers: games, lines, media, teams, venues, records, calendar.
 * Paid tier only (not used): scoreboard (live clock and score), games/weather.
 */

const BASE = "https://api.collegefootballdata.com";

export const hasCfbdKey = () => Boolean(process.env.CFBD_API_KEY);

/* ------------------------------------------------------------ quota guard */

/**
 * CFBD's free tier has a monthly call quota. When it is gone every call
 * answers 429 "Monthly call quota exceeded", and the Next fetch cache keeps
 * serving whatever it already holds. This guard remembers the exhaustion so
 * the app stops asking: cached paths still come back from the fetch cache
 * (a cache hit never reaches the network), but a path that already 429'd
 * while exhausted is not retried until the flag expires. The flag lasts six
 * hours or until the first of next month UTC, whichever comes first, so a
 * tier upgrade is noticed within six hours without a restart.
 *
 * Every raw CFBD fetch elsewhere (consensus.ts, boxscore.ts) calls
 * `noteCfbdResponse` so the flag is shared.
 */
const QUOTA_MESSAGE = /monthly call quota/i;
const QUOTA_HOLD_MS = 6 * 60 * 60 * 1000;

let quotaExhaustedUntil = 0;
let quotaSeenAt = 0;
/** Paths that already 429'd while exhausted; not retried until the flag lifts. */
const deadPaths = new Map<string, number>();
/** fetch() calls through the CFBD clients since the process started, by endpoint family. Next fetch-cache hits are included; the network count is at most this. */
const callCounts = new Map<string, number>();

export class CfbdQuotaError extends Error {
  constructor(path: string) {
    super(`CFBD monthly quota exhausted (${path}); resumes ${new Date(quotaExhaustedUntil).toISOString()}`);
    this.name = "CfbdQuotaError";
  }
}

function nextMonthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function markCfbdQuotaExhausted(now = Date.now()): void {
  quotaSeenAt = now;
  quotaExhaustedUntil = Math.min(now + QUOTA_HOLD_MS, nextMonthStartUtc(now));
}

/** True while the monthly quota is known to be gone. */
export function cfbdQuotaExhausted(now = Date.now()): boolean {
  if (quotaExhaustedUntil && now >= quotaExhaustedUntil) {
    quotaExhaustedUntil = 0;
    deadPaths.clear();
  }
  return quotaExhaustedUntil > now;
}

/** Short alias used by callers outside this file. */
export const cfbdExhausted = cfbdQuotaExhausted;

/** For the UI and the ops scripts. */
export function cfbdQuotaStatus(): { exhausted: boolean; until?: string; seenAt?: string; callsThisProcess: Record<string, number> } {
  const exhausted = cfbdQuotaExhausted();
  return {
    exhausted,
    until: exhausted ? new Date(quotaExhaustedUntil).toISOString() : undefined,
    seenAt: quotaSeenAt ? new Date(quotaSeenAt).toISOString() : undefined,
    callsThisProcess: Object.fromEntries(callCounts),
  };
}

/** Endpoint family for the call counter: "/games?year=..." -> "games". */
function family(path: string): string {
  return path.replace(/^\//, "").split("?")[0];
}

/**
 * Call this with every CFBD response from a raw fetch outside this file.
 * Returns true when the response was the monthly-quota 429 (and flags it).
 */
export async function noteCfbdResponse(path: string, res: Response): Promise<boolean> {
  callCounts.set(family(path), (callCounts.get(family(path)) ?? 0) + 1);
  if (res.status !== 429) return false;
  const body = await res
    .clone()
    .text()
    .catch(() => "");
  if (!QUOTA_MESSAGE.test(body)) return false;
  markCfbdQuotaExhausted();
  deadPaths.set(path, quotaExhaustedUntil);
  return true;
}

async function cfbd<T>(path: string, revalidate: number): Promise<T> {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set");
  if (cfbdQuotaExhausted() && (deadPaths.get(path) ?? 0) > Date.now()) throw new CfbdQuotaError(path);
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    next: { revalidate },
  });
  if (await noteCfbdResponse(path, res)) throw new CfbdQuotaError(path);
  if (!res.ok) throw new Error(`CFBD ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export type Classification = "fbs" | "fcs" | "ii" | "iii";
export const CLASSIFICATIONS: Classification[] = ["fbs", "fcs", "ii", "iii"];

export interface CfbdWeek {
  season: number;
  week: number;
  seasonType: "regular" | "postseason";
  startDate: string;
  endDate: string;
  firstGameStart: string;
  lastGameStart: string;
}

export interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  startTimeTBD: boolean;
  completed: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  venueId: number | null;
  venue: string | null;
  homeId: number;
  homeTeam: string;
  homeClassification: Classification | null;
  homeConference: string | null;
  homePoints: number | null;
  homePregameElo: number | null;
  awayId: number;
  awayTeam: string;
  awayClassification: Classification | null;
  awayConference: string | null;
  awayPoints: number | null;
  awayPregameElo: number | null;
  excitementIndex: number | null;
  notes: string | null;
}

export interface CfbdLineRow {
  id: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  lines: {
    provider: string;
    spread: number | null; // home spread: negative means home is favored
    formattedSpread: string | null;
    spreadOpen: number | null;
    overUnder: number | null;
    overUnderOpen: number | null;
    homeMoneyline: number | null;
    awayMoneyline: number | null;
  }[];
}

export interface CfbdMedia {
  id: number;
  mediaType: "tv" | "web" | "radio" | "ppv" | "mobile";
  outlet: string;
}

export interface CfbdTeam {
  id: number;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  conference: string | null;
  classification: Classification | null;
  color: string | null;
  alternateColor: string | null;
  logos: string[] | null;
}

export interface CfbdVenue {
  id: number;
  name: string;
  grass: boolean | null;
  dome: boolean | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: string | null; // meters, as a string
  timezone: string | null;
}

export interface CfbdRecord {
  teamId: number;
  team: string;
  total: { games: number; wins: number; losses: number; ties: number };
}

export interface CfbdRankingWeek {
  season: number;
  week: number;
  seasonType: string;
  polls: { poll: string; ranks: { rank: number; teamId: number | null; school: string; conference: string | null; firstPlaceVotes: number | null; points: number | null }[] }[];
}

const HOUR = 3600;
const DAY = 86400;

export const getCalendar = (year: number) => cfbd<CfbdWeek[]>(`/calendar?year=${year}`, DAY);

export const getGames = (year: number, week: number, seasonType: string, cls: Classification) =>
  cfbd<CfbdGame[]>(`/games?year=${year}&week=${week}&seasonType=${seasonType}&classification=${cls}`, 300);

export const getGameById = (id: string) => cfbd<CfbdGame[]>(`/games?id=${encodeURIComponent(id)}`, 300);

export const getLines = (year: number, week: number, seasonType: string) =>
  cfbd<CfbdLineRow[]>(`/lines?year=${year}&week=${week}&seasonType=${seasonType}`, 600);

export const getMedia = (year: number, week: number, seasonType: string) =>
  cfbd<CfbdMedia[]>(`/games/media?year=${year}&week=${week}&seasonType=${seasonType}`, 6 * HOUR);

export const getTeams = (year: number) => cfbd<CfbdTeam[]>(`/teams?year=${year}`, DAY);

export const getVenues = () => cfbd<CfbdVenue[]>(`/venues`, 7 * DAY);

export const getRankings = (year: number, week: number, seasonType: string) =>
  cfbd<CfbdRankingWeek[]>(`/rankings?year=${year}&week=${week}&seasonType=${seasonType}`, 6 * HOUR);

export const getRecords = (year: number) => cfbd<CfbdRecord[]>(`/records?year=${year}`, 2 * HOUR);
