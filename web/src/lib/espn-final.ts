/**
 * A finished game from ESPN's summary feed (free, no key): the box score in the same shape as
 * CollegeFootballData's (src/lib/boxscore.ts) so the accountability grading keeps working when the
 * CFBD quota is gone, plus what the postgame recap needs: team stats, sacks and tackles for loss by
 * side, every drive, explosive plays, red zone trips, and the win-probability swing of every play.
 *
 * A completed game never changes, so the slimmed summary is cached to data/cache/espn-final/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BoxLine, BoxScore } from "./boxscore";
import { memo } from "./memo";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary";
const DIR = path.join(process.cwd(), "data", "cache", "espn-final");

/** ESPN box-score keys onto CFBD's stat names, per category. */
const KEYS: Record<string, Record<string, string>> = {
  passing: { "completions/passingAttempts": "C/ATT", passingYards: "YDS", yardsPerPassAttempt: "AVG", passingTouchdowns: "TD", interceptions: "INT" },
  rushing: { rushingAttempts: "CAR", rushingYards: "YDS", yardsPerRushAttempt: "AVG", rushingTouchdowns: "TD", longRushing: "LONG" },
  receiving: { receptions: "REC", receivingYards: "YDS", yardsPerReception: "AVG", receivingTouchdowns: "TD", longReception: "LONG" },
  defensive: { totalTackles: "TOT", soloTackles: "SOLO", sacks: "SACKS", tacklesForLoss: "TFL", passesDefended: "PD", hurries: "QB HUR", QBHits: "QB HUR", defensiveTouchdowns: "TD" },
  interceptions: { interceptions: "INT", interceptionYards: "YDS", interceptionTouchdowns: "TD" },
  fumbles: { fumbles: "FUM", fumblesLost: "LOST", fumblesRecovered: "REC" },
};

interface SlimPlay { id: string; text: string; period: number; clock: string; team: string | null; type: string; yards: number; toEndzone: number | null }
interface SlimDrive { team: string | null; result: string; yards: number; plays: SlimPlay[] }
interface Slim {
  completed: boolean;
  home: { id: string; abbr: string; score: number };
  away: { id: string; abbr: string; score: number };
  teamStats: Record<string, Record<string, string>>; // by ESPN team id
  players: { teamId: string; category: string; keys: string[]; athletes: { id: string; name: string; stats: string[] }[] }[];
  drives: SlimDrive[];
  wp: { playId: string; home: number }[];
}

export interface TeamGame {
  school: string;
  abbr: string;
  points: number;
  rushYds: number;
  rushAtt: number;
  passYds: number;
  passAtt: number;
  completions: number;
  thirdDowns: string; // "5-13"
  turnovers: number;
  totalYards: number;
  /** Made by this team's defense. */
  sacks: number;
  tfl: number;
  /** This team's offense: plays that went 20+ through the air and 15+ on the ground. */
  explosivePasses: number;
  explosiveRuns: number;
  longRun: number;
  longPass: number;
  /** Drives that reached the opponent's 40 or closer, and what they produced. */
  trips: number;
  tripTd: number;
  tripFg: number;
}

export interface Swing {
  period: number;
  clock: string;
  text: string;
  team: string | null; // abbr of the offense on the play
  homeBefore: number;
  homeAfter: number;
}

export interface EspnFinal {
  completed: boolean;
  box: BoxScore;
  home: TeamGame;
  away: TeamGame;
  swings: Swing[]; // the biggest win-probability moves, largest first
}

