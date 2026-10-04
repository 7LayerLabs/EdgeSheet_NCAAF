/**
 * ESPN scoreboard as a schedule source, shaped like CollegeFootballData.
 *
 * Used only when the CFBD monthly quota is exhausted (src/lib/cfbd.ts flags
 * it). ESPN's public scoreboard (no key) for groups 80 (FBS) and 81 (FCS),
 * one call per day per group, carries everything loadWeek() needs for the
 * slate: schedule, kickoff, venue, broadcast, team records, poll ranks
 * (curatedRank), one book's spread and total, logos and colors. Game ids
 * and team ids are the same ids CFBD uses, so archive, odds, and ESPN live
 * joins keep working.
 *
 * What ESPN does not carry, and the slate says so when it runs on this path:
 * pregame Elo (projection loses its Elo leg), excitement index, venue
 * coordinates and surface (no weather), opening lines (only one book's
 * current number), and conference names for most FCS teams.
 *
 * Nothing here is invented. Every field maps from a response field or is null.
 */
import type { CfbdGame, CfbdLineRow, CfbdMedia, CfbdRankingWeek, CfbdRecord, CfbdTeam, CfbdVenue, CfbdWeek, Classification } from "./cfbd";
import { memo } from "./memo";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const GROUPS: Record<"fbs" | "fcs", number> = { fbs: 80, fcs: 81 };
const ET = "America/New_York";

/** ESPN conference ids for FBS. Long-standing ESPN constants; FCS ids are left unnamed rather than guessed. */
const CONFERENCE_NAMES: Record<string, string> = {
  "1": "ACC",
  "4": "Big 12",
  "5": "Big Ten",
  "8": "SEC",
  "9": "Pac-12",
  "12": "Conference USA",
  "15": "Mid-American",
  "17": "Mountain West",
  "18": "FBS Independents",
  "37": "Sun Belt",
  "151": "American Athletic",
};

/* ------------------------------------------------------------- raw shapes */

interface RawTeam {
  id: string;
  location?: string;
  name?: string;
  displayName?: string;
  abbreviation?: string;
  color?: string;
  alternateColor?: string;
  logo?: string;
  conferenceId?: string;
}

interface RawCompetitor {
  id: string;
  homeAway: "home" | "away";
  score?: string;
  team: RawTeam;
  curatedRank?: { current?: number };
  records?: { name?: string; type?: string; summary?: string }[];
}

interface RawOdds {
  provider?: { name?: string };
  details?: string;
  overUnder?: number;
  spread?: number;
  homeTeamOdds?: { favorite?: boolean; moneyLine?: number };
  awayTeamOdds?: { favorite?: boolean; moneyLine?: number };
}

interface RawEvent {
  id: string;
  date: string;
  season?: { year?: number; type?: number };
  week?: { number?: number };
  status?: { type?: { state?: "pre" | "in" | "post"; completed?: boolean } };
  competitions: {
    timeValid?: boolean;
    neutralSite?: boolean;
    conferenceCompetition?: boolean;
    venue?: { id?: string; fullName?: string; address?: { city?: string; state?: string }; indoor?: boolean };
    competitors: RawCompetitor[];
    broadcasts?: { names?: string[] }[];
    odds?: RawOdds[];
    notes?: { headline?: string }[];
    groups?: { name?: string; isConference?: boolean };
  }[];
}

