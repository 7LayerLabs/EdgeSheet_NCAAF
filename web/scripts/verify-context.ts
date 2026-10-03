/**
 * Smoke test for the context layer (portal, stadium bearing, climate baseline).
 *   npx tsx scripts/verify-context.ts      (run from web/)
 */
import { transfersBetween, notableArrivals, portalStorylines, arrivalNote, portalLoaded } from "../src/lib/portal";
import { fieldBearing, axisLabel, windComponent, compassToDegrees, angleToAxis, stadiumsLoaded } from "../src/lib/stadiums";
import { baseline, baselineLine, climateLoaded } from "../src/lib/climate";

console.log("portal loaded:", portalLoaded(), "| stadiums loaded:", stadiumsLoaded(), "| climate loaded:", climateLoaded());

console.log("\ntransfersBetween(Tennessee, UCLA):");
for (const r of transfersBetween("Tennessee", "UCLA")) console.log(`  ${r.position} ${r.name}: ${r.origin} -> ${r.destination} (${r.season}, ${r.stars ?? "?"} stars, on roster ${r.onRoster})`);
console.log("portalStorylines(UCLA, Tennessee):", portalStorylines("UCLA", "Tennessee"));
console.log("\nnotableArrivals(Tennessee):");
for (const r of notableArrivals("Tennessee", 5)) console.log(`  ${r.position} ${r.name} from ${r.origin} (${r.season}, rating ${r.rating}, on roster ${r.onRoster})`);
console.log("arrivalNote(4870799 Nico Iamaleava):", arrivalNote("4870799"));

const VENUES: [number, string][] = [
  [3853, "Neyland Stadium"],
  [3657, "Bryant-Denny Stadium"],
  [3861, "Ohio Stadium"],
  [3558, "Michigan Stadium"],
  [1056, "Rose Bowl"],
  [3795, "Kyle Field"],
];
for (const [id, name] of VENUES) {
  const b = fieldBearing(id);
  console.log(`\n${name} (${id}):`, b ? `${b.bearing} deg, field runs ${axisLabel(b.bearing)}, confidence ${b.confidence}` : "no bearing on file");
  if (b) {
    for (const dir of ["N", "NE", "E", "SE"]) {
      const d = compassToDegrees(dir)!;
      console.log(`  wind from ${dir}: ${angleToAxis(d, b.bearing)} deg off the axis -> ${windComponent(d, b.bearing)}`);
    }
  }
}

const kick = "2026-10-03T19:30:00.000Z"; // 3:30 pm ET
for (const [id, name] of VENUES) {
  const c = baseline(id, kick);
  console.log(`\n${name} baseline for ${kick}:`, c ? baselineLine(c) : "none on file");
}
const night = baseline(3853, "2026-11-21T00:30:00.000Z"); // 7:30 pm ET Nov 20
console.log("\nNeyland late-November night baseline:", night ? baselineLine(night, { windMph: 18, gustMph: 25, windDir: "NW", crosswind: true, precipChance: 10, tempF: 38, feelsLikeF: 31, humidity: 60, stormRisk: "none", roof: "open", surface: "grass", elevationFt: 892, asOf: "" }) : "none on file");
