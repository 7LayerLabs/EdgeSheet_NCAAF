/**
 * Transfer portal context from data/generated/portal.json (scripts/ingest-portal.mjs).
 * Server only: reads the file system. Every row is a CollegeFootballData portal entry
 * matched by name to the ingested roster when possible; nothing is inferred.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

const FILE = path.join(process.cwd(), "data", "generated", "portal.json");

export interface PortalRow {
  /** CFBD athlete id when the player is on the destination's ingested roster, else null. */
  id: string | null;
  name: string;
  position: string | null;
  origin: string | null;
  destination: string | null;
  stars: number | null;
  rating: number | null;
  eligibility: string | null;
  transferDate: string | null;
  season: number;
  onRoster: boolean;
}

function stamp() {
  try {
    return String(statSync(FILE).mtimeMs);
  } catch {
    return "missing";
  }
}

export const portalRows = (): PortalRow[] =>
  memoSync(`portal:rows:${stamp()}`, 3600, () => {
    if (!existsSync(FILE)) return [];
    try {
      return JSON.parse(readFileSync(FILE, "utf8")) as PortalRow[];
    } catch {
      return [];
    }
  });

export const portalLoaded = () => portalRows().length > 0;

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Newest season wins when the same player shows up in both portal years (re-entered). */
function dedupe(rows: PortalRow[]): PortalRow[] {
  const seen = new Set<string>();
  const out: PortalRow[] = [];
  for (const r of [...rows].sort((a, b) => b.season - a.season)) {
    const k = r.id ?? `${norm(r.name)}|${norm(r.destination)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Players now at school A who came from school B, or now at B who came from A, across both portal years. */
export function transfersBetween(schoolA: string, schoolB: string): PortalRow[] {
  const a = norm(schoolA);
  const b = norm(schoolB);
  if (!a || !b || a === b) return [];
  const rows = portalRows().filter((r) => {
    const o = norm(r.origin);
    const d = norm(r.destination);
    return (o === a && d === b) || (o === b && d === a);
  });
  // A 2025 transfer who is not on the current roster has likely moved on again; keep 2026 rows regardless.
  return dedupe(rows.filter((r) => r.onRoster || r.season >= Math.max(...portalRows().map((x) => x.season))));
}

/** Incoming transfers at a school, best pedigree first (rating, then stars). Roster-matched rows first. */
export function notableArrivals(school: string, limit = 8): PortalRow[] {
  const s = norm(school);
  if (!s) return [];
  const rows = portalRows().filter((r) => norm(r.destination) === s);
  return dedupe(rows)
    .sort((x, y) => Number(y.onRoster) - Number(x.onRoster) || (y.rating ?? 0) - (x.rating ?? 0) || (y.stars ?? 0) - (x.stars ?? 0) || y.season - x.season)
    .slice(0, limit);
}

/** Portal row for one athlete id (the newest season), if any. */
export function transferById(id: string): PortalRow | undefined {
  return dedupe(portalRows().filter((r) => r.id === id))[0];
}

/** "arrived from Tennessee in 2025" style note, or undefined when the player is not a recent transfer. */
export function arrivalNote(id: string): string | undefined {
  const r = transferById(id);
  if (!r?.origin) return undefined;
  return `arrived from ${r.origin} in ${r.season}`;
}

/** One sentence per transfer who faces a former team. Empty when nothing on file. */
export function portalStorylines(home: string, away: string): string[] {
  const rows = transfersBetween(home, away);
  return rows.map((r) => {
    const pos = r.position ? `${r.position} ` : "";
    return `${pos}${r.name} (${r.origin} transfer, ${r.season}) faces his former team.`;
  });
}
