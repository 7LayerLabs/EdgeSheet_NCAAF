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
  getRankings,
  getRecords,
  getTeams,
  getVenues,
  hasCfbdKey,
  type CfbdGame,
  type CfbdLineRow,
  type CfbdMedia,
  type CfbdRankingWeek,
  type CfbdRecord,
  type CfbdTeam,
  type CfbdVenue,
  type CfbdWeek,
  type Classification,
} from "./cfbd";
import { forecastAtKickoff, forecastMany } from "./nws";
import { prospectFileLoaded, prospectRowById, prospectsForTeam } from "./prospects";
import { generatedLoaded, genMeta } from "./generated";
import { radarForGame, radarForTeam, radarPlayer, type RadarPlayer } from "./radar";
import { leagueMeans, pressurePoint, styleContrast, styleFor, unitEdges } from "./tendencies";
import { gameCues, situationsFor } from "./situational";
import { bandFor } from "./forecast";
import { projectGame } from "./projection";
import { buildConsensus } from "./consensus";
import { boxScore } from "./boxscore";
import { memo } from "./memo";
import { slateTtlSeconds } from "./cache-policy";
import { cfbdQuotaExhausted, CfbdQuotaError } from "./cfbd";
import { derivedWeek, espnCalendar, espnFallbackNote, espnWeek, type EspnWeekBundle } from "./espn-schedule";
import { liveGame, liveSummary } from "./espn";
import { gradePostgame, lockPregame, readEntry } from "./archive";
import { gameOdds } from "./odds";
import { evaluateWeather } from "./weather";
import { arrivalNote, portalStorylines } from "./portal";
import { publishedGuide } from "./watchguide";
import { fieldBearing } from "./stadiums";
import { baseline as climateBaseline } from "./climate";
import { games as sampleGames, getGame as sampleGame, getPlayer as samplePlayer, SLATE_DATE } from "./data";
import type { Coverage, DefenseProfile, Division, Game, Market, Matchup, OffenseProfile, Prospect, ScoreComponents, Team, WeatherInput } from "./types";

const ET = "America/New_York";
const SLATE_CLASSIFICATIONS: Classification[] = ["fbs", "fcs"];

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

export interface RankedTeam {
  rank: number;
  team: Team;
  /** This week's game for the team, if any. */
  gameId?: string;
  movement?: "first-place-votes";
  firstPlaceVotes?: number;
}

export interface Poll {
  name: string;
  division: Division;
  teams: RankedTeam[];
}

export interface Slate {
  source: "live" | "sample";
  polls: Poll[];
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
  /** school name -> { rank, poll } for that school's division poll */
  ranks: Map<string, { rank: number; poll: string }>;
  rankings: CfbdRankingWeek | undefined;
  /** "espn" when CFBD's monthly quota was exhausted and the week came from ESPN's scoreboard (src/lib/espn-schedule.ts). */
  source?: "cfbd" | "espn";
  /** The ESPN bundle behind an "espn" source, for the coverage note. */
  espn?: EspnWeekBundle;
}

/** One poll per division. AP for FBS; coaches polls for the rest. */
const POLL_FOR_DIVISION: Record<Division, RegExp> = {
  FBS: /^AP Top 25$/i,
  FCS: /FCS Coaches/i,
  DII: /Division II Coaches/i,
  DIII: /Division III Coaches/i,
  NAIA: /NAIA/i,
};

function rankMap(r: CfbdRankingWeek | undefined): Map<string, { rank: number; poll: string }> {
  const m = new Map<string, { rank: number; poll: string }>();
  if (!r) return m;
  for (const div of Object.keys(POLL_FOR_DIVISION) as Division[]) {
    const poll = r.polls.find((p) => POLL_FOR_DIVISION[div].test(p.poll));
    if (!poll) continue;
    for (const row of poll.ranks) if (!m.has(row.school)) m.set(row.school, { rank: row.rank, poll: poll.poll });
  }
  return m;
}

/**
 * The week from ESPN's scoreboard when CFBD's monthly quota is gone. CFBD
 * teams and venues are still used when the fetch cache has them (they carry
 * coordinates and surfaces ESPN lacks); ESPN fills whatever is missing.
 */
