/**
 * Builds the slate from live sources (CollegeFootballData + National Weather
 * Service + the curated prospect file). Falls back to the hand-written sample
 * slate when CFBD_API_KEY is missing so the prototype still runs.
 *
 * Every field that the UI shows is either (a) a fact from a source with an
 * as-of time, (b) a rule-based derivation from those facts, or (c) explicitly
 * labeled as unavailable. Nothing here invents a player, a scheme, or a line.
 */
import {
  CLASSIFICATIONS,
  getCalendar,
  getGameById as cfbdGameById,
  getGames,
  getLines,
  getMedia,
  getRecords,
  getTeams,
  getVenues,
  hasCfbdKey,
  type CfbdGame,
  type CfbdLineRow,
  type CfbdMedia,
  type CfbdRecord,
  type CfbdTeam,
  type CfbdVenue,
  type CfbdWeek,
  type Classification,
} from "./cfbd";
import { forecastAtKickoff, forecastMany } from "./nws";
import { prospectFileLoaded, prospectRowById, prospectsForTeam } from "./prospects";
import { evaluateWeather } from "./weather";
import { games as sampleGames, getGame as sampleGame, getPlayer as samplePlayer, SLATE_DATE } from "./data";
import type { Coverage, Division, Game, Market, Prospect, ScoreComponents, Team, WeatherInput } from "./types";

const ET = "America/New_York";

export function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return etDate(d);
}

export interface SlateDay {
  date: string;
  count: number;
}

export interface Slate {
  source: "live" | "sample";
  season: number;
  week?: CfbdWeek;
  date: string;
  days: SlateDay[];
  games: Game[];
  /** Every game in the week, all days. Used by the watchlist. */
  weekGames: Game[];
  notes: string[];
}

/* ------------------------------------------------------------------ week */

function seasonFor(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m <= 2 ? y - 1 : y;
}

function pickWeek(cal: CfbdWeek[], date: string): CfbdWeek | undefined {
  const t = new Date(`${date}T12:00:00-04:00`).getTime();
  const sorted = [...cal].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const hit = sorted.find((w) => new Date(w.startDate).getTime() <= t && t < new Date(w.endDate).getTime());
  if (hit) return hit;
  if (!sorted.length) return undefined;
  return t < new Date(sorted[0].startDate).getTime() ? sorted[0] : sorted[sorted.length - 1];
}

/* ------------------------------------------------------------ raw bundle */

interface Bundle {
  season: number;
  week: CfbdWeek;
  games: CfbdGame[];
  lines: Map<number, CfbdLineRow>;
  media: Map<number, CfbdMedia[]>;
  teams: Map<string, CfbdTeam>;
  venues: Map<number, CfbdVenue>;
  records: Map<string, CfbdRecord>;
}

async function loadWeek(season: number, week: CfbdWeek, gamesOverride?: CfbdGame[]): Promise<Bundle> {
  const st = week.seasonType;
  const [gameLists, lines, media, teams, venues, records] = await Promise.all([
    gamesOverride ? Promise.resolve([gamesOverride]) : Promise.all(CLASSIFICATIONS.map((c) => getGames(season, week.week, st, c))),
    getLines(season, week.week, st).catch(() => [] as CfbdLineRow[]),
    getMedia(season, week.week, st).catch(() => [] as CfbdMedia[]),
    getTeams(season),
    getVenues(),
    getRecords(season).catch(() => [] as CfbdRecord[]),
  ]);
  const games = gameLists.flat().filter((g) => !g.startTimeTBD || true);
  const mediaMap = new Map<number, CfbdMedia[]>();
  for (const m of media) mediaMap.set(m.id, [...(mediaMap.get(m.id) ?? []), m]);
  return {
    season,
    week,
    games,
    lines: new Map(lines.map((l) => [l.id, l])),
    media: mediaMap,
    teams: new Map(teams.map((t) => [t.school, t])),
    venues: new Map(venues.map((v) => [v.id, v])),
    records: new Map(records.map((r) => [r.team, r])),
  };
}

/* --------------------------------------------------------------- helpers */

const DIVISION: Record<Classification, Division> = { fbs: "FBS", fcs: "FCS", ii: "DII", iii: "DIII" };

const NATIONAL_TV = /^(ABC|CBS|FOX|NBC|ESPN|ESPN2|ESPNU|FS1|FS2|CBSSN|CBS Sports Network|BTN|Big Ten Network|SEC Network|ACC Network|CW|The CW|NBC|Peacock|TNT|truTV)$/i;

