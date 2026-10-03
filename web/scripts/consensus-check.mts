// Prints the consensus block for one game. Run: npx tsx scripts/consensus-check.ts [gameId]
import { readFileSync } from "node:fs";
if (!process.env.CFBD_API_KEY) {
  try { const m = /CFBD_API_KEY=(.+)/.exec(readFileSync(".env.local", "utf8")); if (m) process.env.CFBD_API_KEY = m[1].trim().replace(/^"|"$/g, ""); } catch {}
}
const id = process.argv[2] ?? "401858249";
const { getGame } = await import("../src/lib/slate");
const g = await getGame(id);
if (!g) { console.log("no game", id); process.exit(1); }
console.log(`${g.away.short} @ ${g.home.short} (${g.division}, week ${g.week}) status ${g.status}`);
console.log("market:", g.market.spread ? `${g.market.spread.team} ${g.market.spread.line}` : "none");
console.log("model:", g.projection ? `${g.projection.winner} by ${g.projection.margin.toFixed(1)}, ${Math.round(g.projection.winProb * 100)}%, ${g.projection.confidence}` : "none");
const c = g.consensus;
if (!c) { console.log("no consensus"); process.exit(0); }
console.log("\nsystem           projects         winprob  note");
for (const s of c.systems) console.log(`${(s.system + (s.ours ? " (ours)" : "")).padEnd(17)}${s.available ? `${s.favorite} by ${Math.abs(s.margin!).toFixed(1)}`.padEnd(17) + `${Math.round(s.winProb! * 100)}%`.padEnd(9) : "unavailable".padEnd(26)}${s.note ?? ""}`);
console.log(`\nconsensus: median ${c.median} (home positive) -> ${c.favorite}, ${c.winProb !== undefined ? Math.round(c.winProb * 100) + "%" : "n/a"}; market home margin ${c.marketMargin}; side ${c.side} ${c.sideCount}/${c.available}; model agrees ${c.modelAgrees}`);
console.log("summary:", c.summary);
console.log("\narchive lock:", JSON.stringify(g.archive?.pregame.consensus), "graded:", JSON.stringify(g.archive?.postgame?.consensusResult));
console.log("serializable:", JSON.stringify(c).length, "bytes");
