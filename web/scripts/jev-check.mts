/**
 * Runs each Jev use once against real data and prints the probabilities so we can eyeball calibration.
 *   npx tsx scripts/jev-check.mts
 * Uses: feed classification (judgeFeed) on real Bluesky, Reddit, and news posts; availability notes;
 * report verification (verifyReport on a cached report); flip ranking (flipScoreJev) on live games
 * when the slate loads, or on synthetic situations laid over real matchups when it does not.
 *
 * Works without CFBD: matchups and radar players come from data/archive/<season> and the cached
 * reports from data/ai/reports. Tries the live slate first and falls back when CFBD refuses (429).
 * Needs TYPESAFE_API_KEY in .env.local. Each run appends to data/ai/usage.jsonl.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

for (const line of existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { jevAvailable, lastJevError, batchNouls } = await import("../src/lib/jev");
const { feedForTeams, judgeFeed, availabilityNotes, chipsFor } = await import("../src/lib/feed");
const { buildPacket, verifyReport, readReport, reportSentences, numbersIn } = await import("../src/lib/report");
const { flipScoreJev, FLIP_LEVELS } = await import("../src/lib/flip-jev");
const { flipScore } = await import("../src/lib/live");
import type { Game } from "../src/lib/types";
import type { FeedPlayer } from "../src/lib/feed";
import type { Packet } from "../src/lib/report";

const pct = (n: number) => `${String(Math.round(n * 100)).padStart(3)}%`;
const USAGE = path.join("data", "ai", "usage.jsonl");
function countUsage() {
  if (!existsSync(USAGE)) return { n: 0, ms: 0, tokens: 0, usd: 0 };
  let n = 0, ms = 0, tokens = 0, usd = 0;
  for (const l of readFileSync(USAGE, "utf8").split("\n")) {
    if (!l.includes('"provider":"typesafe"')) continue;
    try {
      const r = JSON.parse(l);
      n++; ms += r.ms; tokens += r.input; usd += r.costUsd;
    } catch {}
  }
  return { n, ms, tokens, usd };
}
const usageBefore = countUsage();

console.log(`Jev available: ${jevAvailable()}`);
if (!jevAvailable()) {
  console.log("Add TYPESAFE_API_KEY to .env.local and rerun.");
  process.exit(1);
}

/* ------------------------------------------------------ matchups, live or archive */

interface ArchiveEntry {
  gameId: string;
  season: number;
  pregame: { kickoff: string; away: string; home: string; abbr: { home: string; away: string }; scoutScore: number; whyWatch: string; pressurePoint: string; edges: { a: string; b: string; edge: string; why: string }[]; prospects: { id: string; name: string; team: string; pos: string; tier: string; score: number }[]; spread?: { team: string; line: number }; total?: number; projection?: { winner: string; winProb: number; margin: number; home: number; away: number; confidence: string; modelTotal?: number; totalLean?: string }; consensus?: { median: number; favorite: string; side: string; sideCount: number; of: number } };
}

function archiveEntries(): ArchiveEntry[] {
  const dir = path.join("data", "archive");
  if (!existsSync(dir)) return [];
  const out: ArchiveEntry[] = [];
  for (const season of readdirSync(dir)) {
    const sd = path.join(dir, season);
    for (const f of readdirSync(sd)) {
      if (!f.endsWith(".json")) continue;
      try {
        const e = JSON.parse(readFileSync(path.join(sd, f), "utf8")) as ArchiveEntry;
        if (e.pregame?.home) out.push(e);
      } catch {}
    }
  }
  return out.sort((a, b) => b.pregame.scoutScore - a.pregame.scoutScore);
}

