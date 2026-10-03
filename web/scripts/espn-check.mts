/**
 * Smoke test for src/lib/espn.ts against ESPN's public feed. No key needed.
 *   npx tsx scripts/espn-check.mts [YYYY-MM-DD] [gameId]
 */
import { liveScoreboard, liveSummary, swingFor, headshotUrl } from "../src/lib/espn";

const date = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const sb = await liveScoreboard(date);
const rows = [...sb.values()];
const by = (s: string) => rows.filter((r) => r.state === s).length;
console.log(`${date}: ${rows.length} D1 games on ESPN, ${by("in")} in progress, ${by("post")} final, ${by("pre")} scheduled`);
const live = rows.filter((r) => r.state === "in").sort((a, b) => (b.closeness ?? 0) - (a.closeness ?? 0));
for (const g of live.slice(0, 8)) {
  const wp = g.homeWinProb === undefined ? "wp n/a" : `${g.home.abbr} ${Math.round(g.homeWinProb * 100)}%`;
  console.log(`  ${g.id} ${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score} | ${g.detail} | ${wp} close=${g.closeness?.toFixed(2)} | ${g.possession ?? "-"} ${g.downDistance ?? ""} | ${g.broadcast ?? ""}`);
  if (g.lastPlay) console.log(`     last: ${g.lastPlay.slice(0, 110)}`);
}
const fin = rows.find((r) => r.state === "post");
if (fin) console.log(`  final sample: ${fin.id} ${fin.away.abbr} ${fin.away.score} @ ${fin.home.abbr} ${fin.home.score} ${fin.detail} wp=${fin.homeWinProb}`);

const pick = process.argv[3] ?? live[0]?.id ?? fin?.id;
if (pick) {
  const s = await liveSummary(pick);
  if (!s) console.log(`summary ${pick}: none`);
  else {
    console.log(`summary ${pick}: ${s.away.abbr} ${s.away.score} @ ${s.home.abbr} ${s.home.score} ${s.detail} | linescores ${JSON.stringify(s.away.linescores)} ${JSON.stringify(s.home.linescores)}`);
    console.log(`  winProb rows ${s.winProb.length}, first ${JSON.stringify(s.winProb[0])}, last ${JSON.stringify(s.winProb.at(-1))}`);
    console.log(`  scoring plays ${s.scoringPlays.length}: ${s.scoringPlays.slice(0, 2).map((p) => `Q${p.period} ${p.clock} ${p.team} ${p.type} ${p.away}-${p.home}`).join(" | ")}`);
    console.log(`  drives ${s.drives.length}: ${s.drives.slice(0, 3).map((d) => `${d.team} ${d.resultShort} ${d.plays}p ${d.yards}y ${d.time} ${d.start}>${d.end}${d.current ? " (current)" : ""}`).join(" | ")}`);
    console.log(`  box: ${s.box.map((b) => `${b.abbr}(${b.homeAway}) ${b.leaders.length} leaders: ${b.leaders.slice(0, 3).map((l) => `${l.name} ${l.headline}`).join("; ")}`).join(" || ")}`);
    console.log(`  players with lines: ${Object.keys(s.byPlayer).length} (${s.playersSeen} stat rows), situation ${JSON.stringify(s.situation)?.slice(0, 160)}`);
  }
}

// Ring buffer: a second fetch inside the memo window returns the same map, so the swing needs real elapsed time.
const sw = live[0] ? swingFor(live[0].id) : undefined;
console.log(`swing for ${live[0]?.id ?? "n/a"}: ${sw ? `${(sw.swing * 100).toFixed(0)} pts over ${sw.minutes} min` : "not enough history yet (needs 2+ minutes of readings in this process)"}`);

for (const id of ["4870906", "5079712", "1"]) {
  const res = await fetch(headshotUrl(id), { method: "GET" });
  console.log(`headshot ${id}: ${res.status} ${res.headers.get("content-type")} ${res.headers.get("content-length") ?? ""}`);
}
