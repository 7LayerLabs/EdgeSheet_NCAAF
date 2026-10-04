/**
 * Weekly snapshot: freezes every radar player's score, tier, production,
 * pedigree, usage, and draft class, plus every forecast entry's band, overall,
 * and estimated pick, to data/snapshots/<YYYY-MM-DD>/{radar.json, forecast.json}.
 * src/lib/movement.ts compares the last two to find risers and fallers.
 *
 *   npm run snapshot                 # today's date (Eastern)
 *   SNAPSHOT_DATE=2026-10-06 npm run snapshot
 *
 * Run it every Monday after the week's game logs are ingested:
 *   npm run ingest:gamelogs && npm run snapshot
 * PM2 cron (Monday 6:30 AM Eastern):
 *   pm2 start "npm run ingest:gamelogs && npm run snapshot" --name scout-snapshot --cron "30 6 * * 1" --no-autorestart
 *
 * The TypeScript side lives in src/lib/snapshot.ts and runs through tsx.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
execFileSync(process.execPath, [tsx, path.join(here, "lib", "snapshot-run.mts")], { cwd: root, stdio: "inherit", env: process.env });