/** A Game-shaped object with only the fields the Jev helpers read. */
function gameFromArchive(e: ArchiveEntry): Game {
  const p = e.pregame;
  return {
    id: e.gameId,
    home: { short: p.home, abbr: p.abbr.home, name: p.home } as Game["home"],
    away: { short: p.away, abbr: p.abbr.away, name: p.away } as Game["away"],
    kickoff: p.kickoff,
    status: "upcoming",
    market: { spread: p.spread ? { team: p.spread.team, line: p.spread.line, open: p.spread.line } : undefined, asOf: p.kickoff },
    prospects: p.prospects.map((x) => ({ id: x.id, name: x.name, team: x.team === p.home ? p.abbr.home : p.abbr.away, pos: x.pos })) as unknown as Game["prospects"],
  } as unknown as Game;
}

let games: Game[] = [];
let source = "live slate";
try {
  const { getSlate } = await import("../src/lib/slate");
  const slate = await getSlate();
  games = slate.games;
  console.log(`Slate ${slate.date}: ${games.length} games, ${games.filter((g) => g.status === "live").length} live`);
} catch (e) {
  source = "archive (CFBD refused the slate)";
  console.log(`Slate unavailable: ${e instanceof Error ? e.message.slice(0, 90) : e}`);
  games = archiveEntries().map(gameFromArchive);
  console.log(`Using ${games.length} archived matchups from data/archive instead.`);
}
const schoolOf = (g: Game, p: { team: string }) => (p.team === g.home.abbr ? g.home.short : g.away.short);

/* ------------------------------------------------------------------ 1. feed */
console.log(`\n=== 1. Feed classification (${source}; one Jev request per game, every tagged item x player) ===`);
const ranked = games.filter((g) => g.prospects.length).slice(0, 5);
let shown = 0;
let feedMs = 0;
for (const g of ranked) {
  const players: FeedPlayer[] = g.prospects.map((p) => ({ id: p.id, name: p.name, team: schoolOf(g, p), pos: p.pos }));
  const t0 = Date.now();
  const feed = await feedForTeams([g.away.short, g.home.short], players);
  const tagged = feed.items.filter((it) => it.tags.length);
  const t1 = Date.now();
  const judged = await judgeFeed(feed.items, players, { purpose: "jev-check", ref: g.id });
  const t2 = Date.now();
  feedMs += t2 - t1;
  console.log(`\n${g.away.short} at ${g.home.short}: ${feed.items.length} items, ${tagged.length} tagged, sources ${feed.sources.map((s) => `${s.label} ${s.ok ? s.count : "off"}`).join(", ")}, feed ${t1 - t0} ms, Jev ${t2 - t1} ms${lastJevError ? ` (error: ${lastJevError})` : ""}`);
  const names = new Map(players.map((p) => [p.id, p.name]));
  for (const it of judged) {
    if (!it.judged) continue;
    for (const [id, j] of Object.entries(it.judged)) {
      const chips = chipsFor(j);
      const dropped = it.droppedTags?.includes(id);
      console.log(`  [${it.kind}] ${it.author} on ${it.where ?? it.source}: "${it.text.replace(/\s+/g, " ").slice(0, 160)}"`);
      console.log(`     ${names.get(id)}: about-player ${pct(j.refersToPlayer)}${dropped ? " DROPPED" : ""} | injury ${pct(j.injury)} availability ${pct(j.availability)} promoted ${pct(j.promoted)} demoted ${pct(j.demoted)} praise ${pct(j.praise)}${chips.length ? ` -> chips ${chips.join(", ")}` : ""}`);
      shown++;
    }
  }
  const notes = availabilityNotes(judged);
  for (const n of Object.values(notes)) console.log(`  KEEP AN EYE ON ${names.get(n.playerId)}: ${n.lead} (${pct(n.probability)}), ${n.source}, ${n.url}`);
  if (shown >= 16) break;
}
if (!shown) console.log("  No tagged feed items for these matchups right now (sources off or no radar player named in the last 3 days).");

