/**
 * Ingest play-by-play: pull every week played so far from CollegeFootballData
 * /plays and /drives (FBS and FCS) and write a compact per-team situational
 * digest. The site reads the digest; nothing here is fetched at request time.
 *
 *   node scripts/ingest-plays.mjs            # CFBD_API_KEY from .env.local or the environment
 *   SEASON=2026 WEEKS=1,2,3 node scripts/ingest-plays.mjs
 *
 * Writes data/generated/situational.json:
 *   meta    ingest time, season, weeks pulled, play and game counts
 *   teams   per school: classification, games, offense and defense splits (counts, not rates:
 *           the reader derives rates and ranks), tempo, top ball carriers and targets on third
 *           down and in the red zone (names parsed from play text, matched to the roster digest)
 *   games   per game id and school: third-down and passing-downs counts for that game (grading)
 *
 * Calls are sequential with a pause and 429 backoff (free tier).
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
  console.error("ingest-plays: CFBD_API_KEY missing. Nothing written.");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, { optional = false, attempt = 0 } = {}) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = 2000 * (attempt + 1);
    log("retry", pathname, res.status, `in ${wait}ms`);
    await sleep(wait);
    return get(pathname, { optional, attempt: attempt + 1 });
  }
  if (!res.ok) {
    if (optional) {
      log("skip", pathname, res.status);
      return [];
    }
    throw new Error(`${pathname} -> ${res.status}`);
  }
  const text = await res.text();
  log("got", pathname, `${(text.length / 1024 / 1024).toFixed(1)}MB`);
  return JSON.parse(text);
}

const season = Number(process.env.SEASON ?? (new Date().getMonth() <= 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()));
log("season", season);

/* ------------------------------------------------------- which weeks */
const calendar = await get(`/calendar?year=${season}`);
const now = Date.now();
let weeks = calendar.filter((w) => new Date(w.startDate ?? w.firstGameStart).getTime() <= now).map((w) => ({ week: w.week, seasonType: w.seasonType }));
if (process.env.WEEKS) {
  const want = new Set(process.env.WEEKS.split(",").map((s) => Number(s.trim())));
  weeks = weeks.filter((w) => want.has(w.week));
}
log("weeks", weeks.map((w) => `${w.seasonType[0]}${w.week}`).join(" "));

/* ---------------------------------------------- roster for name matching */
let roster = [];
try {
  roster = JSON.parse(await readFile(path.join(OUT, "players.json"), "utf8"));
} catch {
  log("players.json missing; names will be unmatched");
}
const classOf = new Map();
const rosterByTeam = new Map();
for (const p of roster) {
  if (p.c && !classOf.has(p.t)) classOf.set(p.t, p.c);
  let arr = rosterByTeam.get(p.t);
  if (!arr) rosterByTeam.set(p.t, (arr = []));
  arr.push(p);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
/** "#20 N.Sheppard" -> roster player on that team, by jersey + last name, then initial + last name. */
function matchName(team, jersey, text) {
  const players = rosterByTeam.get(team);
  if (!players) return undefined;
  const dot = text.indexOf(".");
  const initial = dot > 0 ? text.slice(0, dot) : "";
  const last = norm((dot > 0 ? text.slice(dot + 1) : text).replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, ""));
  if (!last) return undefined;
  const lastOf = (p) => norm(p.n.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "").split(" ").slice(1).join(" "));
  const firstOf = (p) => norm(p.n.split(" ")[0]);
  const byJersey = players.filter((p) => p.j === jersey && lastOf(p) === last);
  if (byJersey.length === 1) return byJersey[0];
  const byInit = players.filter((p) => lastOf(p) === last && (!initial || firstOf(p).startsWith(norm(initial))));
  if (byInit.length === 1) return byInit[0];
  const loose = players.filter((p) => lastOf(p).endsWith(last) || last.endsWith(lastOf(p)));
  if (loose.length === 1 && (!initial || firstOf(loose[0]).startsWith(norm(initial)))) return loose[0];
  return undefined;
}

