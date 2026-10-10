/**
 * Hourly refresh, in order: season stats from ESPN box scores, our Elo, ESPN/DraftKings lines,
 * then lock and grade opener edges. Each step runs in its own process; a failure is logged and
 * the next step still runs.
 *
 *   node scripts/hourly.mjs
 *   pm2 start scripts/hourly.mjs --name ncaa-hourly --cron "20 * * * *" --no-autorestart
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
for (const step of ["ingest-espn.mjs", "ingest-elo.mjs", "lines-espn.mjs", "edges.mjs"]) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, step)], { cwd: root, stdio: "inherit", env: process.env, timeout: 15 * 60_000 });
  console.log(`[hourly] ${step} ${r.status === 0 ? "ok" : `failed (${r.status ?? r.signal})`} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
