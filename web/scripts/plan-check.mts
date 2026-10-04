/**
 * Prints the Saturday plan text for a date (default today) and a player log for
 * the highest-radar QB on a final game that day.
 *   npx tsx scripts/plan-check.mts [YYYY-MM-DD]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Same .env.local loader the bot uses, so getSlate sees CFBD_API_KEY instead of falling back to the sample slate.
const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const { getPlan } = await import("../src/lib/plan-load");
import { planText } from "../src/lib/plan";
import { playerLog } from "../src/lib/playerlog";
import { baseUrl } from "../src/lib/digests";

const date = process.argv[2];
const { plan, slate } = await getPlan(date);

console.log("=== PLAN TEXT (Telegram HTML) ===");
console.log(planText(plan, baseUrl()));
console.log("\n=== BLOCKS ===");
for (const b of plan.blocks) console.log(`${b.label.padStart(8)} ${b.status.padEnd(8)} ${b.pick ? `${b.pick.short.padEnd(12)} ${String(b.pick.rank).padStart(3)}  ${b.pick.why}` : "nothing on"}${b.triggers.map((t) => `\n           ${t}`).join("")}`);

const finals = slate.games.filter((g) => g.status === "final" && (g.division === "FBS" || g.division === "FCS"));
const qbs = finals.flatMap((g) => g.prospects.filter((p) => p.pos === "QB" && p.radar).map((p) => ({ g, p })));
qbs.sort((a, b) => (b.p.radar?.score ?? 0) - (a.p.radar?.score ?? 0));
const pick = qbs[0];
console.log("\n=== PLAYER LOG ===");
if (!pick) {
  console.log("No final Division I game with a radar QB on this date.");
} else {
  const log = await playerLog(pick.g.id, pick.p.id);
  console.log(`${log.name} #${log.jersey} (${log.team}) in ${pick.g.away.short} at ${pick.g.home.short}: ${log.detail}, ${log.away.abbr} ${log.away.score}, ${log.home.abbr} ${log.home.score}`);
  if (log.reason) console.log("reason:", log.reason);
  if (log.ambiguous) console.log("ambiguous with", log.ambiguousWith);
  for (const p of log.plays) console.log(`${p.isBig ? "**" : "  "} Q${p.quarter} ${p.clock.padStart(5)} ${(p.situation ?? "").padEnd(22)} ${p.tag}`);
  console.log("computed:", log.lineText.map((l) => `${l.category}: ${l.headline}`).join(" | "));
  console.log("box:     ", (pick.p.lines ?? []).map((l) => `${l.category}: ${l.headline}`).join(" | ") || "(none)");
}
