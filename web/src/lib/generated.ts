/**
 * Reads the digests written by scripts/ingest.mjs. Missing files are not an
 * error: the site degrades to schedule-level coverage and says so.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

const DIR = path.join(process.cwd(), "data", "generated");

export interface GenPlayer {
  id: string;
  n: string; // name
  t: string; // school
  c: "fbs" | "fcs" | "ii" | "iii" | null;
  cf: string | null; // conference
  p: string | null; // position
  y: number | null; // 1 Fr, 2 So, 3 Jr, 4 Sr
  h: number | null; // inches
  w: number | null; // lbs
  j: number | null; // jersey
  g: number | null; // team games played
  s: Record<string, number> | null; // season stats, see ingest STAT_KEYS
  u: { o: number; pa: number; ru: number; pd: number; td: number } | null; // usage shares
  r: { st: number | null; rt: number | null; rk: number | null; yr: number } | null; // recruiting
  home: string | null;
}

export interface GenUnit {
  plays: number; drives: number; ppa: number; sr: number; ex: number; power: number; stuff: number;
  ly: number; sly: number; ofy: number; ppo: number;
  havoc: number | null; havocF7: number | null; havocDB: number | null;
  sdSr: number | null; pdSr: number | null; pdEx: number | null;
  rushRate: number | null; rushSr: number | null; rushEx: number | null; rushPpa: number | null;
  passRate: number | null; passSr: number | null; passEx: number | null; passPpa: number | null;
}

export interface GenTeam {
  team: string;
  conf: string | null;
  c: "fbs" | "fcs" | "ii" | "iii" | null;
  games: number | null;
  off: GenUnit;
  def: GenUnit;
}

export interface GenDraftPick {
  year: number; round: number; pick: number; overall: number; name: string; pos: string; college: string; conf: string | null;
  nfl: string; h: number | null; w: number | null; grade: number | null; prerank: number | null; collegeAthleteId: number | null;
}

export interface GenMeta {
  ingestedAt: string;
  season: number;
  players: number;
  teams: number;
  draftPicks: number;
  recruits: number;
}

function readJson<T>(file: string, fallback: T): T {
  const f = path.join(DIR, file);
  if (!existsSync(f)) return fallback;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Cache key includes the file mtime so a fresh ingest is picked up without a restart. */
function stamp(file: string) {
  try {
    return String(statSync(path.join(DIR, file)).mtimeMs);
  } catch {
    return "missing";
  }
}

export const genMeta = (): GenMeta | undefined => memoSync(`gen:meta:${stamp("meta.json")}`, 300, () => readJson<GenMeta | undefined>("meta.json", undefined));
export const genPlayers = (): GenPlayer[] => memoSync(`gen:players:${stamp("players.json")}`, 3600, () => readJson<GenPlayer[]>("players.json", []));
export const genTeams = (): GenTeam[] => memoSync(`gen:teams:${stamp("teams.json")}`, 3600, () => readJson<GenTeam[]>("teams.json", []));
export const genDraft = (): GenDraftPick[] => memoSync(`gen:draft:${stamp("draft.json")}`, 3600, () => readJson<GenDraftPick[]>("draft.json", []));
export const generatedLoaded = () => genMeta() !== undefined && genPlayers().length > 0;
