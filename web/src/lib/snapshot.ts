/**
 * Writes one weekly snapshot of the radar and the forecast board to
 * data/snapshots/<YYYY-MM-DD>/{radar.json, forecast.json}. movement.ts reads
 * them back. Called by scripts/snapshot.mjs; server-only (node:fs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { genMeta } from "./generated";
import { gamelogsMeta } from "./adjusted";
import { radarIndex } from "./radar";
import { forecastNextDraft } from "./forecast";
import { SNAPSHOT_DIR, type ForecastSnapshot, type RadarSnapshot } from "./movement";

function today(): string {
  // Eastern date, so a Monday 6 AM cron and a late Sunday run land on the same calendar day the user expects.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function writeSnapshot(date = today()): { date: string; dir: string; players: number; entries: number } {
  const idx = radarIndex();
  const fc = forecastNextDraft();
  const takenAt = new Date().toISOString();
  const radar: RadarSnapshot = {
    takenAt,
    date,
    season: genMeta()?.season ?? null,
    ingestedAt: genMeta()?.ingestedAt ?? null,
    gamelogsAt: gamelogsMeta()?.ingestedAt ?? null,
    players: idx.all.map((p) => ({
      id: p.id, name: p.name, team: p.team, pos: p.pos, group: p.group, cls: p.cls, classification: p.classification, draftClass: p.draftClass,
      score: p.score, tier: p.tier, production: p.production, pedigree: p.pedigree, usage: p.usage,
    })),
  };
  const forecast: ForecastSnapshot = {
    takenAt,
    date,
    draftYear: fc.draftYear,
    entries: fc.board.map((e) => ({
      id: e.player.id, name: e.player.name, team: e.player.team, pos: e.player.pos, group: e.player.group,
      band: e.band, overall: e.overall, posRank: e.posRank, estPick: e.estPick, adjusted: e.adjusted, decision: e.decision,
    })),
  };
  const dir = path.join(SNAPSHOT_DIR, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "radar.json"), JSON.stringify(radar));
  writeFileSync(path.join(dir, "forecast.json"), JSON.stringify(forecast));
  return { date, dir, players: radar.players.length, entries: forecast.entries.length };
}
