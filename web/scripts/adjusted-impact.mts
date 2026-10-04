// How much did the opponent adjustment move the board? Compares each player's live score with the score
// he would have with raw production only (the blend is 50/50, so the difference is prodWeight * half the gap * level).
// Run: npx tsx scripts/adjusted-impact.mts [N]
const { radarIndex } = await import("../src/lib/radar");
const { forecastNextDraft } = await import("../src/lib/forecast");
const N = Number(process.argv[2] ?? 25);
const idx = radarIndex();
const PROD_FIRST = new Set(["RB", "QB", "TE", "DL"]);
const LEVEL: Record<string, number> = { fbs: 1, fcs: 0.72, ii: 0.5, iii: 0.38 };
const rawScore = (p: (typeof idx.all)[number]) => {
  const w = p.group === "OL" ? 0 : PROD_FIRST.has(p.group) ? 0.55 : 0.35;
  return Math.round(p.score - w * (p.production - p.rawProduction) * (LEVEL[p.classification ?? "fbs"] ?? 0.5));
};
const pool = idx.all.filter((p) => p.draftClass === idx.nextDraft && (p.classification === "fbs" || p.classification === "fcs"));
const rawRank = new Map([...pool].sort((a, b) => rawScore(b) - rawScore(a) || a.name.localeCompare(b.name)).map((p, i) => [p.id, i + 1]));
const withLogs = pool.filter((p) => p.adjustedProduction !== null).length;
console.log(`${idx.nextDraft} class, Division I: ${pool.length} radar players, ${withLogs} with game logs`);
console.log(`\nTop ${N} by live score (adjusted) vs where raw-only would put them`);
console.log("rk  rawRk  name                   team            pos  score raw  prod rawP adjP qoc  label");
let moved = 0, sumAbs = 0, up = 0, down = 0;
pool.slice(0, N).forEach((p, i) => {
  const rs = rawScore(p);
  const rr = rawRank.get(p.id)!;
  if (rr !== i + 1) moved++;
  sumAbs += Math.abs(p.score - rs);
  if (p.score > rs) up++; else if (p.score < rs) down++;
  console.log(`${String(i + 1).padEnd(4)}${String(rr).padEnd(7)}${p.name.padEnd(23)}${p.team.padEnd(16)}${p.pos.padEnd(5)}${String(p.score).padEnd(6)}${String(rs).padEnd(5)}${String(p.production).padEnd(5)}${String(p.rawProduction).padEnd(5)}${String(p.adjustedProduction ?? "-").padEnd(5)}${String(p.qoc ?? "-").padEnd(5)}${p.qocLabel}`);
});
console.log(`\n${moved} of the top ${N} sit at a different rank than raw-only; ${up} scored higher with the adjustment, ${down} lower; mean absolute score change ${(sumAbs / N).toFixed(2)} pts`);
const entered = pool.slice(0, N).filter((p) => rawRank.get(p.id)! > N).map((p) => `${p.name} (raw rk ${rawRank.get(p.id)})`);
const left = [...pool].sort((a, b) => rawScore(b) - rawScore(a)).slice(0, N).filter((p) => pool.indexOf(p) >= N).map((p) => `${p.name} (now rk ${pool.indexOf(p) + 1})`);
console.log("entered the top", N, ":", entered.join("; ") || "none");
console.log("left the top", N, ":", left.join("; ") || "none");
// Whole-board effect
const all = pool.filter((p) => p.adjustedProduction !== null);
const big = all.map((p) => ({ p, d: p.score - rawScore(p) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log(`\nAcross ${all.length} Division I players with logs: mean |score change| ${(big.reduce((s, x) => s + Math.abs(x.d), 0) / all.length).toFixed(2)}, max ${big[0]?.d} (${big[0]?.p.name})`);
console.log("Biggest gainers from the adjustment:");
for (const x of big.filter((x) => x.d > 0).slice(0, 8)) console.log(`  +${x.d}  ${x.p.name.padEnd(22)} ${x.p.team.padEnd(16)} ${x.p.pos.padEnd(4)} raw ${x.p.rawProduction} adj ${x.p.adjustedProduction} qoc ${x.p.qoc} ${x.p.qocLabel}`);
console.log("Biggest losers from the adjustment:");
for (const x of big.filter((x) => x.d < 0).slice(0, 8)) console.log(`  ${x.d}  ${x.p.name.padEnd(22)} ${x.p.team.padEnd(16)} ${x.p.pos.padEnd(4)} raw ${x.p.rawProduction} adj ${x.p.adjustedProduction} qoc ${x.p.qoc} ${x.p.qocLabel}`);
const fc = forecastNextDraft();
const r1 = fc.board.filter((e) => e.band === "Round 1 range");
console.log(`\nForecast Round 1 range: ${r1.length} names. Schedule labels: tough ${r1.filter((e) => e.player.qocLabel === "tough").length}, average ${r1.filter((e) => e.player.qocLabel === "average").length}, soft ${r1.filter((e) => e.player.qocLabel === "soft").length}, unmeasured ${r1.filter((e) => e.player.qocLabel === "unmeasured").length}`);
