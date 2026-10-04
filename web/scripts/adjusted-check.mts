// Prints raw vs opponent-adjusted production and schedule strength for a few known players.
// Run: npx tsx scripts/adjusted-check.mts ["Name" ...]
const { radarIndex } = await import("../src/lib/radar");
const { adjustedProduction, qualityOfCompetition } = await import("../src/lib/adjusted");
const { biggestMoves, movementFor } = await import("../src/lib/movement");
const idx = radarIndex();
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["Jeremiah Smith", "Arch Manning", "Julian Sayin", "Cam Cook", "Marcus Stokes"];
console.log("name                 team           pos  score  rawPct adjPct blend  rawAvg  adjAvg ratio  qoc  label");
for (const n of names) {
  const hits = idx.all.filter((p) => p.name === n && p.classification === "fbs");
  if (!hits.length) console.log(`${n}: not on the radar`);
  for (const p of hits) {
    const a = adjustedProduction(p.id, p.group);
    const q = qualityOfCompetition(p.id, p.group);
    console.log(`${n.padEnd(21)}${p.team.padEnd(15)}${p.pos.padEnd(5)}${String(p.score).padEnd(7)}${String(p.rawProduction).padEnd(7)}${String(p.adjustedProduction ?? "-").padEnd(7)}${String(p.production).padEnd(7)}${String(a?.rawAvg ?? "-").padEnd(8)}${String(a?.adjAvg ?? "-").padEnd(8)}${String(a?.ratio ?? "-").padEnd(7)}${String(q.avgPct ?? "-").padEnd(5)}${q.label}`);
    for (const r of a?.rows ?? []) console.log(`    wk${r.week} ${r.homeAway === "home" ? "vs" : "at"} ${r.opponent.padEnd(18)} ${r.oppNote.padEnd(36)} w=${r.weight.toFixed(2)} raw=${String(r.raw).padEnd(6)} adj=${String(r.adjusted).padEnd(6)} ${r.line}`);
  }
}
const js = idx.all.find((p) => p.name === "Jeremiah Smith" && p.classification === "fbs");
console.log("\nmovementFor Jeremiah Smith:", js ? movementFor(js.id) ?? "none yet (fewer than two snapshots)" : "n/a");
const m = biggestMoves(5);
console.log("biggestMoves available:", m.available, "|", m.note);