interface RawScoreboard {
  events?: RawEvent[];
  leagues?: { calendar?: { label?: string; value?: string; entries?: { label?: string; value?: string; startDate?: string; endDate?: string }[] }[] }[];
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

const yyyymmdd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");

/* --------------------------------------------------------------- calendar */

/** The season calendar as CfbdWeek rows, from ESPN's league calendar. Memoized a day. */
export function espnCalendar(season: number): Promise<CfbdWeek[]> {
  return memo(`espn:cal:${season}`, 86400, async () => {
    const sb = await getJson<RawScoreboard>(`${BASE}/scoreboard?groups=80&limit=1&dates=${season}0901`);
    const out: CfbdWeek[] = [];
    for (const block of sb?.leagues?.[0]?.calendar ?? []) {
      const label = block.label ?? "";
      const seasonType: CfbdWeek["seasonType"] | undefined = /regular/i.test(label) ? "regular" : /post/i.test(label) ? "postseason" : undefined;
      if (!seasonType) continue;
      for (const e of block.entries ?? []) {
        const week = Number(e.value);
        if (!Number.isFinite(week) || !e.startDate || !e.endDate) continue;
        out.push({ season, week, seasonType, startDate: e.startDate, endDate: e.endDate, firstGameStart: e.startDate, lastGameStart: e.endDate });
      }
    }
    return out;
  });
}

/**
 * Last resort when neither CFBD nor ESPN can give a calendar: the 7-day
 * window around the requested date, Monday through Sunday ET, labeled with
 * a week number counted from the last Monday of August. Only the dates
 * matter to the slate; the number is cosmetic and says so in the note.
 */
export function derivedWeek(season: number, date: string): CfbdWeek {
  const noon = new Date(`${date}T12:00:00-04:00`);
  const dow = (noon.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(noon.getTime() - dow * 86400000);
  start.setUTCHours(11, 0, 0, 0); // 07:00 ET
  const end = new Date(start.getTime() + 7 * 86400000 - 1000);
  // Week 1 starts the last Monday of August.
  const aug31 = new Date(Date.UTC(season, 7, 31, 12));
  const lastMon = new Date(aug31.getTime() - ((aug31.getUTCDay() + 6) % 7) * 86400000);
  const week = Math.max(1, Math.floor((start.getTime() - lastMon.getTime()) / (7 * 86400000)) + 1);
  return { season, week, seasonType: "regular", startDate: start.toISOString(), endDate: end.toISOString(), firstGameStart: start.toISOString(), lastGameStart: end.toISOString() };
}

/* ------------------------------------------------------------------ week */

export interface EspnWeekBundle {
  source: "espn";
  week: CfbdWeek;
  games: CfbdGame[];
  lines: CfbdLineRow[];
  media: CfbdMedia[];
  teams: CfbdTeam[];
  venues: CfbdVenue[];
  records: CfbdRecord[];
  rankings: CfbdRankingWeek | undefined;
  /** Scoreboard days that did not answer. */
  missingDays: string[];
  fetchedAt: string;
}

/** Every FBS and FCS game in the week from ESPN, shaped like the CFBD bundle inputs. Memoized 5 minutes. */
export function espnWeek(season: number, week: CfbdWeek): Promise<EspnWeekBundle> {
  return memo(`espn:week:${season}:${week.seasonType}:${week.week}`, 300, () => buildWeek(season, week));
}

async function buildWeek(season: number, week: CfbdWeek): Promise<EspnWeekBundle> {
  // One scoreboard call per ET day per group. Days are fetched in order with the two groups side by side.
  const days: string[] = [];
  for (let t = new Date(week.startDate).getTime(); t < new Date(week.endDate).getTime(); t += 86400000) {
    const d = yyyymmdd(new Date(t));
    if (!days.includes(d)) days.push(d);
  }
  const events = new Map<string, { e: RawEvent; cls: Classification }>();
  const fbsTeamIds = new Set<string>();
  const missingDays: string[] = [];
  for (const d of days) {
    const [fbs, fcs] = await Promise.all([
      getJson<RawScoreboard>(`${BASE}/scoreboard?groups=${GROUPS.fbs}&limit=400&dates=${d}`),
      getJson<RawScoreboard>(`${BASE}/scoreboard?groups=${GROUPS.fcs}&limit=400&dates=${d}`),
    ]);
    if (!fbs && !fcs) missingDays.push(d);
    for (const e of fbs?.events ?? []) {
      for (const c of e.competitions[0]?.competitors ?? []) fbsTeamIds.add(c.team.id);
      events.set(e.id, { e, cls: "fbs" });
    }
    for (const e of fcs?.events ?? []) if (!events.has(e.id)) events.set(e.id, { e, cls: "fcs" });
  }

  const games: CfbdGame[] = [];
  const lines: CfbdLineRow[] = [];
  const media: CfbdMedia[] = [];
  const teams = new Map<string, CfbdTeam>();
  const venues = new Map<number, CfbdVenue>();
  const records = new Map<string, CfbdRecord>();
  const apRanks = new Map<string, { rank: number; teamId: number; school: string; conference: string | null }>();
  const fcsRanks = new Map<string, { rank: number; teamId: number; school: string; conference: string | null }>();

  for (const { e } of events.values()) {
    const comp = e.competitions[0];
    if (!comp) continue;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const id = Number(e.id);
    if (!Number.isFinite(id)) continue;
    const state = e.status?.type?.state ?? "pre";
    const clsOf = (c: RawCompetitor): Classification => (fbsTeamIds.has(c.team.id) ? "fbs" : "fcs");
    const confOf = (c: RawCompetitor): string | null => {
      const named = c.team.conferenceId ? CONFERENCE_NAMES[c.team.conferenceId] : undefined;
      if (named) return named;
      // A conference game names the shared conference on the competition itself.
      if (comp.conferenceCompetition && comp.groups?.isConference && comp.groups.name) return comp.groups.name;
      return null;
    };
    const school = (c: RawCompetitor) => c.team.location ?? c.team.displayName ?? c.team.abbreviation ?? c.team.id;
    const points = (c: RawCompetitor) => (state === "pre" ? null : c.score != null && c.score !== "" ? Number(c.score) : null);
    const venueId = comp.venue?.id ? Number(comp.venue.id) : null;

    games.push({
      id,
      season: e.season?.year ?? season,
      week: e.week?.number ?? week.week,
      seasonType: e.season?.type === 3 ? "postseason" : "regular",
      startDate: e.date,
      startTimeTBD: comp.timeValid === false,
      completed: Boolean(e.status?.type?.completed),
      neutralSite: Boolean(comp.neutralSite),
      conferenceGame: Boolean(comp.conferenceCompetition),
      venueId: Number.isFinite(venueId) ? venueId : null,
      venue: comp.venue?.fullName ?? null,
      homeId: Number(home.team.id),
      homeTeam: school(home),
      homeClassification: clsOf(home),
      homeConference: confOf(home),
      homePoints: points(home),
      homePregameElo: null,
      awayId: Number(away.team.id),
      awayTeam: school(away),
      awayClassification: clsOf(away),
      awayConference: confOf(away),
      awayPoints: points(away),
      awayPregameElo: null,
      excitementIndex: null,
      notes: comp.notes?.[0]?.headline ?? null,
    });

    const o = comp.odds?.[0];
    if (o && (o.spread != null || o.overUnder != null)) {
      // ESPN's spread is quoted from the home side; the favorite flag settles the sign when both are present.
      let spread: number | null = o.spread ?? null;
      if (spread != null && o.homeTeamOdds?.favorite !== undefined) spread = o.homeTeamOdds.favorite ? -Math.abs(spread) : Math.abs(spread);
      lines.push({
        id,
        week: e.week?.number ?? week.week,
        homeTeam: school(home),
        awayTeam: school(away),
        lines: [
          {
            provider: o.provider?.name ?? "ESPN",
            spread,
            formattedSpread: o.details ?? null,
            spreadOpen: null,
            overUnder: o.overUnder ?? null,
            overUnderOpen: null,
            homeMoneyline: o.homeTeamOdds?.moneyLine ?? null,
            awayMoneyline: o.awayTeamOdds?.moneyLine ?? null,
          },
        ],
      });
    }

    for (const b of comp.broadcasts ?? []) {
      for (const name of b.names ?? []) media.push({ id, mediaType: /\+$|peacock|paramount|max$/i.test(name) ? "web" : "tv", outlet: name });
    }

    if (venueId != null && Number.isFinite(venueId) && !venues.has(venueId)) {
      venues.set(venueId, {
        id: venueId,
        name: comp.venue?.fullName ?? "",
        grass: null,
        dome: comp.venue?.indoor ?? null,
        city: comp.venue?.address?.city ?? null,
        state: comp.venue?.address?.state ?? null,
        latitude: null,
        longitude: null,
        elevation: null,
        timezone: null,
      });
    }

    for (const c of [home, away]) {
      const name = school(c);
      if (!teams.has(name)) {
        teams.set(name, {
          id: Number(c.team.id),
          school: name,
          mascot: c.team.name ?? null,
          abbreviation: c.team.abbreviation ?? null,
          conference: confOf(c),
          classification: clsOf(c),
          color: c.team.color ? `#${c.team.color.replace(/^#/, "")}` : null,
          alternateColor: c.team.alternateColor ? `#${c.team.alternateColor.replace(/^#/, "")}` : null,
          logos: c.team.logo ? [c.team.logo] : null,
        });
      }
      const total = c.records?.find((r) => r.type === "total") ?? c.records?.[0];
      const m = total?.summary?.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
      if (m && !records.has(name)) {
        const wins = Number(m[1]);
        const losses = Number(m[2]);
        const ties = m[3] ? Number(m[3]) : 0;
        records.set(name, { teamId: Number(c.team.id), team: name, total: { games: wins + losses + ties, wins, losses, ties } });
      }
      const rank = c.curatedRank?.current;
      if (rank != null && rank >= 1 && rank <= 25) {
        const row = { rank, teamId: Number(c.team.id), school: name, conference: confOf(c) };
        (clsOf(c) === "fbs" ? apRanks : fcsRanks).set(name, row);
      }
    }
  }

  const polls: CfbdRankingWeek["polls"] = [];
  const toPoll = (poll: string, m: typeof apRanks) => {
    if (!m.size) return;
    polls.push({ poll, ranks: [...m.values()].sort((a, b) => a.rank - b.rank).map((r) => ({ ...r, firstPlaceVotes: null, points: null })) });
  };
  toPoll("AP Top 25", apRanks);
  toPoll("FCS Coaches Poll", fcsRanks);

  games.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return {
    source: "espn",
    week,
    games,
    lines,
    media,
    teams: [...teams.values()],
    venues: [...venues.values()],
    records: [...records.values()],
    rankings: polls.length ? { season, week: week.week, seasonType: week.seasonType, polls } : undefined,
    missingDays,
    fetchedAt: new Date().toISOString(),
  };
}

/** One sentence for the slate's "What this slate cannot say" list. */
export function espnFallbackNote(b: EspnWeekBundle): string {
  const missing = b.missingDays.length ? ` ESPN did not answer for ${b.missingDays.length} day(s) of the week.` : "";
  return `CollegeFootballData's monthly quota is used up, so this slate is built from ESPN's scoreboard: schedule, scores, records, poll ranks, one book's line, and broadcasts are real; pregame Elo, excitement index, opening lines, venue coordinates (weather), and most FCS conference names are not available until the quota resets.${missing}`;
}