async function loadWeekFromEspn(season: number, week: CfbdWeek, gamesOverride?: CfbdGame[]): Promise<Bundle> {
  const e = await espnWeek(season, week);
  const [cfbdTeams, cfbdVenues] = await Promise.all([getTeams(season).catch(() => [] as CfbdTeam[]), getVenues().catch(() => [] as CfbdVenue[])]);
  const teams = new Map(e.teams.map((t) => [t.school, t]));
  for (const t of cfbdTeams) teams.set(t.school, t);
  const venues = new Map(e.venues.map((v) => [v.id, v]));
  for (const v of cfbdVenues) venues.set(v.id, v);
  const mediaMap = new Map<number, CfbdMedia[]>();
  for (const m of e.media) mediaMap.set(m.id, [...(mediaMap.get(m.id) ?? []), m]);
  const games = gamesOverride ?? e.games.filter((g) => SLATE_CLASSIFICATIONS.includes(g.homeClassification ?? "fbs"));
  return {
    season,
    week,
    games,
    lines: new Map(e.lines.map((l) => [l.id, l])),
    media: mediaMap,
    teams,
    venues,
    records: new Map(e.records.map((r) => [r.team, r])),
    ranks: rankMap(e.rankings),
    rankings: e.rankings,
    source: "espn",
    espn: e,
  };
}

