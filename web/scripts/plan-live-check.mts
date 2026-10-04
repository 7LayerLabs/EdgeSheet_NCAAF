/**
 * Exercises buildPlan's live rules on today's REAL ESPN scoreboard without
 * CollegeFootballData (useful when the CFBD quota is out). Builds minimal Game
 * objects from the scoreboard, follows one live team and one live radar-style
 * player, pulls real play logs, and prints the plan.
 *   npx tsx scripts/plan-live-check.mts [YYYYMMDD] [playerId] [schoolName]
 */
import { liveScoreboard } from "../src/lib/espn";
import { buildPlan, planText } from "../src/lib/plan";
import { playerLogs } from "../src/lib/playerlog";
import { genPlayers } from "../src/lib/generated";
import type { Game, Team } from "../src/lib/types";

const d = process.argv[2] ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
const board = await liveScoreboard(d);
console.log(`ESPN scoreboard ${d}: ${board.size} games, ${[...board.values()].filter((g) => g.state === "in").length} live`);

// ESPN team id = CFBD team id, and the roster digest carries school names; map abbreviation to school via players.json.
const players = genPlayers();
const abbrToSchool = new Map<string, string>();
const team = (abbr: string, id: string): Team => ({ id, name: abbrToSchool.get(abbr) ?? abbr, short: abbrToSchool.get(abbr) ?? abbr, abbr, record: "", conference: "", color: "#0d1f3c" });

const games: Game[] = [];
for (const lg of board.values()) {
  const kickoff = new Date().toISOString(); // scoreboard rows do not carry the kickoff here; approximate with now minus elapsed
  const elapsedMin = lg.state === "in" ? Math.max(0, (lg.period - 1) * 15 + (15 - (Number(lg.clock.split(":")[0]) || 0))) : lg.state === "post" ? 210 : -30;
  const k = new Date(Date.now() - elapsedMin * 60_000).toISOString();
  void kickoff;
  games.push({
    id: lg.id,
    division: "FBS",
    home: team(lg.home.abbr, lg.home.id),
    away: team(lg.away.abbr, lg.away.id),
    kickoff: k,
    venue: "",
    city: "",
    network: lg.broadcast ?? "",
    status: lg.state === "in" ? "live" : lg.state === "post" ? "final" : "upcoming",
    score: lg.home.score != null && lg.away.score != null ? { home: lg.home.score, away: lg.away.score, clock: lg.detail } : undefined,
    live: lg.state === "in" ? { period: lg.period, clock: lg.clock, possession: lg.possession, down: lg.down, distance: lg.distance, yardLine: lg.yardLine, downDistance: lg.downDistance, lastPlay: lg.lastPlay, homeWinProb: lg.homeWinProb, awayWinProb: lg.awayWinProb, swing: lg.swing, swingMinutes: lg.swingMinutes, closeness: lg.closeness, broadcast: lg.broadcast, asOf: lg.asOf } : undefined,
    coverage: "Standard",
    whyWatch: "",
    whyWatchReasons: [],
    market: { asOf: "" },
    prospects: [],
    matchups: [],
    keepAnEyeOn: [],
    storylines: [],
    offense: {},
    defense: {},
    pressurePoint: "",
    scoreComponents: { draftTalent: 50, directMatchups: null, futureTalent: null, competitive: lg.closeness != null ? Math.round(lg.closeness * 100) : 50, styleContrast: null, storylines: null, availability: null },
    reportAsOf: new Date().toISOString(),
    source: "live",
  });
}

// Follow: the given player (default: the first live game's home team QB with a jersey), and his school.
const liveGame = games.find((g) => g.status === "live");
let playerId = process.argv[3];
let school = process.argv[4];
if (!playerId && liveGame) {
  const lg = board.get(liveGame.id)!;
  // Find a QB on either roster by ESPN team abbreviation is not possible directly; use the summary's box via playerLogs is per id.
  // Fall back: pick any roster QB whose school name appears in ESPN's displayName for the home team.
  const candidates = players.filter((p) => p.p === "QB" && p.j != null && (p.c === "fbs" || p.c === "fcs"));
  const byTeam = candidates.find((p) => lg.home.abbr && p.t && p.t.replace(/\s/g, "").toLowerCase().startsWith(lg.home.abbr.replace(/&/g, "").toLowerCase().slice(0, 3)));
  if (byTeam) {
    playerId = byTeam.id;
    school = byTeam.t;
  }
}
const row = players.find((p) => p.id === playerId);
if (row) abbrToSchool.set(liveGame?.home.abbr ?? "", row.t);
for (const g of games) {
  if (row && g.home.abbr === (liveGame?.home.abbr ?? "")) g.home = { ...g.home, short: row.t, name: row.t };
}
const follows = { teams: school ? [school] : [], players: row ? [row.id] : [], games: [] };
const planPlayers = row ? [{ id: row.id, name: row.n, team: row.t, pos: row.p ?? "" }] : [];
const logs = row && liveGame ? await playerLogs(liveGame.id, [row.id]) : {};
if (row) {
  const log = logs[row.id];
  console.log(`\nFollowed player ${row.n} (${row.t} ${row.p}) in ${liveGame?.away.abbr}-${liveGame?.home.abbr}: ${log?.plays.length ?? 0} plays, ${log?.plays.filter((p) => p.isBig).length ?? 0} big${log?.reason ? `, reason: ${log.reason}` : ""}`);
  for (const p of log?.plays.slice(-5) ?? []) console.log(`  ${p.isBig ? "**" : "  "} Q${p.quarter} ${p.clock} ${p.tag}`);
  if (log?.lineText.length) console.log("  computed:", log.lineText.map((l) => l.headline).join(" | "));
}

const plan = buildPlan({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, games, follows, players: planPlayers, logs });
console.log("\n=== NOW + NEXT BLOCKS ===");
for (const b of plan.blocks.filter((x) => x.status !== "past").slice(0, 6)) {
  console.log(`${b.label.padStart(8)} ${b.status.padEnd(8)} ${b.pick ? `${b.pick.short.padEnd(12)} ${String(b.pick.rank).padStart(3)}  ${b.pick.liveLine ? `${b.pick.liveLine} · ` : ""}${b.pick.why}` : "nothing on"}`);
  for (const t of b.triggers) console.log(`           ${t}`);
  if (b.others.length) console.log(`           also: ${b.others.map((o) => o.short).join(", ")}`);
}
console.log("\n=== TELEGRAM TEXT (first 1200 chars) ===");
console.log(planText(plan, "http://localhost:3000").slice(0, 1200));
