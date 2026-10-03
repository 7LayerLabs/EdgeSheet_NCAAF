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
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "data", "generated");
const BASE = "https://api.collegefootballdata.com";

async function loadKey() {
  if (process.env.CFBD_API_KEY) return process.env.CFBD_API_KEY;
  try {
    const env = await readFile(path.join(root, ".env.local"), "utf8");
    const m = env.match(/^CFBD_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return undefined;
}

const KEY = await loadKey();
if (!KEY) {
  console.error("ingest: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, { optional = false, attempt = 0 } = {}) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if (res.status === 429 && attempt < 4) {
    await sleep(1500 * (attempt + 1));
    return get(pathname, { optional, attempt: attempt + 1 });
  }
  if (!res.ok) {
    if (optional) {
      log("skip", pathname, res.status);
      return [];
    }
    throw new Error(`${pathname} -> ${res.status}`);
  }
  return res.json();
}

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

const draftYears = [season, season - 1, season - 2];
const draft = (await Promise.all(draftYears.map((y) => get(`/draft/picks?year=${y}`, { optional: true })))).flat();
log("draft picks", draft.length);

/* ------------------------------------------------------------- digest */
const teamByName = new Map(teams.map((t) => [t.school, t]));
const gamesByTeam = new Map(records.map((r) => [r.team, r.total?.games ?? 0]));

const recruitById = new Map();
const recruitByAthlete = new Map();
for (const r of recruiting) {
  const row = { stars: r.stars ?? null, rating: r.rating ?? null, rank: r.ranking ?? null, year: r.year, pos: r.position ?? null };
  recruitById.set(String(r.id), row);
  if (r.athleteId) recruitByAthlete.set(String(r.athleteId), row);
}

const STAT_KEYS = {
  "passing.ATT": "pa", "passing.COMPLETIONS": "pc", "passing.YDS": "py", "passing.TD": "ptd", "passing.INT": "pint", "passing.YPA": "ypa",
  "rushing.CAR": "ra", "rushing.YDS": "ry", "rushing.TD": "rtd", "rushing.YPC": "ypc", "rushing.LONG": "rlg",
  "receiving.REC": "rec", "receiving.YDS": "rcy", "receiving.TD": "rctd", "receiving.YPR": "ypr", "receiving.LONG": "rclg",
  "defensive.TOT": "tk", "defensive.SOLO": "solo", "defensive.TFL": "tfl", "defensive.SACKS": "sk", "defensive.PD": "pd", "defensive.QB HUR": "hur", "defensive.TD": "dtd",
  "interceptions.INT": "int", "interceptions.YDS": "inty",
  "fumbles.FUM": "fum", "fumbles.LOST": "fl", "fumbles.REC": "fr",
  "kicking.FGM": "fgm", "kicking.FGA": "fga", "kicking.LONG": "fglg", "kicking.PCT": "fgp",
  "punting.NO": "pno", "punting.YPP": "ypp", "punting.In 20": "pin20",
  "kickReturns.YDS": "kry", "kickReturns.TD": "krtd", "kickReturns.AVG": "kravg",
  "puntReturns.YDS": "pry", "puntReturns.TD": "prtd", "puntReturns.AVG": "pravg",
};

const statsByPlayer = new Map();
for (const row of stats) {
  const key = STAT_KEYS[`${row.category}.${row.statType}`];
  if (!key) continue;
  const v = Number(row.stat);
  if (!Number.isFinite(v)) continue;
  let s = statsByPlayer.get(row.playerId);
  if (!s) statsByPlayer.set(row.playerId, (s = {}));
  s[key] = v;
}

const usageById = new Map(usage.map((u) => [String(u.id), u.usage]));

const KEY_POS = new Set(["QB", "RB", "WR", "TE", "OL", "OT", "OG", "C", "DL", "DE", "DT", "EDGE", "LB", "ILB", "OLB", "DB", "CB", "S", "NT"]);

const players = [];
let kept = 0;
for (const p of roster) {
  const id = String(p.id);
  const team = teamByName.get(p.team);
  const s = statsByPlayer.get(id);
  const rec = (p.recruitIds ?? []).map((rid) => recruitById.get(String(rid))).find(Boolean) ?? recruitByAthlete.get(id);
  const u = usageById.get(id);
  const keyPos = KEY_POS.has(p.position);
  // Keep anyone with a stat line, a recruiting grade, or an upperclass key-position roster spot (linemen have no box score stats).
  if (!s && !rec && !(keyPos && (p.year ?? 0) >= 3)) continue;
  kept++;
  players.push({
    id,
    n: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    t: p.team,
    c: team?.classification ?? null,
    cf: team?.conference ?? p.conference ?? null,
    p: p.position ?? null,
    y: p.year ?? null,
    h: p.height ?? null,
    w: p.weight ?? null,
    j: p.jersey ?? null,
    g: gamesByTeam.get(p.team) ?? null,
    s: s ?? null,
    u: u ? { o: u.overall, pa: u.pass, ru: u.rush, pd: u.passingDowns, td: u.thirdDown } : null,
    r: rec ? { st: rec.stars, rt: rec.rating, rk: rec.rank, yr: rec.year } : null,
    home: [p.homeCity, p.homeState].filter(Boolean).join(", ") || null,
  });
}
log("players kept", kept, "of", roster.length);

const pick = (o) => ({
  plays: o.plays, drives: o.drives, ppa: o.ppa, sr: o.successRate, ex: o.explosiveness, power: o.powerSuccess, stuff: o.stuffRate,
  ly: o.lineYards, sly: o.secondLevelYards, ofy: o.openFieldYards, ppo: o.pointsPerOpportunity,
  havoc: o.havoc?.total ?? null, havocF7: o.havoc?.frontSeven ?? null, havocDB: o.havoc?.db ?? null,
  sdSr: o.standardDowns?.successRate ?? null, pdSr: o.passingDowns?.successRate ?? null, pdEx: o.passingDowns?.explosiveness ?? null,
  rushRate: o.rushingPlays?.rate ?? null, rushSr: o.rushingPlays?.successRate ?? null, rushEx: o.rushingPlays?.explosiveness ?? null, rushPpa: o.rushingPlays?.ppa ?? null,
  passRate: o.passingPlays?.rate ?? null, passSr: o.passingPlays?.successRate ?? null, passEx: o.passingPlays?.explosiveness ?? null, passPpa: o.passingPlays?.ppa ?? null,
});
const seenTeams = new Set();
const teamsOut = [...advFbs, ...advFcs].filter((r) => (seenTeams.has(r.team) ? false : seenTeams.add(r.team))).map((r) => ({
  team: r.team,
  conf: r.conference,
  c: teamByName.get(r.team)?.classification ?? null,
  games: gamesByTeam.get(r.team) ?? null,
  off: pick(r.offense),
  def: pick(r.defense),
}));

const draftOut = draft.map((d) => ({
  year: d.year, round: d.round, pick: d.pick, overall: d.overall, name: d.name, pos: d.position, college: d.collegeTeam, conf: d.collegeConference,
  nfl: d.nflTeam, h: d.height ?? null, w: d.weight ?? null, grade: d.preDraftGrade ?? null, prerank: d.preDraftRanking ?? null, collegeAthleteId: d.collegeAthleteId ?? null,
}));

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "players.json"), JSON.stringify(players));
await writeFile(path.join(OUT, "teams.json"), JSON.stringify(teamsOut));
await writeFile(path.join(OUT, "draft.json"), JSON.stringify(draftOut));
await writeFile(
  path.join(OUT, "meta.json"),
  JSON.stringify({ ingestedAt: new Date().toISOString(), season, players: players.length, teams: teamsOut.length, draftPicks: draftOut.length, recruits: recruiting.length }, null, 2),
);
log("wrote", OUT);
