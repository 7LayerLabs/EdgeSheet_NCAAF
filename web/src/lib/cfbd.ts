/**
 * CollegeFootballData client. Server-only. Every call goes through the Next
 * fetch cache with a revalidate window that matches how often the data moves.
 * Free tier covers: games, lines, media, teams, venues, records, calendar.
 * Paid tier only (not used): scoreboard (live clock and score), games/weather.
 */

const BASE = "https://api.collegefootballdata.com";

export const hasCfbdKey = () => Boolean(process.env.CFBD_API_KEY);

async function cfbd<T>(path: string, revalidate: number): Promise<T> {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    next: { revalidate },
  });
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