async function loadWeek(season: number, week: CfbdWeek, gamesOverride?: CfbdGame[]): Promise<Bundle> {
  const st = week.seasonType;
  // CFBD monthly quota gone: build the week from ESPN instead of asking CFBD again.
  if (cfbdQuotaExhausted()) return loadWeekFromEspn(season, week, gamesOverride);
  let gameLists: CfbdGame[][];
  try {
    // Division I only for now. DII and DIII come back when the product can do the work on them.
    gameLists = gamesOverride ? [gamesOverride] : await Promise.all(SLATE_CLASSIFICATIONS.map((c) => getGames(season, week.week, st, c)));
  } catch (err) {
    // The first call that discovers the quota is gone flips the flag; fall back right away.
    if (err instanceof CfbdQuotaError || cfbdQuotaExhausted()) return loadWeekFromEspn(season, week, gamesOverride);
    throw err;
  }
  const [linesRaw, media, teams, venues, records, rankings] = await Promise.all([
    getLines(season, week.week, st).catch(() => [] as CfbdLineRow[]),
    getMedia(season, week.week, st).catch(() => [] as CfbdMedia[]),
    getTeams(season),
    getVenues(),
    getRecords(season).catch(() => [] as CfbdRecord[]),
    getRankings(season, week.week, st).catch(() => [] as CfbdRankingWeek[]),
  ]);
  // CFBD games may still be served from the fetch cache while the lines call fails on quota. Borrow ESPN's one-book lines then.
  let lines = linesRaw;
  if (!lines.length && (cfbdQuotaExhausted() || gameLists.flat().length)) {
    try {
      const e = await espnWeek(season, week);
      if (e.lines.length) lines = e.lines;
    } catch {}
  }
  // Rankings are published for the week they apply to; fall back to the latest week available.
  const rankingWeek = rankings.find((r) => r.week === week.week) ?? [...rankings].sort((a, b) => b.week - a.week)[0];
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
    source: "cfbd",
    ranks: rankMap(rankingWeek),
    rankings: rankingWeek,
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
  const rk = b.ranks.get(name);
  return {
    rank: rk?.rank,
    rankPoll: rk?.poll,
    id: String(id),
    name: t?.mascot ? `${t.school} ${t.mascot}` : name,
    short: name,
    abbr: t?.abbreviation ?? abbrevFallback(name),
    record: rec,
    conference: conf ?? t?.conference ?? "",
    color: t?.color ?? "#8b95a0",
    logo: t?.logos?.[0] ?? undefined,
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

/* ------------------------------------------------------- radar bridge */

const ft = (inches: number | null) => (inches ? `${Math.floor(inches / 12)}-${inches % 12}` : "");

export function radarToProspect(r: RadarPlayer, abbr: string): Prospect {
  const upper = r.classYear === 3 || r.classYear === 4;
  return {
    id: r.id,
    name: r.name,
    team: abbr,
    jersey: r.jersey ?? 0,
    pos: r.pos,
    cls: r.cls,
    ht: ft(r.height),
    wt: r.weight ?? 0,
    draftYear: r.draftClass,
    eligibilityConfidence: upper ? "High" : "Medium",
    tier: r.tier,
    projected: (() => {
      const band = upper ? bandFor(r.id) : undefined;
      return band ? `${band} (forecast)` : `${r.draftClass} class`;
    })(),
    sourceCount: 0,
    projectionConfidence: r.score >= 70 ? "High" : r.score >= 50 ? "Medium" : "Low",
    traits: r.evidence.map((e) => e.label),
    weakness: r.size === false ? "Under NFL size norms for the position" : undefined,
    watchFor: r.watch,
    stat: r.stat,
    radar: r,
  };
}

function toProfiles(school: string, abbr: string): { off: OffenseProfile; def: DefenseProfile } {
  const st = styleFor(school);
  if (!st) {
    return {
      off: { label: "Unavailable", sample: "unavailable" },
      def: { label: "Unavailable", sample: "unavailable" },
    };
  }
  void abbr;
  return {
    off: { label: st.offense.label, sample: st.offense.sample, summary: st.offense.summary, metrics: st.offense.metrics },
    def: { label: st.defense.label, sample: st.defense.sample, summary: st.defense.summary, metrics: st.defense.metrics },
  };
}

function shortStyle(label: string) {
  return label.split(",")[0].trim();
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
  edges?: Matchup[];
  contrast: number | null;
}): ScoreComponents {
  // Draft talent and future talent come from the radar (production, pedigree, usage, size) or a curated board.
  let draftTalent: number | null = null;
  let futureTalent: number | null = null;
  if (generatedLoaded() || prospectFileLoaded) {
    const eligible = g.prospects.filter((p) => p.tier === "Eligible" || p.tier === "Established" || p.tier === "Emerging");
    const pts = eligible.reduce((s, p) => {
      if (p.tier === "Established") return s + (/round 1\b/i.test(p.projected) ? 40 : 25);
      if (p.tier === "Emerging") return s + 12;
      return s + Math.max(0, (p.radar?.score ?? 0) - 58) * 1.7;
    }, 0);
    draftTalent = Math.round(Math.min(100, pts));
    const fut = g.prospects.reduce((s, p) => {
      if (p.tier === "Future") return s + Math.max(0, (p.radar?.score ?? 50) - 50) * 1.8;
      if (p.tier === "Sleeper") return s + 10;
      if (p.tier === "Watch" || p.tier === "Watch only") return s + 6;
      return s;
    }, 0);
    futureTalent = Math.round(Math.min(100, fut));
  }
  const edges = g.edges ?? [];
  const directMatchups = edges.length ? Math.min(100, edges.filter((e) => e.edge !== "even").length * 28 + edges.filter((e) => e.edge === "even").length * 12) : null;
  const contrast = g.contrast;

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
  if (g.home.rank && g.away.rank) storylines += 35;
  else if (g.home.rank || g.away.rank) storylines += 15;
  storylines = Math.min(100, storylines);

  // Availability: can you actually watch it right now.
  let availability = NATIONAL_TV.test(g.network) ? 100 : g.network === "No listed broadcast" ? 35 : 70;
  if (g.status === "final") availability = 30;

  return {
    draftTalent,
    directMatchups,
    futureTalent,
    competitive,
    styleContrast: contrast,
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
  edges?: Matchup[];
}): { headline: string; reasons: string[] } {
  // Fallback when no AI watch guide is cached. Reads like a person: lead with the most concrete
  // thing (a named radar player and his line, or a mismatch with the numbers), never with
  // "X hosts Y (3-2)" on its own.
  const r: string[] = [];
  const rankedLabel = (t: Team) => (t.rank ? `No. ${t.rank} ${t.short}` : t.short);
  const s = g.market.spread;
  const t = g.market.total;
  const star = g.prospects.find((p) => p.radar) ?? g.prospects[0];
  const starScore = star?.radar?.score ?? (star ? 80 : 0);
  const starLine = star
    ? `${star.name} (${star.team} ${star.pos}, ${star.cls})${star.stat ? `: ${star.stat}` : star.traits[0] ? `: ${star.traits[0]}` : ""}. ${star.radar?.watch || star.watchFor || `Radar score ${starScore}.`}`.trim()
    : undefined;
  const topEdge = g.edges?.find((e) => e.edge !== "even");
  const edgeLine = topEdge ? `${topEdge.a} against ${topEdge.b}: ${topEdge.evidence}. ${topEdge.watch ?? `Advantage ${topEdge.edge}.`}` : undefined;
  const edgeStrong = Boolean(topEdge && (topEdge.strength === "dominant" || topEdge.strength === "clear"));
  if (starLine && (starScore >= 80 || !edgeStrong)) {
    r.push(starLine);
    if (edgeLine) r.push(edgeLine);
  } else if (edgeLine) {
    r.push(edgeLine);
    if (starLine) r.push(starLine);
  }
  if (s) {
    const a = Math.abs(s.line);
    const move = s.line - s.open;
    if (a <= 3) r.push(`The market calls it a toss-up: ${s.team} ${s.line}${t ? `, total ${t.line}` : ""}. Every third down counts.`);
    else if (a <= 7.5) r.push(`One-score game by the market: ${s.team} ${s.line}${t ? `, total ${t.line}` : ""}.`);
    if (Math.abs(move) >= 2.5) r.push(`The line moved ${Math.abs(move).toFixed(1)} points ${move > 0 ? "toward the underdog" : "toward the favorite"} this week, from ${s.open} to ${s.line}.`);
  }
  if (t) {
    if (t.line >= 62) r.push(`Total of ${t.line}. The market expects points, so watch who scores on the first drive.`);
    else if (t.line <= 42) r.push(`Total of ${t.line}. The market expects a field-position grind, so punts and third-and-medium decide it.`);
  }
  if (g.weather) {
    const top = evaluateWeather(g.weather).find((f) => f.level === "elevated") ?? evaluateWeather(g.weather).find((f) => f.level === "flag");
    if (top) r.push(`${top.title}. ${top.effect}`);
  }
  const hp = winPct(g.home);
  const ap = winPct(g.away);
  if (hp === 1 && ap === 1 && gamesPlayed(g.home) >= 3 && gamesPlayed(g.away) >= 3) {
    r.push(`Both teams are undefeated: ${g.away.short} ${g.away.record} at ${g.home.short} ${g.home.record}. Somebody's zero goes.`);
  }
  if (g.home.rank && g.away.rank) {
    r.push(`Ranked matchup: ${rankedLabel(g.away)} at ${rankedLabel(g.home)}.`);
  } else if ((g.home.rank || g.away.rank) && r.length) {
    const ranked = g.home.rank ? g.home : g.away;
    const other = g.home.rank ? g.away : g.home;
    r.push(`${rankedLabel(ranked)} ${g.home.rank ? "hosts" : "visits"} ${other.short}${other.record ? ` (${other.record})` : ""}.`);
  } else if (g.home.rank || g.away.rank) {
    const ranked = g.home.rank ? g.home : g.away;
    const other = g.home.rank ? g.away : g.home;
    r.push(`${rankedLabel(ranked)} ${g.home.rank ? "hosts" : "visits"} ${other.short}${other.record ? ` (${other.record})` : ""}. No line and nobody on the radar yet, so watch ${other.short}'s first three drives to see if they can hang.`);
  }
  if (g.conferenceGame && g.home.conference && r.length < 3) r.push(`${g.home.conference} conference game.`);
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

async function buildGame(raw: CfbdGame, b: Bundle, withWeather: boolean, withBox = false): Promise<Game> {
  const cls = raw.homeClassification ?? raw.awayClassification ?? "fbs";
  const division = DIVISION[cls] ?? "FBS";
  const home = mkTeam(raw.homeTeam, raw.homeId, raw.homeConference, b);
  const away = mkTeam(raw.awayTeam, raw.awayId, raw.awayConference, b);
  const now = Date.now();
  const started = new Date(raw.startDate).getTime() <= now;
  let status: Game["status"] = raw.completed ? "final" : started ? "live" : "upcoming";
  const hasScore = raw.homePoints != null && raw.awayPoints != null;
  let score = hasScore
    ? { home: raw.homePoints as number, away: raw.awayPoints as number, clock: raw.completed ? "Final" : "in progress" }
    : status === "live"
      ? { home: NaN, away: NaN, clock: "in progress" }
      : undefined;

  // ESPN live overlay (Division I only): real clock, score, situation, win probability for games that
  // kicked off in the last 30 hours. CFBD stays the source for everything else.
  const espnLive =
    (cls === "fbs" || cls === "fcs") && status !== "upcoming" && now - new Date(raw.startDate).getTime() < 30 * 3600 * 1000
      ? await liveGame(String(raw.id), etDate(new Date(raw.startDate))).catch(() => undefined)
      : undefined;
  if (espnLive && espnLive.state !== "pre") {
    status = espnLive.state === "in" ? "live" : "final";
    if (espnLive.home.score != null && espnLive.away.score != null) score = { home: espnLive.home.score, away: espnLive.away.score, clock: espnLive.detail };
  } else if (espnLive && !raw.completed) {
    status = "upcoming"; // CFBD says the clock has passed kickoff; ESPN says it has not started (delay or late kick).
    score = undefined;
  }

  const builtAt = new Date().toISOString();
  const market = mkMarket(b.lines.get(raw.id), home, away, builtAt);
  const network = mkNetwork(b.media.get(raw.id));
  const venue = raw.venueId != null ? b.venues.get(raw.venueId) : undefined;

  const weatherP: Promise<WeatherInput | undefined> =
    withWeather && status !== "final" && venue?.latitude != null && venue?.longitude != null
      ? forecastAtKickoff(
      {
        latitude: venue.latitude,
        longitude: venue.longitude,
        dome: venue.dome,
        grass: venue.grass,
        elevationMeters: venue.elevation != null ? Number(venue.elevation) : null,
        fieldBearing: fieldBearing(venue.id)?.bearing,
        fieldBearingConfidence: fieldBearing(venue.id)?.confidence,
      },
      raw.startDate,
    )
      : Promise.resolve(undefined);
  const boxP = withBox && status !== "upcoming" ? boxScore(String(raw.id), raw.season, raw.week, raw.seasonType, cls).catch(() => undefined) : Promise.resolve(undefined);
  const liveP = withBox && espnLive && espnLive.state !== "pre" ? liveSummary(String(raw.id)).catch(() => undefined) : Promise.resolve(undefined);
  const [weather, bs, espnDetail] = await Promise.all([weatherP, boxP, liveP]);

  // Prospects: curated board entries first (if any), then the production-based radar.
  const curated = [
    ...prospectsForTeam(raw.awayTeam).map((p) => toProspect(p, away.abbr)),
    ...prospectsForTeam(raw.homeTeam).map((p) => toProspect(p, home.abbr)),
  ];
  const unitNote = (school: string) => {
    const st = styleFor(school);
    const ly = st?.offense.metrics.find((m) => m.key === "ly");
    const sr = st?.offense.metrics.find((m) => m.key === "sr");
    return ly ? `Unit: ${ly.value} line yards per carry (No. ${ly.rank} of ${ly.of})${sr ? `, offense success ${sr.value} (No. ${sr.rank})` : ""}` : undefined;
  };
  const withUnit = (r: RadarPlayer, abbr: string, school: string): Prospect => {
    const pr = radarToProspect(r, abbr);
    if (r.group === "OL") {
      const note = unitNote(school);
      if (note) {
        pr.stat = note;
        pr.traits = [note, ...pr.traits];
        pr.radar = { ...r, stat: note, evidence: [{ kind: "unit", label: note }, ...r.evidence] };
      }
    }
    return pr;
  };
  const radarAway = radarForGame(raw.awayTeam).map((r) => withUnit(r, away.abbr, raw.awayTeam));
  const radarHome = radarForGame(raw.homeTeam).map((r) => withUnit(r, home.abbr, raw.homeTeam));
  const seenP = new Set(curated.map((p) => p.id));
  const prospects = [...curated, ...[...radarAway, ...radarHome].filter((p) => (seenP.has(p.id) ? false : seenP.add(p.id)))].sort(
    (x, y) => (y.radar?.score ?? 100) - (x.radar?.score ?? 100),
  );

  // Team style and unit matchups from advanced season stats.
  const profAway = toProfiles(raw.awayTeam, away.abbr);
  const profHome = toProfiles(raw.homeTeam, home.abbr);
  const charted = profAway.off.sample !== "unavailable" && profHome.off.sample !== "unavailable";
  const edgeRows = charted ? [...unitEdges(raw.awayTeam, raw.homeTeam), ...unitEdges(raw.homeTeam, raw.awayTeam)] : [];
  const matchups: Matchup[] = edgeRows
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
    .slice(0, 4)
    .map((e) => {
      const [a, bb] = e.title.split(" vs ");
      return { a, b: bb, why: e.text, evidence: e.evidence, edge: e.edge, strength: e.strength, watch: e.watch };
    });
  const contrast = charted ? styleContrast(raw.awayTeam, raw.homeTeam) : null;
  const pp = charted ? pressurePoint(raw.awayTeam, raw.homeTeam) : undefined;
  const projection = projectGame({
    home,
    away,
    homeElo: raw.homePregameElo,
    awayElo: raw.awayPregameElo,
    neutral: raw.neutralSite,
    market,
    matchups,
    homeSchool: raw.homeTeam,
    awaySchool: raw.awayTeam,
    homePassRate: styleFor(raw.homeTeam)?.raw.off.passRate,
    awayPassRate: styleFor(raw.awayTeam)?.raw.off.passRate,
    homeAdv: styleFor(raw.homeTeam)?.raw,
    awayAdv: styleFor(raw.awayTeam)?.raw,
    means: charted ? leagueMeans(cls) : undefined,
    weather,
  });
  // Outside projection systems next to ours (SP+, FPI, SRS, Elo, CFBD pregame). Division I only; never throws.
  const consensus =
    division === "FBS" || division === "FCS"
      ? await buildConsensus({ gameId: String(raw.id), season: raw.season, week: raw.week, seasonType: raw.seasonType, home, away, homeSchool: raw.homeTeam, awaySchool: raw.awayTeam, neutral: raw.neutralSite, homeElo: raw.homePregameElo, awayElo: raw.awayPregameElo, market, projection }).catch(() => undefined)
      : undefined;

  // Keep an eye on: young or unproven names the radar flags that did not make the main list.
  const inMain = new Set(prospects.map((p) => p.id));
  const eye = [
    ...radarForTeam(raw.awayTeam).filter((r) => !inMain.has(r.id) && (r.tier === "Future" || r.tier === "Watch")).slice(0, 2).map((r) => ({ r, abbr: away.abbr })),
    ...radarForTeam(raw.homeTeam).filter((r) => !inMain.has(r.id) && (r.tier === "Future" || r.tier === "Watch")).slice(0, 2).map((r) => ({ r, abbr: home.abbr })),
  ].map(({ r, abbr }) => ({
    name: r.name,
    team: abbr,
    note: `${r.pos}, ${r.cls}. ${r.evidence[0]?.label ?? "No production yet"}${r.evidence[1] ? `. ${r.evidence[1].label}` : ""}. ${r.eligibilityNote}${(() => {
      const a = division === "FBS" || division === "FCS" ? arrivalNote(r.id) : undefined;
      return a ? ` Transfer: ${a}.` : "";
    })()}`,
  }));

  const ctx = {
    edges: matchups,
    contrast,
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

  // Box score once the game has started (game page only).
  let box: Game["box"];
  {
    if (bs) {
      box = {
        teams: bs.teams.map((t) => ({
          team: t.team,
          abbr: t.team === raw.homeTeam ? home.abbr : away.abbr,
          points: t.points,
          leaders: t.leaders.map((l) => ({ id: l.id, name: l.name, category: l.category, headline: l.headline })),
        })),
      };
      for (const p of prospects) {
        const lines = bs.byPlayer.get(p.id);
        if (lines?.length) p.lines = lines.map((l) => ({ category: l.category, headline: l.headline }));
      }
      box.source = "cfbd";
    } else if (espnDetail && espnDetail.box.some((t) => t.leaders.length)) {
      // In-game box from ESPN until CFBD publishes the settled one.
      box = {
        source: "espn",
        teams: espnDetail.box.map((t) => ({
          team: t.homeAway === "home" ? home.short : away.short,
          abbr: t.homeAway === "home" ? home.abbr : away.abbr,
          points: t.homeAway === "home" ? espnDetail.home.score : espnDetail.away.score,
          leaders: t.leaders.map((l) => ({ id: l.id, name: l.name, category: l.category, headline: l.headline })),
        })),
      };
      for (const p of prospects) {
        const lines = espnDetail.byPlayer[p.id];
        if (lines?.length) p.lines = lines;
      }
    }
  }

  // Play-by-play situational splits (Division I only), when the digest exists for both schools.
  const sitHome = cls === "fbs" || cls === "fcs" ? situationsFor(raw.homeTeam) : undefined;
  const sitAway = cls === "fbs" || cls === "fcs" ? situationsFor(raw.awayTeam) : undefined;
  const situations = sitHome && sitAway ? { home: sitHome, away: sitAway, cues: gameCues(raw.awayTeam, raw.homeTeam) } : undefined;

  const coverage: Coverage = cls === "fbs" || cls === "fcs" ? (charted ? "Full" : "Standard") : "Limited";
  const gaps: string[] = [];
  if (status !== "final" && !espnLive) gaps.push(cls === "fbs" || cls === "fcs" ? "Live score and clock come from ESPN once the game kicks off. Status is schedule-based until then." : "Live score and clock are not on the current data plan. Status is schedule-based.");
  if (!generatedLoaded()) gaps.push("Rosters, stats, and tendencies are not ingested. Run npm run ingest.");
  else if (!charted) gaps.push("Advanced tendencies are not published for this division. Style and matchup scores are excluded.");
  if (generatedLoaded() && !prospects.length) gaps.push("No player from either team clears the radar threshold yet.");
  if (prospects.length && !curated.length) gaps.push("Radar entries are production-based evidence, not draft projections. No outside board is loaded.");
  if (!market.spread) gaps.push("No book we track lists this game.");
  if (!weather && status !== "final") gaps.push(venue?.latitude == null ? "No forecast: venue coordinates are missing." : "No forecast: kickoff is outside the 7-day hourly window or the weather service did not answer.");
  if (cls === "ii" || cls === "iii") gaps.push("Lower-division coverage is schedule and score only.");

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
    whyWatch: publishedGuide({ id: String(raw.id), kickoff: raw.startDate, division })?.cardLine ?? why.headline,
    whyWatchReasons: why.reasons,
    styleLine: charted ? `${shortStyle(profAway.off.label)} O vs ${shortStyle(profHome.def.label)} D` : undefined,
    weather,
    market,
    prospects,
    matchups,
    keepAnEyeOn: eye,
    storylines: [
      ...(raw.notes ? [raw.notes] : []),
      ...(raw.conferenceGame && home.conference ? [`${home.conference} conference game.`] : []),
      ...(raw.neutralSite ? ["Neutral site."] : []),
      ...(division === "FBS" || division === "FCS" ? portalStorylines(raw.homeTeam, raw.awayTeam) : []),
    ],
    climate: division === "FBS" || division === "FCS" ? climateBaseline(venue?.id, raw.startDate) : undefined,
    offense: { [home.abbr]: profHome.off, [away.abbr]: profAway.off },
    defense: { [home.abbr]: profHome.def, [away.abbr]: profAway.def },
    pressurePoint: pp ?? "Not charted for this division. The report does not guess a scheme.",
    scoreComponents,
    gaps,
    projection,
    consensus,
    box,
    live: espnLive && espnLive.state !== "pre"
      ? {
          period: espnLive.period,
          clock: espnLive.detail,
          possession: espnLive.possession,
          down: espnLive.down,
          distance: espnLive.distance,
          yardLine: espnLive.yardLine,
          downDistance: espnLive.downDistance,
          lastPlay: espnLive.lastPlay,
          homeWinProb: espnLive.homeWinProb,
          awayWinProb: espnLive.awayWinProb,
          swing: espnLive.swing,
          swingMinutes: espnLive.swingMinutes,
          closeness: espnLive.closeness,
          broadcast: espnLive.broadcast,
          asOf: espnLive.asOf,
        }
      : undefined,
    liveDetail: espnDetail,
    situations,
    statsAsOf: genMeta()?.ingestedAt,
    reportAsOf: builtAt,
    source: "live",
    week: raw.week,
  };
}

/* ------------------------------------------------------------- public */

function sampleSlate(): Slate {
  return {
    source: "sample",
    polls: [],
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
  // The assembled slate is memoized briefly so navigating between pages does not rebuild 300 games each time.
  // 60s while any game is live or kicks off within two hours, 120s on a quiet day (src/lib/cache-policy.ts).
  return memo(`slate:${requested}`, (s) => slateTtlSeconds(s.games), () => buildSlate(requested));
}

async function buildSlate(requested: string): Promise<Slate> {
  const season = seasonFor(requested);
  // Calendar from CFBD (a day in the fetch cache); ESPN's league calendar when the quota is gone and the cache is cold.
  const cal = cfbdQuotaExhausted()
    ? await getCalendar(season).catch(() => espnCalendar(season).catch(() => [] as CfbdWeek[]))
    : await getCalendar(season).catch((err) => (err instanceof CfbdQuotaError ? espnCalendar(season).catch(() => [] as CfbdWeek[]) : Promise.reject(err)));
  // No calendar from anyone: the 7-day window around the requested date still lets ESPN build the slate.
  const week = pickWeek(cal, requested) ?? (cfbdQuotaExhausted() ? derivedWeek(season, requested) : undefined);
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

  // Accountability: lock every upcoming Division I call, grade every final that has one. Never blocks the page on failure.
  try {
    for (let i = 0; i < todays.length; i++) {
      const raw = todays[i];
      const g = built[i];
      const cls = raw.homeClassification ?? "fbs";
      if (cls !== "fbs" && cls !== "fcs") continue;
      if (g.status === "upcoming") lockPregame(g, raw.season);
      else if (g.status === "final" && readEntry(raw.season, g.id) && !readEntry(raw.season, g.id)?.postgame) {
        const bs = await boxScore(g.id, raw.season, raw.week, raw.seasonType, cls);
        if (bs) gradePostgame(g, raw.season, bs, raw.excitementIndex);
      }
    }
  } catch {}

  const notes: string[] = [];
  notes.push("Division I only. DII, DIII, and NAIA are a later version; the product cannot do the scouting work on them yet.");
  if (b.source === "espn" && b.espn) notes.push(espnFallbackNote(b.espn));
  if (!generatedLoaded()) notes.push("Rosters, stats, and tendencies are not ingested yet. Run npm run ingest in web/ to light up the radar.");
  else notes.push(`Radar and tendencies use season stats ingested ${new Date(genMeta()!.ingestedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "America/New_York" })} ET.`);

  const weekGames = [...built, ...rest];
  const polls = buildPolls(b, weekGames);
  return { source: "live", polls, season, week, date, days, games: built, weekGames, notes };
}

function buildPolls(b: Bundle, weekGames: Game[]): Poll[] {
  if (!b.rankings) return [];
  const out: Poll[] = [];
  for (const div of ["FBS", "FCS", "DII", "DIII"] as Division[]) {
    const poll = b.rankings.polls.find((p) => POLL_FOR_DIVISION[div].test(p.poll));
    if (!poll) continue;
    const teams: RankedTeam[] = poll.ranks
      .slice()
      .sort((x, y) => x.rank - y.rank)
      .map((row) => {
        const game = weekGames.find((g) => g.home.short === row.school || g.away.short === row.school);
        const t = b.teams.get(row.school);
        const team = mkTeam(row.school, row.teamId ?? t?.id ?? 0, row.conference, b);
        return { rank: row.rank, team, gameId: game?.id, firstPlaceVotes: row.firstPlaceVotes ?? undefined };
      });
    out.push({ name: poll.poll, division: div, teams });
  }
  return out;
}

export async function getGame(id: string): Promise<Game | undefined> {
  if (!hasCfbdKey()) return sampleGame(id);
  if (!/^\d+$/.test(id)) return undefined;
  return memo(`game:${id}`, 30, () => buildGameById(id));
}

async function buildGameById(id: string): Promise<Game | undefined> {
  const rows = await cfbdGameById(id).catch(() => [] as CfbdGame[]);
  const raw = rows[0];
  if (!raw) {
    // CFBD unavailable (quota, outage): serve the game from the already-built slate for its week if we have it.
    const fromSlate = await getSlate().then((s) => s.weekGames.find((g) => g.id === id)).catch(() => undefined);
    return fromSlate;
  }
  const cal = await getCalendar(raw.season);
  const week = cal.find((w) => w.week === raw.week && w.seasonType === raw.seasonType) ?? pickWeek(cal, etDate(new Date(raw.startDate)));
  if (!week) return undefined;
  const b = await loadWeek(raw.season, week, [raw]);
  const game = await buildGame(raw, b, true, true);
  game.excitement = raw.excitementIndex;
  try {
    if (game.status === "upcoming") game.archive = lockPregame(game, raw.season);
    else if (game.status === "final" && game.box) {
      const bs = await boxScore(game.id, raw.season, raw.week, raw.seasonType, raw.homeClassification ?? "fbs");
      game.archive = bs ? gradePostgame(game, raw.season, bs, raw.excitementIndex) : readEntry(raw.season, game.id);
    } else game.archive = readEntry(raw.season, game.id);
  } catch {}
  game.odds = await gameOdds(game, raw.season).catch(() => undefined);
  return game;
}

export async function getPlayer(id: string): Promise<{ player: Prospect; game?: Game } | undefined> {
  if (!hasCfbdKey()) return samplePlayer(id);
  const row = prospectRowById(id);
  const r = radarPlayer(id);
  const school = row?.team ?? r?.team;
  if (!school) return undefined;
  const slate = await getSlate();
  const game = slate.weekGames.find((g) => g.home.short === school || g.away.short === school);
  const abbr = game ? (game.home.short === school ? game.home.abbr : game.away.abbr) : abbrevFallback(school);
  if (row) return { player: { ...toProspect(row, abbr), radar: r }, game };
  return { player: radarToProspect(r!, abbr), game };
}

/** Lookup used by the radar page to link each player to this week's game. */
export async function gameIndexForWeek(): Promise<Map<string, Game>> {
  const slate = await getSlate();
  const m = new Map<string, Game>();
  for (const g of slate.weekGames) {
    m.set(g.home.short, g);
    m.set(g.away.short, g);
  }
  return m;
}