/* --------------------------------------------------- play classifiers */
const SKIP = /Timeout|Kickoff|Penalty|Punt|End Period|End of|Field Goal|Blocked|Safety|Extra Point|Two Point|Defensive 2pt|Uncategorized|placeholder/i;
function kindOf(p) {
  const t = p.playType ?? "";
  const text = p.playText ?? "";
  if (SKIP.test(t)) return null;
  if (/Rush/.test(t)) return "rush";
  if (/Pass|Sack|Interception/.test(t)) return "pass";
  if (/Fumble/.test(t)) {
    if (/ pass | sacked/.test(text)) return "pass";
    if (/ rush/.test(text)) return "rush";
    return null;
  }
  if (/ pass |sacked/.test(text)) return "pass";
  if (/ rush/.test(text)) return "rush";
  return null;
}
const isTd = (p) => p.scoring === true && /Touchdown/.test(p.playType ?? "") && !/Interception|Fumble Return|Punt|Kickoff/.test(p.playType ?? "");
const success = (p) => {
  if (isTd(p)) return true;
  const d = p.distance ?? 10;
  const need = p.down === 1 ? d * 0.5 : p.down === 2 ? d * 0.7 : d;
  return (p.yardsGained ?? 0) >= need;
};
const converted = (p) => isTd(p) || (p.yardsGained ?? 0) >= (p.distance ?? 10);
const passingDown = (p) => (p.down === 2 && (p.distance ?? 0) >= 8) || ((p.down === 3 || p.down === 4) && (p.distance ?? 0) >= 5);
const havocOn = (p, kind) => {
  const t = p.playType ?? "";
  const text = p.playText ?? "";
  return /Sack|Interception/.test(t) || (kind === "rush" && (p.yardsGained ?? 0) < 0) || /fumbled by|forced by|broken up by/.test(text) || /intercepted/.test(text);
};
const clockSecs = (p) => (p.clock ? (p.clock.minutes ?? 0) * 60 + (p.clock.seconds ?? 0) : null);

// "#20 N.Sheppard rush", "#2 R.Vander Zee rush", "to #15 D.Salley Jr. caught at"
const RUSHER = /#(\d+)\s+([A-Z][A-Za-z'\-]*\.[A-Za-z'\-]+(?:\s+[A-Z][a-z]+)?(?:\s+(?:Jr|Sr|II|III|IV)\.?)?)\s+rush/;
const TARGET = /\bto\s+#(\d+)\s+([A-Z][A-Za-z'\-]*\.[A-Za-z'\-]+(?:\s+[A-Z][a-z]+)?(?:\s+(?:Jr|Sr|II|III|IV)\.?)?)/;

/* ------------------------------------------------------- accumulators */
const bucket = () => ({ n: 0, pass: 0, succ: 0, conv: 0, td: 0, havoc: 0, x: 0 });
function unit() {
  return {
    plays: 0,
    early: bucket(),
    sd: bucket(),
    pd: bucket(),
    third: { short: bucket(), medium: bucket(), long: bucket() },
    fourth: bucket(),
    rz: { ...bucket(), trips: 0, tdTrips: 0 },
    gl: bucket(),
    score: { lead: bucket(), close: bucket(), trail: bucket() },
    explosive: { rush: bucket(), pass: bucket() },
    tempo: { noHuddle: 0, tagged: 0, deltas: [], drivePlays: 0, driveSecs: 0 },
  };
}
const teams = new Map();
function teamRec(school) {
  let t = teams.get(school);
  if (!t) {
    teams.set(school, (t = { c: classOf.get(school) ?? null, games: new Set(), off: unit(), def: unit(), people: { thirdCarriers: new Map(), thirdTargets: new Map(), rzCarriers: new Map(), rzTargets: new Map() } }));
  }
  return t;
}
const games = new Map(); // gameId -> { week, seasonType, teams: { school: {third:{n,conv}, pd:{n,succ}, plays} } }
const bump = (b, p, kind) => {
  b.n++;
  if (kind === "pass") b.pass++;
  if (success(p)) b.succ++;
  if (converted(p)) b.conv++;
  if (isTd(p)) b.td++;
  if (havocOn(p, kind)) b.havoc++;
};
const person = (map, p, key, who) => {
  const cur = map.get(key) ?? { name: who?.n ?? key, id: who?.id, n: 0, unmatched: !who };
  cur.n++;
  map.set(key, cur);
};

