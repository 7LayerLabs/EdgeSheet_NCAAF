import { readFileSync } from "node:fs";
const src = readFileSync("scripts/ingest-stadiums.mjs", "utf8");
// Pull the pure geometry helpers out of the script without running its network code.
const start = src.indexOf("function project(");
const end = src.indexOf("/* ------------------------------------------------------------- overpass */");
const mid = src.indexOf("function candidates(");
const end2 = src.indexOf("/* ----------------------------------------------------------------- run */");
const code = src.slice(start, end) + src.slice(mid, end2);
const mod = await import("data:text/javascript," + encodeURIComponent(code + "\nexport { candidates, pick };"));
for (const id of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(`data/cache/overpass/${id}.json`, "utf8"));
  const v = JSON.parse(readFileSync("data/cache/venues.json", "utf8")).find((x) => x.id === Number(id));
  const c = mod.candidates(j, v.latitude, v.longitude);
  console.log(id, v.name);
  for (const x of c) console.log("  ", x.kind, x.isFootball ? "football" : "", x.name ?? "", `bearing ${x.bearing}`, `${x.long}x${x.short}m`, `${Math.round(x.dist)}m away`);
  console.log("  pick:", mod.pick(c));
}
