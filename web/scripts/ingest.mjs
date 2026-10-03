/**
 * Ingest: pull the big, slow-moving CollegeFootballData sets once and write
 * compact digests to data/generated/. The site reads those instantly.
 *
 *   node scripts/ingest.mjs            # uses CFBD_API_KEY from .env.local or the environment
 *
 * Writes:
 *   data/generated/players.json   every player with a stat line, a recruiting grade, or a key-position roster spot
 *   data/generated/teams.json     team advanced tendencies (offense and defense) for FBS and FCS
 *   data/generated/draft.json     NFL draft picks for the last three drafts
 *   data/generated/meta.json      timestamps and counts
 *
 * The digest shapes live in scripts/lib/digest.mjs and are shared with scripts/backtest.mjs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, makeGet, digestPlayers, digestTeams, digestDraft } from "./lib/digest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");

const KEY = await loadKey(root);
if (!KEY) {
  console.error("ingest: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const get = makeGet(KEY, log);

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
log("season", season);

/* ----------------------------------------------------------- fetch all */
const [teams, roster, stats, usage, records, advFbs] = await Promise.all([
  get(`/teams?year=${season}`),
  get(`/roster?year=${season}`),
  get(`/stats/player/season?year=${season}`),
  get(`/player/usage?year=${season}`, { optional: true }),
  get(`/records?year=${season}`, { optional: true }),
  get(`/stats/season/advanced?year=${season}`, { optional: true }),
]);
log("teams", teams.length, "roster", roster.length, "stat rows", stats.length, "usage", usage.length, "adv FBS", advFbs.length);

// Recruiting classes that can still be on a roster: five classes back through this season's true freshmen.
const classYears = [season - 4, season - 3, season - 2, season - 1, season];
const recruiting = (await Promise.all(classYears.map((y) => get(`/recruiting/players?year=${y}&classification=HighSchool`, { optional: true })))).flat();
log("recruits", recruiting.length);

// Advanced tendencies are FBS-only on the free tier (FCS calls return empty). Keep the hook so a paid key can extend it.
const advFcs = [];

const draftYears = [season, season - 1, season - 2, season - 3, season - 4];
const draft = (await Promise.all(draftYears.map((y) => get(`/draft/picks?year=${y}`, { optional: true })))).flat();
log("draft picks", draft.length);

/* ------------------------------------------------------------- digest */
const { players, kept } = digestPlayers({ teams, roster, stats, usage, records, recruiting });
log("players kept", kept, "of", roster.length);

const teamsOut = digestTeams({ teams, records, advFbs, advFcs });
const draftOut = digestDraft(draft);

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "players.json"), JSON.stringify(players));
await writeFile(path.join(OUT, "teams.json"), JSON.stringify(teamsOut));
await writeFile(path.join(OUT, "draft.json"), JSON.stringify(draftOut));
await writeFile(
  path.join(OUT, "meta.json"),
  JSON.stringify({ ingestedAt: new Date().toISOString(), season, players: players.length, teams: teamsOut.length, draftPicks: draftOut.length, recruits: recruiting.length }, null, 2),
);
log("wrote", OUT);
