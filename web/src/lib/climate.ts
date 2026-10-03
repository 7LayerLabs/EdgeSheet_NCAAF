/**
 * Weather baselines from data/generated/climate.json (scripts/ingest-climate.mjs,
 * Open-Meteo archive, five full years of hourly data per Division I venue).
 * Server only (reads disk). baseline() answers "what is typical here, this week, at this hour".
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";
import type { WeatherInput } from "./types";

const FILE = path.join(process.cwd(), "data", "generated", "climate.json");

/** [p10 temp, median temp, p90 temp, mean wind mph, sample hours] */
type Bucket = [number, number, number, number | null, number];

interface WeekDigest {
  h: Partial<Record<"12" | "16" | "20", Bucket>>;
  rainDays: number;
  days: number;
  rainYears: number;
}

export interface ClimateRow {
  venueId: number;
  name: string;
  lat: number;
  lon: number;
  tz: string | null;
  years: number[];
  weeks: Record<string, WeekDigest>;
  fetchedAt: string;
}

export interface ClimateBaseline {
  venueId: number;
  /** Fahrenheit, 10th to 90th percentile for this week and hour bucket. */
  tempLoF: number;
  tempHiF: number;
  tempMedianF: number;
  windMeanMph: number | null;
  /** Years (of yearsSampled) in which this calendar week had at least one rainy afternoon or evening. */
  rainYears: number;
  yearsSampled: number;
  /** Share of days in this week, across the sampled years, with at least 0.04 in of rain between noon and midnight. */
  rainDayPct: number;
  /** "early October" */
  periodLabel: string;
  /** "noon", "late afternoon", "night" */
  hourLabel: string;
  /** Local hour at the venue the kickoff falls in. */
  localHour: number;
  sampleHours: number;
}

function stamp() {
  try {
    return String(statSync(FILE).mtimeMs);
  } catch {
    return "missing";
  }
}

const index = (): Map<number, ClimateRow> =>
  memoSync(`climate:index:${stamp()}`, 3600, () => {
    const m = new Map<number, ClimateRow>();
    if (!existsSync(FILE)) return m;
    try {
      for (const r of JSON.parse(readFileSync(FILE, "utf8")) as ClimateRow[]) m.set(r.venueId, r);
    } catch {}
    return m;
  });

export const climateLoaded = () => index().size > 0;

function localParts(iso: string, tz: string | null): { month: number; day: number; hour: number; year: number } {
  const d = new Date(iso);
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "America/New_York", hour12: false, year: "numeric", month: "numeric", day: "numeric", hour: "numeric" });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24 };
  } catch {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours() };
  }
}

/** Same week index the ingest uses: 0-based day of year over 7, capped at 52. */
function weekIndex(y: number, m: number, d: number): number {
  const day = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  return Math.min(52, Math.floor(day / 7));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function periodLabel(month: number, day: number): string {
  const part = day <= 10 ? "early" : day <= 20 ? "mid" : "late";
  return `${part} ${MONTHS[month - 1]}`;
}

export function baseline(venueId: number | null | undefined, kickoffIso: string): ClimateBaseline | undefined {
  if (venueId == null) return undefined;
  const row = index().get(venueId);
  if (!row) return undefined;
  const { year, month, day, hour } = localParts(kickoffIso, row.tz);
  const wk = row.weeks[String(weekIndex(year, month, day))];
  if (!wk) return undefined;
  const key = hour >= 20 ? "20" : hour >= 16 ? "16" : "12";
  const b = wk.h[key] ?? wk.h["12"] ?? wk.h["16"] ?? wk.h["20"];
  if (!b) return undefined;
  return {
    venueId,
    tempLoF: b[0],
    tempMedianF: b[1],
    tempHiF: b[2],
    windMeanMph: b[3],
    rainYears: wk.rainYears,
    yearsSampled: row.years.length,
    rainDayPct: wk.days ? Math.round((wk.rainDays / wk.days) * 100) : 0,
    periodLabel: periodLabel(month, day),
    hourLabel: key === "20" ? "at night" : key === "16" ? "in the late afternoon" : "around midday",
    localHour: hour,
    sampleHours: b[4],
  };
}

/** How today's forecast compares with the baseline, in plain words. Empty when it sits inside the usual range. */
export function compareToBaseline(w: WeatherInput, b: ClimateBaseline): string[] {
  const out: string[] = [];
  if (w.tempF > b.tempHiF) out.push("warmer than usual");
  else if (w.tempF < b.tempLoF) out.push("colder than usual");
  if (b.windMeanMph != null) {
    if (w.windMph >= b.windMeanMph * 1.6 && w.windMph - b.windMeanMph >= 5) out.push("windier than usual");
    else if (w.windMph <= b.windMeanMph * 0.5 && b.windMeanMph >= 6) out.push("calmer than usual");
  }
  if (w.precipChance >= 50 && b.rainDayPct < 25) out.push("wetter than usual");
  return out;
}

/** One line for the Conditions section. */
export function baselineLine(b: ClimateBaseline, w?: WeatherInput): string {
  const rain =
    b.rainYears === 0
      ? `no rain in the last ${b.yearsSampled} years`
      : `rain ${b.rainYears} ${b.rainYears === 1 ? "year" : "years"} in ${b.yearsSampled}`;
  const wind = b.windMeanMph != null ? `, wind ${Math.round(b.windMeanMph)} mph` : "";
  let s = `Typical for this stadium in ${b.periodLabel} ${b.hourLabel}: ${b.tempLoF} to ${b.tempHiF} degrees${wind}, ${rain}.`;
  if (w) {
    const diffs = compareToBaseline(w, b);
    s += diffs.length ? ` Today's forecast is ${diffs.join(" and ")}.` : " Today's forecast is in the usual range.";
  }
  return s;
}
