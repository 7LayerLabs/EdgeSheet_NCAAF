// Runs under tsx (see scripts/snapshot.mjs). Writes one weekly snapshot.
const { writeSnapshot } = await import("../../src/lib/snapshot");
const date = process.env.SNAPSHOT_DATE;
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("snapshot: SNAPSHOT_DATE must be YYYY-MM-DD");
  process.exit(1);
}
const out = writeSnapshot(date || undefined);
console.log(`snapshot ${out.date}: ${out.players} radar players, ${out.entries} forecast entries -> ${out.dir}`);
