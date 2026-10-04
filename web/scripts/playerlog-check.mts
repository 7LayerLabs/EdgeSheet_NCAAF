/**
 * Prints a player log for a game and compares the computed line to ESPN's box line.
 *   npx tsx scripts/playerlog-check.mts <gameId> <playerId> [<playerId>...]
 */
import { playerLog } from "../src/lib/playerlog";
import { liveSummary } from "../src/lib/espn";

const [gameId, ...ids] = process.argv.slice(2);
if (!gameId || !ids.length) {
  console.log("usage: npx tsx scripts/playerlog-check.mts <gameId> <playerId>...");
  process.exit(1);
}
const sum = await liveSummary(gameId);
for (const id of ids) {
  const log = await playerLog(gameId, id);
  console.log(`\n=== ${log.name} #${log.jersey} (${log.team}, ${log.abbr ?? "?"}, ${log.side ?? "side unknown"}) · ${log.detail} · ${log.away.abbr} ${log.away.score}, ${log.home.abbr} ${log.home.score}`);
  if (log.reason) console.log("  reason:", log.reason);
  if (log.ambiguous) console.log("  AMBIGUOUS with", log.ambiguousWith);
  console.log(`  ${log.plays.length} plays of ${log.playsParsed} parsed`);
  for (const p of log.plays) console.log(`  ${p.isBig ? "**" : "  "} Q${p.quarter} ${p.clock.padStart(5)} ${(p.situation ?? "").padEnd(20)} ${p.tag.padEnd(34)} ${p.yards >= 0 ? "+" : ""}${p.yards}  ${p.text.slice(0, 90)}`);
  console.log("  computed:", log.lineText.map((l) => `${l.category}: ${l.headline}`).join(" | "));
  console.log("  box:     ", (sum?.byPlayer[id] ?? []).map((l) => `${l.category}: ${l.headline}`).join(" | ") || "(no box line)");
}
