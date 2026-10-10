/**
 * Opener edges: lock new picks and grade finished ones (src/lib/edges.ts, scripts/lib/edges-run.mts).
 * Run after scripts/lines-espn.mjs so the ledger sees the newest numbers.
 *
 *   node scripts/edges.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const envFile = path.join(root, ".env.local");
const args = [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), tsx, path.join(here, "lib", "edges-run.mts")];
execFileSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
