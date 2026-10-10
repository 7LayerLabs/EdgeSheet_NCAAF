/**
 * "Right now" board for the home page on game days: which live games are worth
 * flipping to (with a plain-English reason), which radar names are having a big
 * day, and what kicks off next. Server only (reads ESPN summaries).
 *
 * Ordering: the situation (overtime, one score late, upset brewing, ranked team
 * on the field) comes first, the existing flip score (Jev or numeric, see
 * lib/live.ts flipRank) breaks ties inside a situation, and FBS sits ahead of
 * FCS so a small FCS game never leads while an FBS game is live.
 */
import { liveSummary } from "./espn";
import { flipRank } from "./live";
import type { Game, Team } from "./types";

export type FlipTone = "hot" | "upset" | "ranked" | "close" | "other";

export interface FlipItem {
  game: Game;
  /** Short reason chip, "One score, 4th quarter". */
  reason: string;
  tone: FlipTone;
  /** "2nd 4:12", "Halftime", "End 1st". */
  clock: string;
  network?: string;
  /** "IU 64%" from the win probability, when the feed has one. */
  winProb?: string;
  priority: number;
}

export interface PopItem {
  playerId: string;
  name: string;
  pos: string;
  jersey?: number;
  team: Team;
  opp: Team;
  game: Game;
  radarScore?: number;
  draftYear: number;
  /** Today's line, "14 car, 112 yds, 2 TD". */
  line: string;
  weight: number;
}

export interface RightNow {
  live: number;
  flips: FlipItem[];
  popping: PopItem[];
  upNext: Game[];
}

const isDI = (g: Game) => g.division === "FBS" || g.division === "FCS";

const quarter = (p: number) => (p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : p === 4 ? "4th" : p === 5 ? "OT" : `${p - 4}OT`);

function clockOf(g: Game): string {
  const s = g.score?.clock?.trim();
  if (s) return s;
  const l = g.live;
  return l ? `${quarter(l.period)} ${l.clock}`.trim() : "Live";
}

const rankName = (t: Team) => (t.rank ? `No. ${t.rank} ${t.short}` : t.short);

/** The side the market favors (spread), else the only ranked side, else the better-ranked side. */
function favorite(g: Game): { team: Team; by?: number } | undefined {
  const sp = g.market.spread;
  if (sp && sp.line < 0) {
    const team = sp.team === g.home.abbr ? g.home : sp.team === g.away.abbr ? g.away : undefined;
    if (team) return { team, by: -sp.line };
  }
  const hr = g.home.rank;
  const ar = g.away.rank;
  if (hr && !ar) return { team: g.home };
  if (ar && !hr) return { team: g.away };
  if (hr && ar && Math.abs(hr - ar) >= 8) return { team: hr < ar ? g.home : g.away };
  return undefined;
}

function classify(g: Game): FlipItem {
  const l = g.live;
  const period = l?.period ?? 0;
  const home = g.score?.home ?? 0;
  const away = g.score?.away ?? 0;
  const margin = Math.abs(home - away);
  const clock = clockOf(g);
  const half = /half/i.test(clock);
  const late = period >= 4 || (period === 3 && /end/i.test(clock));
  const oneScore = margin <= 8;
  const fav = favorite(g);
  const favScore = fav ? (fav.team === g.home ? home : away) : 0;
  const dogScore = fav ? (fav.team === g.home ? away : home) : 0;
  const upset = fav && dogScore > favScore && period >= 2;
  const ranked = Boolean(g.home.rank || g.away.rank);
  const bothRanked = Boolean(g.home.rank && g.away.rank);

  let reason: string;
  let tone: FlipTone;
  let base: number;
  if (/delay/i.test(clock)) {
    reason = "Delayed";
    tone = "other";
    base = 0;
  } else if (period >= 5) {
    reason = "Overtime";
    tone = "hot";
    base = 300;
  } else if (oneScore && late) {
    reason = margin === 0 ? "Tied, 4th quarter" : "One score, 4th quarter";
    tone = "hot";
    base = 260;
  } else if (upset && fav) {
    reason = `${rankName(fav.team)} trailing${fav.by ? ` (favored by ${fav.by})` : ""}`;
    tone = "upset";
    base = 220;
  } else if (oneScore && period === 3) {
    reason = margin === 0 ? "Tied, 3rd quarter" : "One score, 3rd quarter";
    tone = "close";
    base = 180;
  } else if (bothRanked) {
    reason = "Top 25 vs Top 25";
    tone = "ranked";
    base = 170;
  } else if (ranked && oneScore) {
    reason = `${rankName(g.home.rank ? g.home : g.away)}, one-score game`;
    tone = "ranked";
    base = 150;
  } else if (ranked) {
    reason = `${rankName(g.home.rank ? g.home : g.away)} on the field`;
    tone = "ranked";
    base = 120;
  } else if (oneScore) {
    reason = margin === 0 ? (home === 0 ? "Scoreless" : half ? "Tied at the half" : "Tied") : half ? "One score at the half" : "One-score game";
    tone = "close";
    base = 100;
  } else {
    reason = margin >= 21 && period >= 3 ? "Getting away" : `${margin}-point game`;
    tone = "other";
    base = margin >= 21 && period >= 3 ? 0 : 40;
  }

  const priority = base + flipRank(g) * 0.4 + (g.division === "FBS" ? 60 : 0);
  const wp = l?.homeWinProb;
  const winProb = wp === undefined ? undefined : wp >= 0.5 ? `${g.home.abbr} ${Math.round(wp * 100)}%` : `${g.away.abbr} ${Math.round((1 - wp) * 100)}%`;
  const network = (l?.broadcast || g.network || "").trim();
  return { game: g, reason, tone, clock, network: network && !/no listed/i.test(network) ? network : undefined, winProb, priority };
}