function feed(u, p, kind, offense) {
  u.plays++;
  const d = p.down ?? 0;
  const dist = p.distance ?? 10;
  const ytg = p.yardsToGoal ?? 50;
  if (d === 1 || d === 2) bump(u.early, p, kind);
  if (d >= 1) bump(passingDown(p) ? u.pd : u.sd, p, kind);
  if (d === 3) bump(dist <= 3 ? u.third.short : dist <= 6 ? u.third.medium : u.third.long, p, kind);
  if (d === 4) bump(u.fourth, p, kind);
  if (ytg <= 20) bump(u.rz, p, kind);
  if (ytg <= 5) bump(u.gl, p, kind);
  const diff = (p.offenseScore ?? 0) - (p.defenseScore ?? 0);
  bump(diff >= 9 ? u.score.lead : diff <= -9 ? u.score.trail : u.score.close, p, kind);
  if (kind === "rush") {
    u.explosive.rush.n++;
    if ((p.yardsGained ?? 0) >= 12) u.explosive.rush.x++;
  } else {
    u.explosive.pass.n++;
    if ((p.yardsGained ?? 0) >= 20 && !/Incompletion|Sack|Interception/.test(p.playType ?? "")) u.explosive.pass.x++;
  }
  if (offense) {
    const text = p.playText ?? "";
    if (/\b(Shotgun|No Huddle|Under Center|Pistol)\b/i.test(text)) {
      u.tempo.tagged++;
      if (/No Huddle/i.test(text)) u.tempo.noHuddle++;
    }
  }
}

/* -------------------------------------------------------------- pull */
let totalPlays = 0;
const seenPlay = new Set();
const seenDrive = new Set();
for (const w of weeks) {
  const q = `year=${season}&week=${w.week}&seasonType=${w.seasonType}`;
  const plays = [];
  for (const cls of ["fbs", "fcs"]) {
    const rows = await get(`/plays?${q}&classification=${cls}`, { optional: true });
    for (const p of rows) if (!seenPlay.has(p.id)) (seenPlay.add(p.id), plays.push(p));
    await sleep(1200);
  }
  const drives = [];
  for (const cls of ["fbs", "fcs"]) {
    const rows = await get(`/drives?${q}&classification=${cls}`, { optional: true });
    for (const d of rows) if (!seenDrive.has(d.id)) (seenDrive.add(d.id), drives.push(d));
    await sleep(1200);
  }
  log(`week ${w.week}: ${plays.length} plays, ${drives.length} drives`);
  totalPlays += plays.length;

  // Order by game, drive, play so clock deltas and red-zone trips are well defined.
  plays.sort((a, b) => a.gameId - b.gameId || a.driveNumber - b.driveNumber || a.playNumber - b.playNumber);
  let prev = null;
  const tripSeen = new Set();
  const tripTd = new Set();
  for (const p of plays) {
    const kind = kindOf(p);
    if (!kind || !p.offense || !p.defense) {
      prev = null;
      continue;
    }
    const o = teamRec(p.offense);
    const d = teamRec(p.defense);
    o.games.add(p.gameId);
    d.games.add(p.gameId);
    feed(o.off, p, kind, true);
    feed(d.def, p, kind, false);

    // Red-zone trips per drive.
    if ((p.yardsToGoal ?? 50) <= 20 && p.driveId) {
      const k = `${p.driveId}|${p.offense}`;
      if (!tripSeen.has(k)) {
        tripSeen.add(k);
        o.off.rz.trips++;
        d.def.rz.trips++;
      }
      if (isTd(p) && !tripTd.has(k)) {
        tripTd.add(k);
        o.off.rz.tdTrips++;
        d.def.rz.tdTrips++;
      }
    }

    // Seconds between snaps inside one drive and period (clock stoppages included: it is a proxy).
    if (prev && prev.driveId === p.driveId && prev.period === p.period && prev.offense === p.offense) {
      const a = clockSecs(prev);
      const b = clockSecs(p);
      if (a != null && b != null) {
        const delta = a - b;
        if (delta >= 4 && delta <= 60) o.off.tempo.deltas.push(delta);
      }
    }
    prev = p;

    // Who gets the ball on third down and in the red zone.
    const text = p.playText ?? "";
    const third = p.down === 3;
    const rz = (p.yardsToGoal ?? 50) <= 20;
    if (third || rz) {
      const m = kind === "rush" ? text.match(RUSHER) : text.match(TARGET);
      if (m) {
        const jersey = Number(m[1]);
        const who = matchName(p.offense, jersey, m[2]);
        const key = who ? `id:${who.id}` : `#${jersey} ${m[2]}`;
        if (third) person(kind === "rush" ? o.people.thirdCarriers : o.people.thirdTargets, p, key, who);
        if (rz) person(kind === "rush" ? o.people.rzCarriers : o.people.rzTargets, p, key, who);
      }
    }

    // Per-game rows for grading.
    let g = games.get(p.gameId);
    if (!g) games.set(p.gameId, (g = { week: w.week, seasonType: w.seasonType, teams: {} }));
    let gt = g.teams[p.offense];
    if (!gt) gt = g.teams[p.offense] = { plays: 0, third: { n: 0, conv: 0 }, pd: { n: 0, succ: 0 } };
    gt.plays++;
    if (p.down === 3) (gt.third.n++, converted(p) && gt.third.conv++);
    if (passingDown(p)) (gt.pd.n++, success(p) && gt.pd.succ++);
  }

  for (const dr of drives) {
    if (!dr.offense || !dr.elapsed) continue;
    const secs = (dr.elapsed.minutes ?? 0) * 60 + (dr.elapsed.seconds ?? 0);
    if (!dr.plays || secs <= 0 || secs > 900) continue;
    const t = teamRec(dr.offense);
    t.off.tempo.drivePlays += dr.plays;
    t.off.tempo.driveSecs += secs;
  }
}

