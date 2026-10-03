/**
 * Field orientation from data/generated/stadiums.json (scripts/ingest-stadiums.mjs,
 * OpenStreetMap polygons) plus the pure math that turns a forecast wind
 * direction and a field bearing into a wind component. Server only (reads disk).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

const FILE = path.join(process.cwd(), "data", "generated", "stadiums.json");

export type BearingConfidence = "high" | "medium" | "low" | "none";
export type WindComponent = "crosswind" | "down the field" | "quartering";

export interface StadiumRow {
  venueId: number;
  name: string;
  lat: number;
  lon: number;
  osmId: number | null;
  osmType: string | null;
  /** 0..180 degrees, the axis the field runs along. null when not found. */
  bearing: number | null;
  confidence: BearingConfidence;
  source: string;
  fetchedAt: string;
}

function stamp() {
  try {
    return String(statSync(FILE).mtimeMs);
  } catch {
    return "missing";
  }
}

const index = (): Map<number, StadiumRow> =>
  memoSync(`stadiums:index:${stamp()}`, 3600, () => {
    const m = new Map<number, StadiumRow>();
    if (!existsSync(FILE)) return m;
    try {
      for (const r of JSON.parse(readFileSync(FILE, "utf8")) as StadiumRow[]) m.set(r.venueId, r);
    } catch {}
    return m;
  });

export const stadiumsLoaded = () => index().size > 0;

/** Field bearing for a CFBD venue id, when OpenStreetMap had a usable polygon. */
export function fieldBearing(venueId: number | null | undefined): { bearing: number; confidence: Exclude<BearingConfidence, "none"> } | undefined {
  if (venueId == null) return undefined;
  const r = index().get(venueId);
  if (!r || r.bearing == null || r.confidence === "none") return undefined;
  return { bearing: r.bearing, confidence: r.confidence };
}

const POINTS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** NWS compass text ("NW", "nnw") to degrees the wind blows FROM. Undefined for calm or unknown text. */
export function compassToDegrees(dir: string | null | undefined): number | undefined {
  if (!dir) return undefined;
  const k = dir.trim().toUpperCase();
  if (k in POINTS) return POINTS[k];
  const n = Number(k);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : undefined;
}

/** Degrees to the nearest of 8 compass points. */
export function degreesToCompass(deg: number): string {
  const pts = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** "NE to SW" for a field axis bearing. */
export function axisLabel(bearing: number): string {
  const a = ((bearing % 180) + 180) % 180;
  return `${degreesToCompass(a)} to ${degreesToCompass(a + 180)}`;
}

/** Angle (0..90) between the wind line and the field axis. 0 = straight down the field, 90 = square across it. */
export function angleToAxis(windFromDeg: number, bearing: number): number {
  const d = Math.abs(((windFromDeg - bearing) % 180) + 180) % 180;
  return d > 90 ? 180 - d : d;
}

/** Within 30 degrees of perpendicular = crosswind; within 30 of the axis = down the field; else quartering. */
export function windComponent(windFromDeg: number, bearing: number): WindComponent {
  const a = angleToAxis(windFromDeg, bearing);
  if (a >= 60) return "crosswind";
  if (a <= 30) return "down the field";
  return "quartering";
}

/** Plain-English fragment for the Conditions line: "mostly across the field", "straight down the field", "at an angle to the field". */
export function componentPhrase(c: WindComponent): string {
  return c === "crosswind" ? "mostly across the field" : c === "down the field" ? "straight down the field" : "at an angle to the field";
}
