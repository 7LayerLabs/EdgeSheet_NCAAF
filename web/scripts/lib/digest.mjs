/**
 * Shared digest code for scripts/ingest.mjs and scripts/backtest.mjs.
 * Turns raw CollegeFootballData rows into the compact shapes the site reads
 * (players.json, teams.json, draft.json). Keep this byte-for-byte equivalent to
 * what ingest.mjs used to do inline: the site depends on these field names.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const BASE = "https://api.collegefootballdata.com";

export async function loadKey(root) {
  if (process.env.CFBD_API_KEY) return process.env.CFBD_API_KEY;
  try {
    const env = await readFile(path.join(root, ".env.local"), "utf8");
    const m = env.match(/^CFBD_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return undefined;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a fetcher bound to one key. Retries 429 with linear backoff (1.5s, 3s, 4.5s, 6s).
 * `pause` adds a fixed wait before every call so sequential scripts stay under the free-tier burst limit.
 */
export function makeGet(KEY, log = () => {}, { pause = 0, retries = 4 } = {}) {
  return async function get(pathname, { optional = false, attempt = 0 } = {}) {
    if (pause) await sleep(pause);
    const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
    if (res.status === 429) {
      const body = await res.clone().text().catch(() => "");
      if (/quota/i.test(body)) {
        // Monthly quota, not a burst limit. Retrying is pointless; keep the existing digests and exit cleanly so builds still run.
        console.error("CollegeFootballData monthly call quota exceeded. Existing digests in data/generated are kept. Upgrade the key (Patreon tier) or wait for the monthly reset.");
        process.exit(0);
      }
    }
    if (res.status === 429 && attempt < retries) {
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
  };
}

export const STAT_KEYS = {
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

export const KEY_POS = new Set(["QB", "RB", "WR", "TE", "OL", "OT", "OG", "C", "DL", "DE", "DT", "EDGE", "LB", "ILB", "OLB", "DB", "CB", "S", "NT"]);

/** players.json rows. Returns { players, kept } so callers can log the keep count. */
export function digestPlayers({ teams, roster, stats, usage, records, recruiting }) {
  const teamByName = new Map(teams.map((t) => [t.school, t]));
  const gamesByTeam = new Map(records.map((r) => [r.team, r.total?.games ?? 0]));

  const recruitById = new Map();
  const recruitByAthlete = new Map();
  for (const r of recruiting) {
    const row = { stars: r.stars ?? null, rating: r.rating ?? null, rank: r.ranking ?? null, year: r.year, pos: r.position ?? null };
    recruitById.set(String(r.id), row);
    if (r.athleteId) recruitByAthlete.set(String(r.athleteId), row);
  }

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
  return { players, kept };
}

export const pickUnit = (o) => ({
  plays: o.plays, drives: o.drives, ppa: o.ppa, sr: o.successRate, ex: o.explosiveness, power: o.powerSuccess, stuff: o.stuffRate,
  ly: o.lineYards, sly: o.secondLevelYards, ofy: o.openFieldYards, ppo: o.pointsPerOpportunity,
  havoc: o.havoc?.total ?? null, havocF7: o.havoc?.frontSeven ?? null, havocDB: o.havoc?.db ?? null,
  sdSr: o.standardDowns?.successRate ?? null, pdSr: o.passingDowns?.successRate ?? null, pdEx: o.passingDowns?.explosiveness ?? null,
  rushRate: o.rushingPlays?.rate ?? null, rushSr: o.rushingPlays?.successRate ?? null, rushEx: o.rushingPlays?.explosiveness ?? null, rushPpa: o.rushingPlays?.ppa ?? null,
  passRate: o.passingPlays?.rate ?? null, passSr: o.passingPlays?.successRate ?? null, passEx: o.passingPlays?.explosiveness ?? null, passPpa: o.passingPlays?.ppa ?? null,
});

/** teams.json rows from advanced season stats (FBS first, then any FCS rows a paid key returns). */
export function digestTeams({ teams, records, advFbs, advFcs = [] }) {
  const teamByName = new Map(teams.map((t) => [t.school, t]));
  const gamesByTeam = new Map(records.map((r) => [r.team, r.total?.games ?? 0]));
  const seenTeams = new Set();
  return [...advFbs, ...advFcs].filter((r) => (seenTeams.has(r.team) ? false : seenTeams.add(r.team))).map((r) => ({
    team: r.team,
    conf: r.conference,
    c: teamByName.get(r.team)?.classification ?? null,
    games: gamesByTeam.get(r.team) ?? null,
    off: pickUnit(r.offense),
    def: pickUnit(r.defense),
  }));
}

/** draft.json rows. */
export function digestDraft(draft) {
  return draft.map((d) => ({
    year: d.year, round: d.round, pick: d.pick, overall: d.overall, name: d.name, pos: d.position, college: d.collegeTeam, conf: d.collegeConference,
    nfl: d.nflTeam, h: d.height ?? null, w: d.weight ?? null, grade: d.preDraftGrade ?? null, prerank: d.preDraftRanking ?? null, collegeAthleteId: d.collegeAthleteId ?? null,
  }));
}
