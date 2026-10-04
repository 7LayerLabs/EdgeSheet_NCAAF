#!/usr/bin/env node
/**
 * Write watch guides (the Why watch viewing guide) for a date's Division I games.
 *
 * By default it talks to the running server's /api/watchguide, which has the CFBD fetch cache
 * and the memoized slate, so a day's guides cost no extra CFBD calls. With --local it runs
 * in-process through tsx (needs a working CFBD quota).
 *
 *   npm run guides                       # today's Division I games (ET), via the server
 *   npm run guides -- --date 2026-10-10
 *   npm run guides -- --limit 5          # top N by Scout Score
 *   npm run guides -- --ids 401858249,401856706
 *   npm run guides -- --force            # rewrite even when the evidence version matches
 *   npm run guides -- --dry              # list, do not write
 *   npm run guides -- --show 2           # print N finished guides to the console (default 2)
 *   npm run guides -- --local            # in-process instead of through the server
 *   BASE=http://localhost:3000 (default)
 *
 * Cached guides whose evidence version matches are skipped (free). Budget: about 2,500 input and
 * 500 output tokens per guide on claude-sonnet-5, roughly 1 cent, plus one small Jev request.
 * --budget 5 (dollars) is the hard stop.
 */
import { readdirSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = process.env.BASE || "http://localhost:3000";
const limit = Number(opt("limit") || 0) || Infinity;
const force = flag("force");
const show = Number(opt("show") ?? 2);
const BUDGET = Number(opt("budget") || 5);
const local = flag("local");
const ET = "America/New_York";
const etDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const date = opt("date") || etDate();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * --from-cache (with --local): when CFBD answers 429 or 503, serve the response the running
 * server already has in .next/cache/fetch-cache for that URL. Lets guides be written while the
 * monthly CFBD quota is exhausted; the data is as fresh as the server's last successful fetch.
 */
function installCacheFallback() {
  const dir = ".next/cache/fetch-cache";
  const byUrl = new Map();
  try {
    for (const f of readdirSync(dir)) {
      try {
        const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
        if (j.kind === "FETCH" && j.data?.url && j.data.status === 200) byUrl.set(j.data.url, j.data);
      } catch {}
    }
  } catch {}
  const real = globalThis.fetch;
  let served = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const res = await real(input, init);
    if (res.ok || !/collegefootballdata\.com/.test(url) || (res.status !== 429 && res.status !== 503)) return res;
    const hit = byUrl.get(url);
    if (!hit) return res;
    served++;
    const body = Buffer.from(hit.body, "base64").toString("utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  process.on("exit", () => served && console.log(`(${served} CFBD responses served from the server's fetch cache)`));
  console.log(`CFBD fallback: ${byUrl.size} cached responses available`);
}

/* ------------------------------------------------------------ backends */

async function serverBackend() {
  return {
    name: `server ${BASE}`,
    async list(d) {
      const res = await fetch(`${BASE}/api/watchguide?date=${d}`);
      if (!res.ok) throw new Error(`server ${res.status}: ${await res.text().catch(() => "")}`);
      const j = await res.json();
      return { date: j.date, games: j.games };
    },
    async write(id) {
      const res = await fetch(`${BASE}/api/watchguide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, force }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) return { missing: true };
      if (j.unavailable) return { unavailable: j.error };
      if (!res.ok && !j.failed) throw new Error(`server ${res.status}: ${j.error || "unknown"}`);
      return j;
    },
  };
}

async function localBackend() {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const k of ["CFBD_API_KEY", "ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "ODDS_API_KEY"]) {
      if (process.env[k]) continue;
      const m = new RegExp(`^\\s*${k}\\s*=\\s*(.+)\\s*$`, "m").exec(env);
      if (m) process.env[k] = m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  if (flag("from-cache")) installCacheFallback();
  const { getSlate, getGame } = await import("../src/lib/slate");
  const { scoutScore } = await import("../src/lib/score");
  const { generateWatchGuide, readGuide } = await import("../src/lib/watchguide");
  const { seasonOf } = await import("../src/lib/report");
  const { isUnavailable } = await import("../src/lib/llm");
  return {
    name: "in-process",
    async list(d) {
      const slate = await getSlate(d);
      return {
        date: slate.date,
        games: slate.games
          .filter((g) => g.division === "FBS" || g.division === "FCS")
          .map((g) => ({ id: g.id, label: `${g.away.short} at ${g.home.short}`, status: g.status, score: scoutScore(g.scoreComponents), guide: Boolean(readGuide(seasonOf(g.kickoff), g.id)?.guide) }))
          .sort((a, b) => b.score - a.score),
      };
    },
    async write(id) {
      const game = await getGame(id);
      if (!game) return { missing: true };
      const prior = readGuide(seasonOf(game.kickoff), game.id)?.generatedAt;
      const out = await generateWatchGuide(game, { force });
      if (isUnavailable(out)) return { unavailable: out.unavailable };
      return { ok: Boolean(out.guide), title: `${game.away.short} at ${game.home.short}`, status: game.status, guide: out.guide, failed: out.failed, model: out.model, ranker: out.ranker, rankerNote: out.rankerNote, attempts: out.attempts, attemptLog: out.attemptLog, candidateCount: out.candidateCount, top: out.top, evidenceVersion: out.evidenceVersion, costUsd: out.usage.costUsd, cached: out.generatedAt === prior };
    },
  };
}

const backend = local ? await localBackend() : await serverBackend();

/* ----------------------------------------------------------------- list */

let ids = (opt("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!ids.length) {
  const { date: slateDate, games } = await backend.list(date);
  console.log(`${games.length} Division I games on ${slateDate}${slateDate !== date ? ` (asked for ${date}; this is the next slate date with games)` : ""}${Number.isFinite(limit) ? `, taking the top ${Math.min(limit, games.length)} by Scout Score` : ""} [${backend.name}]`);
  for (const r of games.slice(0, limit)) console.log(`  ${r.id}  ${r.label.padEnd(40)} ${r.status.padEnd(9)} score ${String(r.score).padStart(3)}${r.guide ? "  guide cached" : ""}`);
  ids = games.slice(0, limit).map((r) => r.id);
}
if (flag("dry") || !ids.length) process.exit(0);

/* ---------------------------------------------------------------- write */

let cost = 0;
let written = 0;
let skipped = 0;
let failed = 0;
const finished = [];
for (const id of ids) {
  const started = Date.now();
  process.stdout.write(`${id} ... `);
  try {
    const out = await backend.write(id);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (out.missing) {
      failed++;
      console.log("no such game (or CFBD could not be reached for it)");
      continue;
    }
    if (out.unavailable) {
      console.log(`stopped: ${out.unavailable}`);
      break;
    }
    if (out.ok && out.cached) {
      skipped++;
      console.log(`${out.title}: cached (evidence ${out.evidenceVersion}), skipped`);
      continue;
    }
    cost += out.costUsd || 0;
    if (out.ok) {
      written++;
      finished.push(out);
      console.log(`${out.title}: written by ${out.model}, ranked by ${out.ranker}${out.rankerNote ? ` (${out.rankerNote})` : ""}, ${out.attempts} attempt${out.attempts === 1 ? "" : "s"}, ${out.candidateCount} candidates, $${(out.costUsd || 0).toFixed(4)}, ${secs}s`);
      if (out.attempts > 1) console.log(`    attempt 1 rejected: ${out.attemptLog[0].join(" / ")}`);
    } else {
      failed++;
      console.log(`${out.title ?? id}: NOT published after ${out.attempts} attempt${out.attempts === 1 ? "" : "s"} ($${(out.costUsd || 0).toFixed(4)}): ${out.failed?.reasons.join(" / ")}`);
      for (const [i, log] of (out.attemptLog ?? []).entries()) console.log(`    attempt ${i + 1}: ${log.length ? log.join(" / ") : "passed"}`);
    }
  } catch (err) {
    failed++;
    console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (cost >= BUDGET) {
    console.log(`Budget of $${BUDGET} reached, stopping.`);
    break;
  }
  await sleep(1200);
}

console.log(`\n${written} written, ${skipped} cached, ${failed} not published, about $${cost.toFixed(3)} spent${written ? ` ($${(cost / written).toFixed(4)} per guide written)` : ""}.`);

for (const out of finished.slice(0, show)) {
  const g = out.guide;
  console.log(`\n==== ${out.title} (${out.status}) ====`);
  console.log(`HEADLINE: ${g.headline}`);
  console.log(`HOOK: ${g.hook}`);
  g.items.forEach((it, i) => {
    console.log(`\n${i + 1}. ${it.title}  [${it.who}${it.whoPlayerId ? `, id ${it.whoPlayerId}` : ""}]`);
    console.log(`   ${it.what}`);
    console.log(`   When: ${it.when}   (facts ${it.factIds.join(", ")})`);
  });
  console.log(`CARD: ${g.cardLine}`);
  console.log(`ranked by ${out.ranker}; top five: ${out.top.map((t) => `${t.id}:${t.kind}${t.jev !== undefined ? `@${t.jev.toFixed(2)}` : ""}`).join(", ")}`);
}
