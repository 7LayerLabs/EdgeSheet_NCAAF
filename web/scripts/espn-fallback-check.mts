/**
 * Build today's slate through the ESPN fallback with the CFBD quota flag
 * forced on, and print what came back. No CFBD network calls are made for
 * paths that are not already dead; the flag short-circuits the games call
 * and the calendar comes from ESPN.
 *
 *   npx tsx scripts/espn-fallback-check.mts [YYYY-MM-DD]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { markCfbdQuotaExhausted, cfbdExhausted, cfbdQuotaStatus } from "../src/lib/cfbd";
import { espnCalendar, espnWeek, derivedWeek } from "../src/lib/espn-schedule";
import { getSlate, etDate } from "../src/lib/slate";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
process.chdir(WEB);
const envFile = path.join(WEB, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const date = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : etDate();
const season = Number(date.slice(0, 4));

markCfbdQuotaExhausted();
console.log("flag forced:", cfbdExhausted(), cfbdQuotaStatus().until);

const t0 = performance.now();
const cal = await espnCalendar(season);
console.log(`ESPN calendar: ${cal.length} weeks (${Math.round(performance.now() - t0)}ms)`);
const week = cal.find((w) => new Date(w.startDate).getTime() <= Date.parse(`${date}T12:00:00-04:00`) && Date.parse(`${date}T12:00:00-04:00`) < new Date(w.endDate).getTime()) ?? derivedWeek(season, date);
console.log(`week ${week.week} ${week.seasonType} ${week.startDate.slice(0, 10)} to ${week.endDate.slice(0, 10)}${cal.length ? "" : " (derived, no calendar)"}`);

const t1 = performance.now();
const b = await espnWeek(season, week);
console.log(`ESPN week bundle (${Math.round(performance.now() - t1)}ms): ${b.games.length} games, ${b.lines.length} with a line, ${b.media.length} broadcast rows, ${b.teams.length} teams, ${b.venues.length} venues, ${b.records.length} records, polls ${b.rankings?.polls.map((p) => `${p.poll} x${p.ranks.length}`).join(", ") ?? "none"}, missing days ${b.missingDays.length}`);

const t2 = performance.now();
const slate = await getSlate(date);
console.log(`getSlate(${date}) (${Math.round(performance.now() - t2)}ms): ${slate.games.length} games on ${slate.date}, ${slate.weekGames.length} in the week, days ${slate.days.map((d) => `${d.date.slice(5)}:${d.count}`).join(" ")}`);
console.log("fallback note present:", slate.notes.some((n) => /ESPN/.test(n)));
const g = slate.games[0];
if (g) console.log(`first game: ${g.away.short} ${g.away.record || "?"} @ ${g.home.short} ${g.home.record || "?"}, rank ${g.home.rank ?? "-"}/${g.away.rank ?? "-"}, ${g.network || "no network"}, spread ${g.market.spread ?? "none"}, total ${g.market.total ?? "none"}, status ${g.status}`);
console.log("CFBD fetch() calls during this run:", JSON.stringify(cfbdQuotaStatus().callsThisProcess));
