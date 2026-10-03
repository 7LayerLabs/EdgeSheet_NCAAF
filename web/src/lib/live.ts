/**
 * Pure helpers for the live overlay. No fetch, no node modules, safe to import
 * from client components.
 */
import type { Game } from "./types";

export type LiveInfo = NonNullable<Game["live"]>;

/**
 * Flip score, 0 to 100: which live game to switch to right now. Half is how
 * close the game is (win probability near 50%), half is how much the win
 * probability moved in the last 10 to 15 minutes. A game with no probability
 * yet scores on nothing, so it sinks. Final games score 0.
 */
export function flipScore(g: Game): number {
  if (g.status !== "live" || !g.live) return 0;
  const l = g.live;
  const closeness = l.closeness ?? 0;
  const swing = Math.abs(l.swing ?? 0);
  // Late and close beats early and close: the fourth quarter weighs 1.5x.
  const late = l.period >= 4 ? 1.5 : l.period === 3 ? 1.2 : 1;
  return Math.round(Math.min(100, (closeness * 60 + Math.min(swing, 0.4) * 100) * late));
}

/** "TENN 61%" plus the swing, phrased from the leading side's point of view. */
export function winProbLine(g: Game): { team: string; pct: number; swing?: number; minutes?: number } | undefined {
  const l = g.live;
  if (!l || l.homeWinProb === undefined) return undefined;
  const homeLeads = l.homeWinProb >= 0.5;
  const pct = Math.round((homeLeads ? l.homeWinProb : 1 - l.homeWinProb) * 100);
  const swing = l.swing === undefined ? undefined : Math.round((homeLeads ? l.swing : -l.swing) * 100);
  return { team: homeLeads ? g.home.abbr : g.away.abbr, pct, swing, minutes: l.swingMinutes };
}

export function anyLive(games: Game[]): boolean {
  return games.some((g) => g.status === "live");
}