/* ------------------------------------------------------------ digest */
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const top = (map) =>
  [...map.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((x) => ({ name: x.name, id: x.id, n: x.n, ...(x.unmatched ? { unmatched: true } : {}) }));
const finish = (u) => {
  const { tempo, ...rest } = u;
  return {
    ...rest,
    tempo: {
      noHuddle: tempo.noHuddle,
      tagged: tempo.tagged,
      secsPerSnap: median(tempo.deltas),
      snapPairs: tempo.deltas.length,
      drivePlays: tempo.drivePlays,
      driveSecs: tempo.driveSecs,
    },
  };
};

const teamsOut = {};
for (const [school, t] of teams) {
  teamsOut[school] = {
    c: t.c,
    games: t.games.size,
    off: finish(t.off),
    def: finish(t.def),
    thirdCarriers: top(t.people.thirdCarriers),
    thirdTargets: top(t.people.thirdTargets),
    rzCarriers: top(t.people.rzCarriers),
    rzTargets: top(t.people.rzTargets),
  };
}
const gamesOut = {};
for (const [id, g] of games) gamesOut[id] = g;

let matched = 0;
let unmatched = 0;
for (const t of Object.values(teamsOut)) for (const k of ["thirdCarriers", "thirdTargets", "rzCarriers", "rzTargets"]) for (const x of t[k]) x.unmatched ? unmatched++ : matched++;

await mkdir(OUT, { recursive: true });
const digest = {
  meta: {
    ingestedAt: new Date().toISOString(),
    season,
    weeks: weeks.map((w) => w.week),
    plays: totalPlays,
    games: games.size,
    teams: Object.keys(teamsOut).length,
    namesMatched: matched,
    namesUnmatched: unmatched,
    runtimeSec: Math.round((Date.now() - t0) / 1000),
  },
  teams: teamsOut,
  games: gamesOut,
};
await writeFile(path.join(OUT, "situational.json"), JSON.stringify(digest));
log("wrote situational.json", `${Object.keys(teamsOut).length} teams, ${games.size} games, ${totalPlays} plays, names matched ${matched} / unmatched ${unmatched}`);
