import file from "@/data/prospects.json";
import type { Prospect, ProspectTier } from "./types";

/** A curated prospect row, keyed by CollegeFootballData school name. */
export interface ProspectRow extends Omit<Prospect, "team" | "tier"> {
  team: string; // school name as CFBD spells it
  tier: ProspectTier;
}

interface ProspectFile {
  asOf: string;
  sources: string[];
  players: ProspectRow[];
}

const data = file as unknown as ProspectFile;

export const prospectFileLoaded = data.players.length > 0;
export const prospectFileAsOf = data.asOf;

const byTeam = new Map<string, ProspectRow[]>();
for (const p of data.players) byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);

export function prospectsForTeam(school: string): ProspectRow[] {
  return byTeam.get(school) ?? [];
}

export function prospectRowById(id: string): ProspectRow | undefined {
  return data.players.find((p) => p.id === id);
}
