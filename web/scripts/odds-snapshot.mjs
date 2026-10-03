/**
 * One Odds API snapshot for this week's Division I games that have not kicked off.
 *
 *   node scripts/odds-snapshot.mjs            # 1 Odds API call (3 credits) + 4 CFBD calls
 *   node scripts/odds-snapshot.mjs --dry      # 0 credits: lists events via the free /events endpoint and reports matches
 *   node scripts/odds-snapshot.mjs --reserve 60   # refuse to spend when fewer than 60 credits remain (default 40)
 *
 * Appends to data/odds/<season>/<gameId>.json and records quota headers in data/odds/usage.json.
 * Budget: every 4 hours on Wed through Sat is 24 calls a week, 72 credits, about 310 a month,
 * leaving room for game-page refreshes and a few props pulls inside the 500 free credits.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendSnapshot, fetchEventList, fetchSlateOdds, isoWindow, matchEvents, readUsage } from "../src/lib/odds-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const reserveArg = args.indexOf("--reserve");
const RESERVE = reserveArg >= 0 ? Number(args[reserveArg + 1]) : Number(process.env.ODDS_RESERVE ?? 40);

async function loadEnv() {
  try {
    const env = await readFile(path.join(root, ".env.local"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
await loadEnv();

const CFBD = process.env.CFBD_API_KEY;
const ODDS = process.env.ODDS_API_KEY;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!CFBD) {
  console.error("odds-snapshot: CFBD_API_KEY missing (needed to know the slate). Nothing written.");
  process.exit(0);
}
if (!ODDS) {
  console.error("odds-snapshot: ODDS_API_KEY missing. Add it to .env.local. Nothing written.");
  process.exit(0);
}

async function cfbd(pathname, attempt = 0) {
  const res = await fetch(`https://api.collegefootballdata.com${pathname}`, { headers: { Authorization: `Bearer ${CFBD}`, Accept: "application/json" } });
  if (res.status === 429 && attempt < 4) {
    await sleep(1500 * (attempt + 1));
    return cfbd(pathname, attempt + 1);
  }
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

const now = new Date();
const season = Number(process.env.SEASON ?? (now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear()));
const cal = await cfbd(`/calendar?year=${season}`);
const nowIso = now.toISOString();
const week = cal.find((w) => w.startDate <= nowIso && nowIso <= w.endDate) ?? cal.find((w) => w.startDate > nowIso) ?? cal[cal.length - 1];
if (!week) {
  log("no calendar week; nothing to do");
  process.exit(0);
}
log("season", season, "week", week.week, week.seasonType);

const games = [];
for (const cls of ["fbs", "fcs"]) {
  await sleep(400);
  const rows = await cfbd(`/games?year=${season}&week=${week.week}&seasonType=${week.seasonType}&classification=${cls}`);
  games.push(...rows);
}
await sleep(400);
const teams = await cfbd(`/teams?year=${season}`);
const teamsBySchool = new Map(teams.map((t) => [t.school, { school: t.school, mascot: t.mascot, abbreviation: t.abbreviation }]));

const open = games.filter((g) => !g.completed && Date.parse(g.startDate) > Date.now() - 4 * 3600 * 1000);
log("D1 games this week", games.length, "not yet final", open.length);
const refs = open.map((g) => ({ id: String(g.id), home: g.homeTeam, away: g.awayTeam, kickoff: g.startDate }));

const usage = readUsage(root);
if (!DRY && usage.remaining !== undefined && usage.remaining <= RESERVE) {
  log(`quota ${usage.remaining} credits left, reserve is ${RESERVE}; not spending. Use --reserve to lower it.`);
  process.exit(0);
}

const events = DRY ? await fetchEventList(ODDS) : await fetchSlateOdds(root, ODDS, isoWindow(now));
log("Odds API events", events.length, DRY ? "(dry: no odds, no credits)" : "");

const matches = matchEvents(refs, events, teamsBySchool);
let appended = 0;
let unchanged = 0;
for (const r of refs) {
  const m = matches.get(r.id);
  if (!m) continue;
  if (DRY) {
    log(`match ${r.away} @ ${r.home}  <-  ${m.event.away_team} @ ${m.event.home_team}${m.swapped ? " (swapped)" : ""}  score ${m.score.toFixed(1)}`);
    continue;
  }
  const { appended: did } = appendSnapshot(root, { season, gameId: r.id, home: r.home, away: r.away, kickoff: r.kickoff, event: m.event, swapped: m.swapped, at: nowIso });
  if (did) appended++;
  else unchanged++;
}
const unmatchedEvents = events.filter((e) => ![...matches.values()].some((m) => m.event.id === e.id));
log("matched", matches.size, "of", refs.length, "games;", unmatchedEvents.length, "events had no game");
for (const e of unmatchedEvents.slice(0, 15)) log("  no match:", e.away_team, "@", e.home_team, e.commence_time);
if (!DRY) {
  const u = readUsage(root);
  log("appended", appended, "unchanged", unchanged, `credits remaining ${u.remaining ?? "unknown"}, used ${u.used ?? "unknown"}`);
}
