/**
 * EdgeSheet's own Elo (scripts/ingest-elo.mjs, rule in scripts/lib/elo.mjs), used only when
 * CollegeFootballData's pregame Elo is missing (the free quota ran out, or ESPN is the schedule
 * source). Fitted to reproduce CFBD's ratings: within 0.5 to 0.7 spread points over a season.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

interface EloFile {
  asOf: string;
  season: number;
  ratings: Record<string, number>;
  byId: Record<string, string>;
  games: Record<string, { h: number | null; a: number | null }>;
}

const FILE = path.join(process.cwd(), "data", "generated", "elo.json");

function load(): EloFile | undefined {
  if (!existsSync(FILE)) return undefined;
  return memoSync(`elo:${statSync(FILE).mtimeMs}`, 3600, () => {
    try {
      return JSON.parse(readFileSync(FILE, "utf8")) as EloFile;
    } catch {
      return undefined;
    }
  });
}

export const eloAsOf = () => load()?.asOf;

/**
 * Pregame ratings for one game: the recorded pregame values once the game is final,
 * otherwise each team's current rating. Teams are looked up by id first, then by school.
 */
export function ourPregameElo(gameId: string, home: { id?: number; school: string }, away: { id?: number; school: string }): { home: number | null; away: number | null } {
  const f = load();
  if (!f) return { home: null, away: null };
  const played = f.games[gameId];
  if (played) return { home: played.h, away: played.a };
  const rating = (t: { id?: number; school: string }) => {
    const school = (t.id != null ? f.byId[String(t.id)] : undefined) ?? t.school;
    return f.ratings[school] ?? null;
  };
  return { home: rating(home), away: rating(away) };
}

/** A school's current rating in our Elo, or null when unrated (FCS and below). */
export function teamElo(school: string): number | null {
  return load()?.ratings[school] ?? null;
}
