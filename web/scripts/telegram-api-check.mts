/**
 * Dry run of the Telegram digests through the running site's JSON routes,
 * the way scripts/telegram-bot.mjs now reads them (no in-process slate build,
 * no CFBD calls from this process).
 *
 *   npx tsx scripts/telegram-api-check.mts [http://localhost:3000]
 */
import { morningSlate, leansDigest, gameDigest } from "../src/lib/digests";

const base = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const t0 = performance.now();
const res = await fetch(`${base}/api/slate?full=1`);
const slate = await res.json();
console.log(`GET /api/slate?full=1 -> ${res.status} in ${Math.round(performance.now() - t0)}ms; ${slate.games.length} games, ${slate.weekGames.length} in week, source ${slate.source}, CFBD quota exhausted ${slate.cfbdQuota?.exhausted}`);
const text = morningSlate(slate);
console.log(`morningSlate: ${text.length} chars\n${text.split("\n").slice(0, 12).join("\n")}\n...`);
const d1 = slate.games.filter((x: { division: string }) => x.division === "FBS" || x.division === "FCS");
console.log(`leansDigest: ${leansDigest(d1, slate.date).length} chars`);
const id = slate.games[0]?.id;
if (id) {
  const t1 = performance.now();
  const g = await fetch(`${base}/api/game?id=${id}`);
  const game = await g.json();
  console.log(`GET /api/game?id=${id} -> ${g.status} in ${Math.round(performance.now() - t1)}ms; ${game.away?.short} @ ${game.home?.short}, ${game.status}, ${game.prospects?.length ?? 0} prospects, ${game.matchups?.length ?? 0} matchups`);
  if (g.ok) console.log(`gameDigest: ${gameDigest(game).length} chars`);
}