async function fetchSlim(gameId: string): Promise<Slim | undefined> {
  const f = path.join(DIR, `${gameId}.json`);
  if (existsSync(f)) {
    try {
      return JSON.parse(readFileSync(f, "utf8")) as Slim;
    } catch {}
  }
  const res = await fetch(`${BASE}?event=${gameId}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const j = await res.json();
  const comp = j?.header?.competitions?.[0];
  if (!comp) return undefined;
  const side = (ha: string) => {
    const c = comp.competitors.find((x: { homeAway: string }) => x.homeAway === ha);
    return { id: String(c?.team?.id ?? c?.id), abbr: c?.team?.abbreviation ?? "", score: Number(c?.score ?? 0) };
  };
  const teamStats: Slim["teamStats"] = {};
  for (const t of j?.boxscore?.teams ?? []) teamStats[String(t.team?.id)] = Object.fromEntries((t.statistics ?? []).map((s: { name: string; displayValue: string }) => [s.name, s.displayValue]));
  const players: Slim["players"] = [];
  for (const t of j?.boxscore?.players ?? []) {
    for (const c of t.statistics ?? []) {
      players.push({ teamId: String(t.team?.id), category: c.name, keys: c.keys ?? [], athletes: (c.athletes ?? []).map((a: { athlete?: { id?: string; displayName?: string }; stats?: string[] }) => ({ id: String(a.athlete?.id), name: a.athlete?.displayName ?? "", stats: a.stats ?? [] })) });
    }
  }
  const drives: SlimDrive[] = (j?.drives?.previous ?? []).map((d: { team?: { abbreviation?: string }; result?: string; yards?: number; plays?: unknown[] }) => ({
    team: d.team?.abbreviation ?? null,
    result: d.result ?? "",
    yards: d.yards ?? 0,
    plays: ((d.plays ?? []) as { id: string; text?: string; period?: { number?: number }; clock?: { displayValue?: string }; type?: { text?: string }; statYardage?: number; start?: { yardsToEndzone?: number } }[]).map((p) => ({
      id: String(p.id),
      text: p.text ?? "",
      period: p.period?.number ?? 0,
      clock: p.clock?.displayValue ?? "",
      team: d.team?.abbreviation ?? null,
      type: p.type?.text ?? "",
      yards: p.statYardage ?? 0,
      toEndzone: p.start?.yardsToEndzone ?? null,
    })),
  }));
  const slim: Slim = {
    completed: Boolean(comp.status?.type?.completed),
    home: side("home"),
    away: side("away"),
    teamStats,
    players,
    drives,
    wp: (j?.winprobability ?? []).map((w: { playId: string; homeWinPercentage: number }) => ({ playId: String(w.playId), home: w.homeWinPercentage })),
  };
  if (slim.completed) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(f, JSON.stringify(slim));
  }
  return slim;
}

const num = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function headline(category: string, s: Record<string, string>): { text: string; yards: number } {
  const n = (k: string) => num(s[k]);
  switch (category) {
    case "passing": return { text: `${s["C/ATT"] ?? ""}, ${n("YDS")} yds, ${n("TD")} TD, ${n("INT")} INT`, yards: n("YDS") };
    case "rushing": return { text: `${n("CAR")} car, ${n("YDS")} yds, ${n("TD")} TD`, yards: n("YDS") };
    case "receiving": return { text: `${n("REC")} rec, ${n("YDS")} yds, ${n("TD")} TD`, yards: n("YDS") };
    case "defensive": return { text: `${n("TOT")} tkl, ${n("TFL")} TFL, ${n("SACKS")} sacks${n("PD") ? `, ${n("PD")} PD` : ""}`, yards: n("TOT") * 8 + n("TFL") * 15 + n("SACKS") * 25 };
    case "interceptions": return { text: `${n("INT")} INT, ${n("YDS")} yds`, yards: n("INT") * 40 };
    default: return { text: Object.entries(s).map(([k, v]) => `${k} ${v}`).join(", "), yards: 0 };
  }
}

const PASS = /pass(ing)? (reception|touchdown)|^pass completion/i;
const RUN = /^rush|rushing touchdown/i;

/**
 * The finished game, with each side named by the school names the site uses. Undefined until ESPN
 * has a box score; `completed` false while the game is still on.
 */
export function espnFinal(gameId: string, homeSchool: string, awaySchool: string): Promise<EspnFinal | undefined> {
  return memo(`espn-final:${gameId}`, 300, async () => {
    const s = await fetchSlim(gameId);
    if (!s || !s.players.length) return undefined;
    const schoolOf = (teamId: string) => (teamId === s.home.id ? homeSchool : awaySchool);

    // Box score in CFBD shape.
    const byPlayer = new Map<string, BoxLine[]>();
    const linesByTeam = new Map<string, BoxLine[]>();
    for (const c of s.players) {
      const map = KEYS[c.category];
      if (!map) continue;
      for (const a of c.athletes) {
        const stats: Record<string, string> = {};
        c.keys.forEach((k, i) => {
          const dest = map[k];
          if (dest && stats[dest] === undefined) stats[dest] = a.stats[i];
        });
        const h = headline(c.category, stats);
        const line: BoxLine = { id: a.id, name: a.name, team: schoolOf(c.teamId), category: c.category, stats, headline: h.text, yards: h.yards };
        (byPlayer.get(a.id) ?? byPlayer.set(a.id, []).get(a.id)!).push(line);
        (linesByTeam.get(c.teamId) ?? linesByTeam.set(c.teamId, []).get(c.teamId)!).push(line);
      }
    }
    const teams: BoxScore["teams"] = [s.home, s.away].map((t) => {
      const lines = linesByTeam.get(t.id) ?? [];
      const leaders = ["passing", "rushing", "receiving", "defensive", "interceptions"]
        .flatMap((c) => lines.filter((l) => l.category === c).sort((a, b) => b.yards - a.yards).slice(0, c === "receiving" || c === "defensive" ? 2 : 1))
        .filter((l) => l.yards > 0);
      return { team: schoolOf(t.id), homeAway: t === s.home ? ("home" as const) : ("away" as const), points: t.score, leaders };
    });
    const box: BoxScore = { gameId, teams, byPlayer };

    // Team game lines.
    const team = (t: Slim["home"]): TeamGame => {
      const st = s.teamStats[t.id] ?? {};
      const opp = t === s.home ? s.away : s.home;
      const defLines = (linesByTeam.get(t.id) ?? []).filter((l) => l.category === "defensive");
      const myDrives = s.drives.filter((d) => d.team === t.abbr);
      const plays = myDrives.flatMap((d) => d.plays);
      const [comp, att] = String(st.completionAttempts ?? "0/0").split(/[-/]/).map(num);
      let trips = 0, tripTd = 0, tripFg = 0;
      for (const d of myDrives) {
        if (!d.plays.some((p) => p.toEndzone != null && p.toEndzone <= 40)) continue;
        trips++;
        if (/TD|touchdown/i.test(d.result)) tripTd++;
        else if (/^FG$|field goal/i.test(d.result) && !/missed/i.test(d.result)) tripFg++;
      }
      void opp;
      return {
        school: schoolOf(t.id),
        abbr: t.abbr,
        points: t.score,
        rushYds: num(st.rushingYards),
        rushAtt: num(st.rushingAttempts),
        passYds: num(st.netPassingYards),
        passAtt: att ?? 0,
        completions: comp ?? 0,
        thirdDowns: st.thirdDownEff ?? "",
        turnovers: num(st.turnovers),
        totalYards: num(st.totalYards),
        sacks: defLines.reduce((a, l) => a + num(l.stats.SACKS), 0),
        tfl: defLines.reduce((a, l) => a + num(l.stats.TFL), 0),
        explosivePasses: plays.filter((p) => PASS.test(p.type) && p.yards >= 20).length,
        explosiveRuns: plays.filter((p) => RUN.test(p.type) && p.yards >= 15).length,
        longRun: Math.max(0, ...plays.filter((p) => RUN.test(p.type)).map((p) => p.yards)),
        longPass: Math.max(0, ...plays.filter((p) => PASS.test(p.type)).map((p) => p.yards)),
        trips,
        tripTd,
        tripFg,
      };
    };

    // Win-probability swings: the change in the home team's chance across each play.
    const playById = new Map(s.drives.flatMap((d) => d.plays).map((p) => [p.id, p]));
    const swings: Swing[] = [];
    for (let i = 1; i < s.wp.length; i++) {
      const p = playById.get(s.wp[i].playId);
      if (!p || !p.text) continue;
      swings.push({ period: p.period, clock: p.clock, text: p.text, team: p.team, homeBefore: s.wp[i - 1].home, homeAfter: s.wp[i].home });
    }
    swings.sort((a, b) => Math.abs(b.homeAfter - b.homeBefore) - Math.abs(a.homeAfter - a.homeBefore));

    return { completed: s.completed, box, home: team(s.home), away: team(s.away), swings: swings.slice(0, 5) };
  });
}

/** The CFBD-shaped box score alone, for the accountability grading. */
export async function espnBox(gameId: string, homeSchool: string, awaySchool: string): Promise<BoxScore | undefined> {
  const f = await espnFinal(gameId, homeSchool, awaySchool).catch(() => undefined);
  return f?.completed ? f.box : undefined;
}