/* ------------------------------------------------------------ popping */

const n = (s: string | undefined) => Number(s ?? 0) || 0;

/** Weight of one box line. Headlines are the shapes lib/espn.ts headline() writes. */
function lineWeight(category: string, h: string): number {
  switch (category) {
    case "passing": {
      const m = h.match(/(\d+) yds, (\d+) TD, (\d+) INT/);
      return m ? n(m[1]) / 25 + n(m[2]) * 4 - n(m[3]) * 3 : 0;
    }
    case "rushing":
    case "receiving": {
      const m = h.match(/(-?\d+) yds, (\d+) TD/);
      return m ? n(m[1]) / 10 + n(m[2]) * 6 : 0;
    }
    case "defensive": {
      const m = h.match(/(\d+) tkl, ([\d.]+) TFL, ([\d.]+) sacks(?:, (\d+) PD)?/);
      return m ? n(m[1]) * 0.8 + n(m[2]) * 2.5 + n(m[3]) * 4 + n(m[4]) * 1.5 : 0;
    }
    case "interceptions": {
      const m = h.match(/(\d+) INT/);
      return m ? n(m[1]) * 7 : 0;
    }
    default:
      return 0;
  }
}

/** A line good enough to call out: 200 pass yds with a TD, 100 rush or rec yds, 2 sacks, a pick, two scores. */
const POP_MIN = 11;

async function poppingFor(games: Game[]): Promise<PopItem[]> {
  const sums = await Promise.all(games.map((g) => liveSummary(g.id).catch(() => undefined)));
  const out: PopItem[] = [];
  games.forEach((g, i) => {
    const s = sums[i];
    if (!s) return;
    for (const p of g.prospects) {
      const lines = s.byPlayer[p.id];
      if (!lines?.length) continue;
      const scored = lines.map((l) => ({ ...l, w: lineWeight(l.category, l.headline) })).filter((l) => l.w > 0);
      const weight = scored.reduce((a, l) => a + l.w, 0);
      // Low radar names (under 55) need a bigger day to make the board, so a 35-yard passer with a rushing TD does not lead it.
      if (weight < ((p.radar?.score ?? 0) >= 55 ? POP_MIN : POP_MIN * 1.6)) continue;
      const team = p.team === g.home.abbr ? g.home : g.away;
      const opp = team === g.home ? g.away : g.home;
      out.push({
        playerId: p.id,
        name: p.name,
        pos: p.pos,
        jersey: p.jersey || undefined,
        team,
        opp,
        game: g,
        radarScore: p.radar?.score,
        draftYear: p.draftYear,
        line: scored
          .sort((a, b) => b.w - a.w)
          .slice(0, 2)
          .map((l) => l.headline)
          .join(" · "),
        weight,
      });
    }
  });
  return out.sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------ board */

export async function rightNow(games: Game[]): Promise<RightNow> {
  const di = games.filter(isDI);
  const liveGames = di.filter((g) => g.status === "live");
  const flips = liveGames.map(classify).sort((a, b) => b.priority - a.priority);
  // Box scores only for games with radar names, FBS first, capped so a 40-game window stays quick.
  const withRadar = flips.map((f) => f.game).filter((g) => g.prospects.length).slice(0, 24);
  const popping = liveGames.length ? await poppingFor(withRadar) : [];
  const now = Date.now();
  const upNext = di
    .filter((g) => g.status === "upcoming" && new Date(g.kickoff).getTime() >= now - 15 * 60_000)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || (a.division === "FBS" ? -1 : 1));
  // Next kickoff window only (games within 30 minutes of the first one), best known names first.
  const first = upNext[0] ? new Date(upNext[0].kickoff).getTime() : 0;
  const window = upNext
    .filter((g) => new Date(g.kickoff).getTime() - first <= 30 * 60_000)
    .sort((a, b) => Number(Boolean(b.home.rank || b.away.rank)) - Number(Boolean(a.home.rank || a.away.rank)) || (a.division === "FBS" ? -1 : 1));
  return { live: liveGames.length, flips, popping, upNext: window };
}
