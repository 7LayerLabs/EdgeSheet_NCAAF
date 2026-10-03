/**
 * End-to-end check: build today's slate and one live game through src/lib/slate.ts
 * and print what the ESPN overlay attached. Needs CFBD_API_KEY.
 *   npx tsx --env-file=.env.local scripts/espn-slate-check.mts [YYYY-MM-DD]
 */
import { getSlate, getGame } from "../src/lib/slate";
import { flipScore, winProbLine } from "../src/lib/live";

const slate = await getSlate(process.argv[2]);
const live = slate.games.filter((g) => g.status === "live");
const withOverlay = slate.games.filter((g) => g.live);
console.log(`${slate.date}: ${slate.games.length} games, ${live.length} live, ${slate.games.filter((g) => g.status === "final").length} final, ${withOverlay.length} with ESPN overlay`);
for (const g of [...live].sort((a, b) => flipScore(b) - flipScore(a)).slice(0, 6)) {
  const wp = winProbLine(g);
  console.log(`  flip ${flipScore(g)} | ${g.away.abbr} ${g.score?.away} @ ${g.home.abbr} ${g.score?.home} | ${g.score?.clock} | ${wp ? `${wp.team} ${wp.pct}%${wp.swing !== undefined ? ` ${wp.swing > 0 ? "+" : ""}${wp.swing} last ${wp.minutes} min` : ""}` : "no wp"} | ${g.live?.possession ?? "-"} ${g.live?.downDistance ?? ""}`);
}
const finals = slate.games.filter((g) => g.status === "final" && g.live);
if (finals[0]) console.log(`  final overlay sample: ${finals[0].away.abbr} ${finals[0].score?.away} @ ${finals[0].home.abbr} ${finals[0].score?.home} ${finals[0].score?.clock}`);
const lower = slate.games.find((g) => g.division === "DII" || g.division === "DIII");
if (lower) console.log(`  lower division untouched: ${lower.away.abbr} @ ${lower.home.abbr} status=${lower.status} live=${lower.live ? "yes" : "no"}`);

const pick = live[0] ?? finals[0];
if (pick) {
  const g = await getGame(pick.id);
  const d = g?.liveDetail;
  console.log(`game ${pick.id}: status=${g?.status} clock=${g?.score?.clock} box=${g?.box?.source ?? "none"} (${g?.box?.teams.map((t) => `${t.abbr} ${t.leaders.length}`).join(", ")})`);
  console.log(`  detail: winProb ${d?.winProb.length ?? 0} rows, scoring ${d?.scoringPlays.length ?? 0}, drives ${d?.drives.length ?? 0}, players ${Object.keys(d?.byPlayer ?? {}).length}`);
  const withLines = g?.prospects.filter((p) => p.lines?.length) ?? [];
  console.log(`  radar players with in-game lines: ${withLines.length}${withLines[0] ? ` e.g. ${withLines[0].name}: ${withLines[0].lines![0].headline}` : ""}`);
  console.log(`  gaps: ${g?.gaps?.join(" | ")}`);
}
