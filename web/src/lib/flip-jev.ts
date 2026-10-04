/**
 * Jev flip ranking: one Score per live game, one request for the whole slate, cached 60s.
 * "How worth switching to right now for a neutral fan who wants drama." Levels are concrete
 * situations so the answer is comparable across games. Code turns the Score into 0..100 and
 * the Slate "Flip to" filter and the ticker use it ahead of the numeric flipScore when present.
 *
 * Lives outside live.ts on purpose: live.ts is imported by client components and this file
 * needs the server-only Jev client.
 */
import { batchScores, jevAvailable } from "./jev";
import { flipScore } from "./live";
import { memo } from "./memo";
import type { Game } from "./types";

export const FLIP_LEVELS = [
  "Blowout: the outcome is settled. The trailing team has no realistic path and the starters may be out.",
  "Comfortable: one team leads by two scores or more and is in control, but there is enough time that a rally is still possible.",
  "Competitive: within two scores with real time left. Either team can win but nothing is being decided on this drive.",
  "Tight late: a one score game in the fourth quarter or late in the third, every possession matters.",
  "Deciding moment: the next play or drive decides the game. Two minute drill down one score, overtime, goal line stand, onside kick, a go-ahead drive in the final minutes.",
] as const;

export interface FlipJudgment {
  gameId: string;
  /** 0..100, from the Score position (0..4) scaled, so 100 = deciding moment. */
  flip: number;
  /** Raw Score level, 0..4, may fall between levels. */
  level: number;
  confidence: number;
  probabilities: number[];
}

function stateFor(g: Game) {
  const l = g.live!;
  const home = g.home;
  const away = g.away;
  const spread = g.market.spread ? `${g.market.spread.team} ${g.market.spread.line > 0 ? "+" : ""}${g.market.spread.line}` : "no line";
  return {
    matchup: `${away.short}${away.rank ? ` (No. ${away.rank})` : ""} at ${home.short}${home.rank ? ` (No. ${home.rank})` : ""}`,
    score: g.score ? `${away.abbr} ${g.score.away}, ${home.abbr} ${g.score.home}` : "score not posted",
    period: l.period,
    clock: l.clock,
    situation: [l.possession ? `${l.possession} has the ball` : "", l.downDistance ?? "", l.lastPlay ? `last play: ${l.lastPlay.slice(0, 160)}` : ""].filter(Boolean).join(". ") || "not available",
    home_win_probability: l.homeWinProb === undefined ? "not available" : `${Math.round(l.homeWinProb * 100)}% ${home.abbr}`,
    win_probability_swing_recent: l.swing === undefined ? "not available" : `${Math.round(Math.abs(l.swing) * 100)} points over the last ${l.swingMinutes ?? "few"} minutes`,
    pregame_spread: spread,
  };
}

/** Jev flip ranking for the live games in the list. Keyed by game id. Empty map when Jev is off or nothing is live. */
export async function flipScoreJev(games: Game[]): Promise<Record<string, FlipJudgment>> {
  const live = games.filter((g) => g.status === "live" && g.live);
  if (!live.length || !jevAvailable()) return {};
  const key = `jev:flip:${live.map((g) => `${g.id}:${g.score?.away ?? "-"}-${g.score?.home ?? "-"}:${g.live!.period}`).join("|")}`;
  return memo(key, 60, async () => {
    const out: Record<string, FlipJudgment> = {};
    try {
      const rows = await batchScores(
        live.map(stateFor),
        "For a neutral college football fan who wants drama, how worth switching to right now is the game described in ITEM? Judge the live situation: score, period and clock, who has the ball, win probability and its recent swing.",
        FLIP_LEVELS,
        { purpose: "flip", ref: `${live.length} live`, timeoutMs: 4000 },
      );
      if (!rows) return out;
      rows.forEach((r, i) => {
        const g = live[i];
        if (!r.probabilities.length) return;
        // Scale the Score (0..4) to 0..100 and use the numeric flip score as a 5-point tiebreak so equal levels still order by closeness and swing.
        const flip = Math.round(Math.min(100, r.unit * 95 + (flipScore(g) / 100) * 5));
        out[g.id] = { gameId: g.id, flip, level: r.score, confidence: r.confidence, probabilities: r.probabilities };
      });
    } catch {}
    return out;
  });
}

/** Return the same games with `live.flipJev` filled in where Jev answered. Never throws. */
export async function withFlipJev(games: Game[]): Promise<Game[]> {
  const flips = await flipScoreJev(games).catch(() => ({}) as Record<string, FlipJudgment>);
  if (!Object.keys(flips).length) return games;
  return games.map((g) => (g.live && flips[g.id] ? { ...g, live: { ...g.live, flipJev: flips[g.id].flip } } : g));
}