// 1b. Injury probe: real posts anywhere in the fetched feeds that use injury or availability words.
console.log("\n--- 1b. Real posts with injury or availability words (judged in one request) ---");
{
  const probe: { item: import("../src/lib/feed").FeedItem; players: FeedPlayer[] }[] = [];
  const seen = new Set<string>();
  for (const g of games.filter((x) => x.prospects.length).slice(0, 12)) {
    const players: FeedPlayer[] = g.prospects.map((p) => ({ id: p.id, name: p.name, team: schoolOf(g, p), pos: p.pos }));
    let feed;
    try {
      feed = await feedForTeams([g.away.short, g.home.short], players);
    } catch {
      continue;
    }
    for (const it of feed.items) {
      if (!it.tags.length || seen.has(it.id)) continue;
      if (!/injur|hurt|questionable|doubtful|out for|out with|ruled out|sidelined|suspend|benched|starter|starting|depth chart|surgery|carted|limp|return/i.test(it.text)) continue;
      seen.add(it.id);
      probe.push({ item: it, players });
    }
    if (probe.length >= 10) break;
  }
  if (!probe.length) console.log("  none found in the last 3 days across the top matchups");
  else {
    const allPlayers = new Map<string, FeedPlayer>();
    for (const p of probe) for (const pl of p.players) allPlayers.set(pl.id, pl);
    const judged = await judgeFeed(probe.map((p) => p.item), [...allPlayers.values()], { purpose: "jev-check", ref: "injury-probe" });
    for (const it of judged) {
      if (!it.judged) continue;
      for (const [id, j] of Object.entries(it.judged)) {
        const chips = chipsFor(j);
        console.log(`  [${it.kind}] ${it.author} on ${it.where ?? it.source}: "${it.text.replace(/\s+/g, " ").slice(0, 170)}"`);
        console.log(`     ${allPlayers.get(id)?.name}: about-player ${pct(j.refersToPlayer)}${it.droppedTags?.includes(id) ? " DROPPED" : ""} | injury ${pct(j.injury)} availability ${pct(j.availability)} promoted ${pct(j.promoted)} demoted ${pct(j.demoted)} praise ${pct(j.praise)}${chips.length ? ` -> chips ${chips.join(", ")}` : ""}`);
      }
    }
  }
}

// 1c. Planted posts with known answers, so each chip and the namesake drop get a true positive.
console.log("\n--- 1c. Planted posts (known answers, labeled) ---");
{
  const now = new Date().toISOString();
  const pl: FeedPlayer[] = [
    { id: "p1", name: "Gunner Stockton", team: "Georgia", pos: "QB" },
    { id: "p2", name: "Keelon Russell", team: "Alabama", pos: "QB" },
    { id: "p3", name: "Chris Cole", team: "Georgia", pos: "LB" },
  ];
  const mk = (id: string, kind: "fan" | "outlet" | "news", author: string, text: string, tags: string[]) => ({ id: `planted:${id}`, source: "bluesky" as const, kind, author, url: "https://example.invalid/" + id, text, publishedAt: now, tags, team: "Georgia", where: "Bluesky" });
  const items = [
    { expect: "injury + availability", it: mk("a", "outlet", "DawgNation", "Georgia QB Gunner Stockton (ankle) is questionable for Saturday after leaving practice early, per Kirby Smart.", ["p1"]) },
    { expect: "availability only (suspension)", it: mk("b", "news", "ESPN", "Georgia linebacker Chris Cole suspended for the first half against Alabama for a targeting call.", ["p3"]) },
    { expect: "promoted", it: mk("c", "outlet", "Tide 100.9", "Kalen DeBoer confirms Keelon Russell will start at quarterback for Alabama the rest of the season.", ["p2"]) },
    { expect: "demoted", it: mk("d", "news", "AL.com", "Alabama benches Keelon Russell after three first-half turnovers; backup takes over.", ["p2"]) },
    { expect: "namesake, drop tag", it: mk("e", "fan", "jazzfan", "Chris Cole's new record is the best jazz guitar album of the year, go listen.", ["p3"]) },
    { expect: "fan praise, not reporter praise", it: mk("f", "fan", "dawg4life", "Gunner Stockton is HIM. Best QB in the SEC and nobody can tell me otherwise.", ["p1"]) },
    { expect: "nothing (passing mention)", it: mk("g", "news", "Yahoo Sports", "SEC power rankings: Georgia, Alabama, and Texas A&M lead the way heading into October.", ["p1"]) },
    { expect: "returning (availability)", it: mk("h", "outlet", "247Sports", "Chris Cole cleared to return and will play Saturday after missing two games.", ["p3"]) },
  ];
  const judged = await judgeFeed(items.map((x) => x.it), pl, { purpose: "jev-check", ref: "planted" });
  judged.forEach((it, i) => {
    const id = items[i].it.tags[0];
    const j = it.judged?.[id];
    if (!j) {
      console.log(`  (no judgment) ${items[i].it.text}`);
      return;
    }
    const chips = chipsFor(j);
    console.log(`  expect ${items[i].expect}: "${items[i].it.text}"`);
    console.log(`     about-player ${pct(j.refersToPlayer)}${it.droppedTags?.includes(id) ? " DROPPED" : ""} | injury ${pct(j.injury)} availability ${pct(j.availability)} promoted ${pct(j.promoted)} demoted ${pct(j.demoted)} praise ${pct(j.praise)}${chips.length ? ` -> chips ${chips.join(", ")}` : ""}`);
  });
}