function median(nums: number[]): number | undefined {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return undefined;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Books quote in half points; a median of two books can land on .25. Round to the nearest half. */
const half = (n: number) => Math.round(n * 2) / 2;

function abbrevFallback(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map((w) => w[0]).join("").slice(0, 4).toUpperCase();
}

function mkTeam(name: string, id: number, conf: string | null, b: Bundle): Team {
  const t = b.teams.get(name);
  const r = b.records.get(name);
  const rec = r ? `${r.total.wins}-${r.total.losses}${r.total.ties ? `-${r.total.ties}` : ""}` : "";
  return {
    id: String(id),
    name: t?.mascot ? `${t.school} ${t.mascot}` : name,
    short: name,
    abbr: t?.abbreviation ?? abbrevFallback(name),
    record: rec,
    conference: conf ?? t?.conference ?? "",
    color: t?.color ?? "#8b95a0",
    logo: t?.logos?.[1] ?? t?.logos?.[0] ?? undefined,
  };
}

function mkMarket(row: CfbdLineRow | undefined, home: Team, away: Team, asOf: string): Market {
  const rows = row?.lines.filter((l) => l.spread != null) ?? [];
  if (!rows.length) return { asOf };
  const homeSpread = half(median(rows.map((l) => l.spread as number))!);
  const homeOpenRaw = median(rows.map((l) => l.spreadOpen).filter((n): n is number => n != null));
  const homeOpen = homeOpenRaw === undefined ? undefined : half(homeOpenRaw);
  const favHome = homeSpread <= 0;
  const team = favHome ? home.abbr : away.abbr;
  const line = favHome ? homeSpread : -homeSpread;
  const open = homeOpen === undefined ? line : favHome ? homeOpen : -homeOpen;
  const totalRaw = median(rows.map((l) => l.overUnder).filter((n): n is number => n != null));
  const totalOpenRaw = median(rows.map((l) => l.overUnderOpen).filter((n): n is number => n != null));
  const total = totalRaw === undefined ? undefined : half(totalRaw);
  const totalOpen = totalOpenRaw === undefined ? undefined : half(totalOpenRaw);
  // Moneylines are not averaged across books (a median of -102 and +120 is meaningless). Take one book's pair.
  const mlRow = rows.find((l) => l.homeMoneyline != null && l.awayMoneyline != null);
  return {
    spread: { team, line, open },
    total: total !== undefined ? { line: total, open: totalOpen ?? total } : undefined,
    moneyline: mlRow ? { home: mlRow.homeMoneyline as number, away: mlRow.awayMoneyline as number } : undefined,
    books: rows.length,
    asOf,
  };
}

function mkNetwork(media: CfbdMedia[] | undefined): string {
  if (!media?.length) return "No listed broadcast";
  const tv = media.find((m) => m.mediaType === "tv");
  const web = media.find((m) => m.mediaType === "web");
  return (tv ?? web ?? media[0]).outlet;
}

function toProspect(row: ReturnType<typeof prospectsForTeam>[number], abbr: string): Prospect {
  return { ...row, team: abbr };
}

function winPct(t: Team): number | undefined {
  const m = t.record.match(/^(\d+)-(\d+)/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const l = Number(m[2]);
  return w + l ? w / (w + l) : undefined;
}

function gamesPlayed(t: Team): number {
  const m = t.record.match(/^(\d+)-(\d+)/);
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

/* ------------------------------------------------------- derived fields */

function deriveComponents(g: {
  prospects: Prospect[];
  market: Market;
  homeElo: number | null;
  awayElo: number | null;
  conferenceGame: boolean;
  neutralSite: boolean;
  notes: string | null;
  home: Team;
  away: Team;
  network: string;
  status: Game["status"];
}): ScoreComponents {
  // Draft talent: only once a prospect file exists. Otherwise excluded, not zero.
  let draftTalent: number | null = null;
  let futureTalent: number | null = null;
  if (prospectFileLoaded) {
    const pts = g.prospects.reduce((s, p) => {
      if (p.tier === "Established") return s + (/round 1\b/i.test(p.projected) ? 40 : 25);
      if (p.tier === "Emerging") return s + 12;
      return s;
    }, 0);
    draftTalent = Math.min(100, pts);
    const fut = g.prospects.reduce((s, p) => s + (p.tier === "Future" ? 25 : p.tier === "Sleeper" ? 15 : p.tier === "Watch only" ? 8 : 0), 0);
    futureTalent = Math.min(100, fut);
  }

  // Competitive expectation: spread first, rating gap second.
  let competitive: number;
  if (g.market.spread) {
    competitive = Math.max(5, Math.round(100 - Math.abs(g.market.spread.line) * 4.2));
  } else if (g.homeElo != null && g.awayElo != null) {
    competitive = Math.max(5, Math.round(100 - Math.abs(g.homeElo - g.awayElo) / 5));
  } else {
    competitive = 50;
  }

  // Storylines: what the schedule itself tells us.
  let storylines = 20;
  if (g.conferenceGame) storylines += 30;
  if (g.neutralSite) storylines += 15;
  const hp = winPct(g.home);
  const ap = winPct(g.away);
  if (hp !== undefined && ap !== undefined && gamesPlayed(g.home) >= 3 && gamesPlayed(g.away) >= 3) {
    if (hp === 1 && ap === 1) storylines += 30;
    else if (hp >= 0.75 && ap >= 0.75) storylines += 15;
  }
  if (g.notes) storylines += 10;
  storylines = Math.min(100, storylines);

  // Availability: can you actually watch it right now.
  let availability = NATIONAL_TV.test(g.network) ? 100 : g.network === "No listed broadcast" ? 35 : 70;
  if (g.status === "final") availability = 30;

  return {
    draftTalent,
    directMatchups: null, // needs charted matchups
    futureTalent,
    competitive,
    styleContrast: null, // needs play-by-play tendencies
    storylines,
    availability,
  };
}

function deriveWhyWatch(g: {
  prospects: Prospect[];
  market: Market;
  weather?: WeatherInput;
  home: Team;
  away: Team;
  conferenceGame: boolean;
  homeElo: number | null;
  awayElo: number | null;
  division: Division;
}): { headline: string; reasons: string[] } {
  const r: string[] = [];
  const likely = g.prospects.filter((p) => p.tier === "Established" || p.tier === "Emerging");
  if (likely.length) {
    const names = likely.slice(0, 3).map((p) => `${p.name} (${p.team} ${p.pos})`).join(", ");
    r.push(`${likely.length} draft-eligible ${likely.length === 1 ? "name" : "names"} on file: ${names}.`);
  }
  const s = g.market.spread;
  if (s) {
    const a = Math.abs(s.line);
    if (a <= 3) r.push(`The market calls it a toss-up: ${s.team} ${s.line}.`);
    else if (a <= 7.5) r.push(`One-score game by the market: ${s.team} ${s.line}.`);
    const move = s.line - s.open;
    if (Math.abs(move) >= 2.5) r.push(`The line moved ${move > 0 ? "toward the underdog" : "toward the favorite"} this week, from ${s.open} to ${s.line}.`);
  }
  const t = g.market.total;
  if (t) {
    if (t.line >= 62) r.push(`Total of ${t.line}. The market expects points.`);
    else if (t.line <= 42) r.push(`Total of ${t.line}. The market expects a field-position grind.`);
  }
  if (g.weather) {
    const top = evaluateWeather(g.weather).find((f) => f.level === "elevated") ?? evaluateWeather(g.weather).find((f) => f.level === "flag");
    if (top) r.push(`${top.title}. ${top.effect}`);
  }
  const hp = winPct(g.home);
  const ap = winPct(g.away);
  if (hp === 1 && ap === 1 && gamesPlayed(g.home) >= 3 && gamesPlayed(g.away) >= 3) {
    r.push(`Both teams are undefeated: ${g.away.short} ${g.away.record} at ${g.home.short} ${g.home.record}.`);
  } else if (g.conferenceGame && g.home.conference) {
    r.push(`${g.home.conference} conference game.`);
  }
  if (!s && g.homeElo != null && g.awayElo != null && Math.abs(g.homeElo - g.awayElo) >= 250) {
    const dog = g.homeElo < g.awayElo ? g.home.short : g.away.short;
    r.push(`Big rating gap and no line. Late snaps for ${dog}'s younger players are the scouting value.`);
  }
  if (!r.length) {
    r.push(
      g.division === "DII" || g.division === "DIII"
        ? "Schedule and score only for this division. No projections on file; watch it for the football."
        : "No line, no projections on file, and no charting yet. Schedule-level coverage only.",
    );
  }
  const reasons = r.slice(0, 3);
  return { headline: reasons[0], reasons };
}

/* ------------------------------------------------------------ build one */

async function buildGame(raw: CfbdGame, b: Bundle, withWeather: boolean): Promise<Game> {
  const cls = raw.homeClassification ?? raw.awayClassification ?? "fbs";
  const division = DIVISION[cls] ?? "FBS";
  const home = mkTeam(raw.homeTeam, raw.homeId, raw.homeConference, b);
  const away = mkTeam(raw.awayTeam, raw.awayId, raw.awayConference, b);
  const now = Date.now();
  const started = new Date(raw.startDate).getTime() <= now;
  const status: Game["status"] = raw.completed ? "final" : started ? "live" : "upcoming";
  const hasScore = raw.homePoints != null && raw.awayPoints != null;
  const score = hasScore
    ? { home: raw.homePoints as number, away: raw.awayPoints as number, clock: raw.completed ? "Final" : "in progress" }
    : status === "live"
      ? { home: NaN, away: NaN, clock: "in progress" }
      : undefined;

  const builtAt = new Date().toISOString();
  const market = mkMarket(b.lines.get(raw.id), home, away, builtAt);
  const network = mkNetwork(b.media.get(raw.id));
  const venue = raw.venueId != null ? b.venues.get(raw.venueId) : undefined;

  let weather: WeatherInput | undefined;
  if (withWeather && status !== "final" && venue?.latitude != null && venue?.longitude != null) {
    weather = await forecastAtKickoff(
      {
        latitude: venue.latitude,
        longitude: venue.longitude,
        dome: venue.dome,
        grass: venue.grass,
        elevationMeters: venue.elevation != null ? Number(venue.elevation) : null,
      },
      raw.startDate,
    );
  }

  const prospects = [
    ...prospectsForTeam(raw.awayTeam).map((p) => toProspect(p, away.abbr)),
    ...prospectsForTeam(raw.homeTeam).map((p) => toProspect(p, home.abbr)),
  ];

  const ctx = {
    prospects,
    market,
    weather,
    home,
    away,
    conferenceGame: raw.conferenceGame,
    neutralSite: raw.neutralSite,
    notes: raw.notes,
    homeElo: raw.homePregameElo,
    awayElo: raw.awayPregameElo,
    network,
    status,
    division,
  };
  const why = deriveWhyWatch(ctx);
  const scoreComponents = deriveComponents(ctx);

  const coverage: Coverage = cls === "fbs" || cls === "fcs" ? "Standard" : "Limited";
  const gaps: string[] = [];
  if (status !== "final") gaps.push("Live score and clock are not on the current data plan. Status is schedule-based.");
  gaps.push("Team tendencies are not charted yet. Scheme labels and the style score are excluded.");
  if (!prospectFileLoaded) gaps.push("No prospect file loaded. Draft talent and future talent are excluded from the score.");
  else if (!prospects.length) gaps.push("No evaluator we track lists a player from either team.");
  if (!market.spread) gaps.push("No book we track lists this game.");
  if (!weather && status !== "final") gaps.push(venue?.latitude == null ? "No forecast: venue coordinates are missing." : "No forecast: kickoff is outside the 7-day hourly window or the weather service did not answer.");
  if (cls === "ii" || cls === "iii") gaps.push("Lower-division coverage is schedule and score only.");

  const unavailable = { label: "Unavailable", sample: "unavailable" as const };
  return {
    id: String(raw.id),
    division,
    home,
    away,
    kickoff: raw.startDate,
    venue: raw.venue ?? "Venue TBA",
    city: venue ? [venue.city, venue.state].filter(Boolean).join(", ") : "",
    network,
    status,
    score,
    coverage,
    whyWatch: why.headline,
    whyWatchReasons: why.reasons,
    styleLine: undefined,
    weather,
    market,
    prospects,
    matchups: [],
    keepAnEyeOn: [],
    storylines: [
      ...(raw.notes ? [raw.notes] : []),
      ...(raw.conferenceGame && home.conference ? [`${home.conference} conference game.`] : []),
      ...(raw.neutralSite ? ["Neutral site."] : []),
    ],
    offense: { [home.abbr]: { ...unavailable, passRate: 0, neutralPassRate: 0, secondsPerPlay: 0, structure: "", runGame: "", passGame: "", successRate: 0, explosiveRate: 0, pressureAllowed: 0 }, [away.abbr]: { ...unavailable, passRate: 0, neutralPassRate: 0, secondsPerPlay: 0, structure: "", runGame: "", passGame: "", successRate: 0, explosiveRate: 0, pressureAllowed: 0 } },
    defense: { [home.abbr]: { ...unavailable, front: "", coverage: "", blitzRate: 0, pressureRate: 0, stuffRate: 0, explosivesAllowed: 0 }, [away.abbr]: { ...unavailable, front: "", coverage: "", blitzRate: 0, pressureRate: 0, stuffRate: 0, explosivesAllowed: 0 } },
    pressurePoint: "Not charted. Tendency metrics need play-by-play ingestion (build plan weeks 7 to 8). The report does not guess a scheme.",
    scoreComponents,
    gaps,
    reportAsOf: builtAt,
    source: "live",
    week: raw.week,
  };
}

/* ------------------------------------------------------------- public */

function sampleSlate(): Slate {
  return {
    source: "sample",
    season: 2026,
    date: SLATE_DATE,
    days: [{ date: SLATE_DATE, count: sampleGames.length }],
    games: sampleGames,
    weekGames: sampleGames,
    notes: ["CFBD_API_KEY is not set. Showing the hand-written sample slate."],
  };
}

export async function getSlate(dateParam?: string): Promise<Slate> {
  if (!hasCfbdKey()) return sampleSlate();
  const today = etDate();
  const requested = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  const season = seasonFor(requested);
  const cal = await getCalendar(season);
  const week = pickWeek(cal, requested);
  if (!week) return { ...sampleSlate(), source: "live", notes: ["No calendar for this season."], games: [], weekGames: [], days: [] };

  const b = await loadWeek(season, week);
  const dayCounts = new Map<string, number>();
  for (const g of b.games) {
    const d = etDate(new Date(g.startDate));
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const days = [...dayCounts].map(([date, count]) => ({ date, count })).sort((a, c) => a.date.localeCompare(c.date));

  let date = requested;
  if (!dayCounts.has(date)) {
    const next = days.find((d) => d.date >= requested);
    date = next?.date ?? days[days.length - 1]?.date ?? requested;
  }

  const todays = b.games.filter((g) => etDate(new Date(g.startDate)) === date);
  const others = b.games.filter((g) => etDate(new Date(g.startDate)) !== date);

  // Weather only for Division I games on the chosen day; it is two NWS calls per venue.
  const built: Game[] = new Array(todays.length);
  await forecastMany(
    todays.map((g, i) => ({ g, i })),
    8,
    async ({ g, i }) => {
      const cls = g.homeClassification ?? g.awayClassification;
      built[i] = await buildGame(g, b, cls === "fbs" || cls === "fcs");
    },
  );
  const rest = await Promise.all(others.map((g) => buildGame(g, b, false)));

  const notes: string[] = [];
  notes.push("NAIA schedules are not in CollegeFootballData. That division is missing until a second source is wired.");
  if (!prospectFileLoaded) notes.push("Prospect file is empty, so no game shows draft names yet.");

  return { source: "live", season, week, date, days, games: built, weekGames: [...built, ...rest], notes };
}

export async function getGame(id: string): Promise<Game | undefined> {
  if (!hasCfbdKey()) return sampleGame(id);
  if (!/^\d+$/.test(id)) return undefined;
  const rows = await cfbdGameById(id).catch(() => [] as CfbdGame[]);
  const raw = rows[0];
  if (!raw) return undefined;
  const cal = await getCalendar(raw.season);
  const week = cal.find((w) => w.week === raw.week && w.seasonType === raw.seasonType) ?? pickWeek(cal, etDate(new Date(raw.startDate)));
  if (!week) return undefined;
  const b = await loadWeek(raw.season, week, [raw]);
  return buildGame(raw, b, true);
}

export async function getPlayer(id: string): Promise<{ player: Prospect; game?: Game } | undefined> {
  if (!hasCfbdKey()) return samplePlayer(id);
  const row = prospectRowById(id);
  if (!row) return undefined;
  const slate = await getSlate();
  const game = slate.weekGames.find((g) => g.home.short === row.team || g.away.short === row.team);
  const abbr = game ? (game.home.short === row.team ? game.home.abbr : game.away.abbr) : abbrevFallback(row.team);
  return { player: toProspect(row, abbr), game };
}
