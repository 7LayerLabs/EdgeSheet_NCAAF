/**
 * Server-side mirror of the browser watchlist. The watchlist itself lives in
 * localStorage (src/lib/watchlist.ts); every toggle also POSTs the full list to
 * /api/follows, which writes data/follows.json. The Telegram bot reads this
 * file for kickoff reminders (teams) and radar alerts (players).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "follows.json");

export interface Follows {
  /** School names as CollegeFootballData spells them. */
  teams: string[];
  /** CFBD athlete ids. */
  players: string[];
  /** Game ids. */
  games: string[];
  updatedAt?: string;
}

const EMPTY: Follows = { teams: [], players: [], games: [] };

export function readFollows(): Follows {
  if (!existsSync(FILE)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Follows>;
    return {
      teams: Array.isArray(raw.teams) ? raw.teams.map(String) : [],
      players: Array.isArray(raw.players) ? raw.players.map(String) : [],
      games: Array.isArray(raw.games) ? raw.games.map(String) : [],
      updatedAt: raw.updatedAt,
    };
  } catch {
    return { ...EMPTY };
  }
}

const clean = (xs: unknown, max = 500) =>
  Array.isArray(xs) ? [...new Set(xs.filter((x) => typeof x === "string" && x.length <= 80).map(String))].slice(0, max) : [];

export function writeFollows(input: Partial<Follows>): Follows {
  const next: Follows = {
    teams: clean(input.teams),
    players: clean(input.players),
    games: clean(input.games),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 1));
  return next;
}