/* ---------------------------------------------------------------- 2. report */
console.log("\n=== 2. Report verification (one request, one Noul per sentence) ===");
const reportDir = path.join("data", "ai", "reports");
const cachedIds: { season: number; id: string }[] = [];
if (existsSync(reportDir)) for (const season of readdirSync(reportDir)) for (const f of readdirSync(path.join(reportDir, season))) if (f.endsWith(".json")) cachedIds.push({ season: Number(season), id: f.replace(".json", "") });
if (!cachedIds.length) console.log("  No cached report under data/ai/reports. Write one from a game page, then rerun.");
const archiveById = new Map(archiveEntries().map((e) => [e.gameId, e]));

/** Evidence from the archive lock when the live packet cannot be built. Smaller than the real packet, so expect more flags. */
function packetFromArchive(e: ArchiveEntry): Packet {
  const p = e.pregame;
  const facts: string[] = [];
  facts.push(`${p.away} (${p.abbr.away}) at ${p.home} (${p.abbr.home}). Kickoff ${p.kickoff}.`);
  facts.push(`Why watch: ${p.whyWatch}`);
  facts.push(`Pressure point: ${p.pressurePoint}`);
  for (const ed of p.edges) facts.push(`${ed.a} vs ${ed.b}: advantage ${ed.edge}. ${ed.why}`);
  for (const pr of p.prospects) facts.push(`${pr.name}, ${pr.team} ${pr.pos}, tier ${pr.tier}, radar score ${pr.score}.`);
  if (p.projection) facts.push(`Model projection (a model, not a pick): ${p.projection.winner} by ${p.projection.margin.toFixed(1)}, ${Math.round(p.projection.winProb * 100)}% to win, projected score ${p.abbr.away} ${p.projection.away}, ${p.abbr.home} ${p.projection.home}${p.projection.modelTotal ? `, model total ${p.projection.modelTotal}` : ""}. Confidence ${p.projection.confidence}.`);
  if (p.spread) facts.push(`Market: ${p.spread.team} ${p.spread.line}${p.total ? `, total ${p.total}` : ""}. Shown as context, not a pick.`);
  if (p.consensus) facts.push(`Consensus of outside systems: median ${p.consensus.median}, favorite ${p.consensus.favorite}, ${p.consensus.sideCount} of ${p.consensus.of} systems lean ${p.consensus.side}.`);
  const all = facts.join("\n");
  return { gameId: e.gameId, title: `${p.away} at ${p.home}`, pregame: true, evidenceAsOf: p.kickoff, facts: facts.map((text, i) => ({ id: `A${i + 1}`, text })), names: p.prospects.map((x) => x.name), numbers: [...new Set(numbersIn(all))], vocab: new Set(all.toLowerCase().match(/[a-z][a-z'.-]*/g) ?? []) };
}

for (const c of cachedIds.slice(0, 2)) {
  const cached = readReport(c.season, c.id);
  if (!cached?.report) {
    console.log(`  ${c.id}: no published report in the cache`);
    continue;
  }
  let packet: Packet | undefined;
  let how = "live packet";
  try {
    const { getGame } = await import("../src/lib/slate");
    const game = await getGame(c.id);
    if (game) packet = buildPacket(game);
  } catch {}
  if (!packet && cached.evidence?.length) {
    const all = cached.evidence.join("\n");
    packet = { gameId: c.id, title: c.id, pregame: cached.pregame, evidenceAsOf: cached.evidenceAsOf, facts: cached.evidence.map((text, i) => ({ id: `F${i + 1}`, text })), names: [], numbers: [...new Set(numbersIn(all))], vocab: new Set() };
    how = "evidence saved with the report";
  }
  if (!packet) {
    const e = archiveById.get(c.id);
    if (!e) {
      console.log(`  ${c.id} (${cached.report.headline}): no live game and no archive entry, skipped`);
      continue;
    }
    packet = packetFromArchive(e);
    how = "archive evidence, a subset of the real packet";
  }
  const sentences = reportSentences(cached.report);
  const t0 = Date.now();
  const v = await verifyReport(cached.report, packet, c.id);
  console.log(`\n${packet.title} (${c.id}): "${cached.report.headline}". ${sentences.length} sentences vs ${packet.facts.length} facts (${how}), ${Date.now() - t0} ms${v ? "" : ` FAILED ${lastJevError ?? ""}`}`);
  if (!v) continue;
  console.log(`  flagged under 50%: ${v.flags.length}`);
  for (const f of v.flags) console.log(`   ${pct(f.supported)}  ${f.sentence}`);
  const evidence = packet.facts.map((f) => f.text).join("\n");
  const q = "Is ITEM.sentence fully supported by `evidence`? Every fact, number, name, and comparison in the sentence must appear in or follow directly from `evidence`. A general framing sentence with no checkable claim counts as supported.";
  const rows = await batchNouls(sentences.map((sentence) => ({ sentence })), { supported: q }, { shared: { evidence }, purpose: "jev-check", timeoutMs: 8000, chunk: 60 });
  if (rows) {
    const sorted = rows.map((r, i) => ({ p: r.supported, s: sentences[i] })).sort((a, b) => a.p - b.p);
    console.log("  lowest five:");
    for (const r of sorted.slice(0, 5)) console.log(`   ${pct(r.p)}  ${r.s.slice(0, 150)}`);
    console.log("  highest three:");
    for (const r of sorted.slice(-3)) console.log(`   ${pct(r.p)}  ${r.s.slice(0, 150)}`);
  }
  // Planted errors: a number nudged, an invented injury, an invented name. All should come back low.
  const numbered = sentences.find((s) => /\d/.test(s)) ?? sentences[1];
  const planted = [
    numbered.replace(/\d+/, (m) => String(Number(m) + 7)),
    `${packet.title.split(" at ")[1]} will win because the starting quarterback is playing through a broken hand.`,
    `Marcus Delaney is the best lineman on the field and should go in the first round.`,
  ];
  const pr = await batchNouls(planted.map((sentence) => ({ sentence })), { supported: q }, { shared: { evidence }, purpose: "jev-check", timeoutMs: 8000 });
  if (pr) {
    console.log("  planted errors (should be low):");
    pr.forEach((r, i) => console.log(`   ${pct(r.supported)}  ${planted[i].slice(0, 150)}`));
  }
}

/* ------------------------------------------------------------------ 3. flip */
console.log("\n=== 3. Flip ranking (one Score per live game, one request) ===");
console.log("levels: " + FLIP_LEVELS.map((l, i) => `${i}=${l.split(":")[0]}`).join(", "));
let liveGames = games.filter((g) => g.status === "live" && g.live);
let synthetic = false;
if (!liveGames.length) {
  synthetic = true;
  const base = games.slice(0, 7);
  const situations = [
    { period: 4, clock: "1:48", margin: 3, swing: 0.22, hwp: 0.55, dd: "3rd & 4 at the 38", poss: "away", label: "one score, under two minutes, trailing team driving" },
    { period: 4, clock: "9:10", margin: 24, swing: 0.01, hwp: 0.99, dd: "1st & 10 at own 25", poss: "home", label: "24 point lead, fourth quarter" },
    { period: 2, clock: "7:30", margin: 7, swing: 0.08, hwp: 0.62, dd: "2nd & 6 at midfield", poss: "home", label: "one score, second quarter" },
    { period: 3, clock: "2:15", margin: 14, swing: 0.05, hwp: 0.85, dd: "1st & 10 at own 40", poss: "away", label: "two scores, late third" },
    { period: 5, clock: "0:00", margin: 0, swing: 0.35, hwp: 0.5, dd: "1st & goal at the 25 (overtime)", poss: "home", label: "overtime" },
    { period: 4, clock: "0:31", margin: 4, swing: 0.3, hwp: 0.42, dd: "4th & 2 at the 12", poss: "away", label: "fourth and two, red zone, 31 seconds, down four" },
    { period: 1, clock: "11:02", margin: 0, swing: 0.0, hwp: 0.5, dd: "1st & 10 at own 20", poss: "away", label: "scoreless, first quarter" },
  ];
  liveGames = base.map((g, i) => {
    const s = situations[i % situations.length];
    const homeScore = 24;
    return {
      ...g,
      status: "live" as const,
      score: { home: homeScore, away: homeScore - s.margin, clock: s.clock },
      live: { period: s.period, clock: `${s.clock} ${s.period === 5 ? "OT" : `Q${s.period}`}`, possession: s.poss === "home" ? g.home.abbr : g.away.abbr, downDistance: s.dd, homeWinProb: s.hwp, awayWinProb: 1 - s.hwp, swing: s.swing, swingMinutes: 12, closeness: 1 - Math.abs(s.hwp - 0.5) * 2, asOf: new Date().toISOString() },
      syntheticLabel: s.label,
    } as Game & { syntheticLabel: string };
  });
}
if (!liveGames.length) console.log("  No games to rank.");
else {
  const t0 = Date.now();
  const flips = await flipScoreJev(liveGames);
  console.log(`${synthetic ? "SYNTHETIC situations laid over real matchups" : "LIVE"}: ${liveGames.length} games, ${Date.now() - t0} ms${Object.keys(flips).length ? "" : ` FAILED ${lastJevError ?? ""}`}`);
  const rows = liveGames.map((g) => ({ g, j: flips[g.id] })).sort((a, b) => (b.j?.flip ?? -1) - (a.j?.flip ?? -1));
  for (const { g, j } of rows) {
    const l = g.live!;
    const label = (g as Game & { syntheticLabel?: string }).syntheticLabel;
    console.log(`  ${(j ? String(j.flip).padStart(3) : "n/a")} jev | ${String(flipScore(g)).padStart(3)} numeric | lvl ${j ? j.level.toFixed(2) : "-"} conf ${j ? j.confidence.toFixed(2) : "-"} | ${g.away.abbr} ${g.score?.away} at ${g.home.abbr} ${g.score?.home}, ${l.clock}, ${l.downDistance ?? ""}, hwp ${l.homeWinProb !== undefined ? pct(l.homeWinProb) : "n/a"}, swing ${l.swing !== undefined ? pct(Math.abs(l.swing)) : "n/a"}${j ? ` | p=[${j.probabilities.map((p) => Math.round(p * 100)).join(",")}]` : ""}${label ? ` | ${label}` : ""}`);
  }
}

/* ----------------------------------------------------------------- totals */
const after = countUsage();
const d = { n: after.n - usageBefore.n, ms: after.ms - usageBefore.ms, tokens: after.tokens - usageBefore.tokens, usd: after.usd - usageBefore.usd };
console.log(`\nThis run: ${d.n} Jev requests, ${d.tokens} input tokens, ${d.ms} ms in Jev (${d.n ? Math.round(d.ms / d.n) : 0} ms avg per request, feed judging ${feedMs} ms), $${d.usd.toFixed(5)} at $0.042 per Mtok.`);
process.exit(0);
