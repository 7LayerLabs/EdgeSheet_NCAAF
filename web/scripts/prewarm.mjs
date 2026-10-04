#!/usr/bin/env node
/**
 * Prewarm the EdgeSheet server so the first visitor never waits for a cold build.
 *
 *   node scripts/prewarm.mjs                 # run now against http://localhost:3000
 *   node scripts/prewarm.mjs --scheduled     # only run when the ET schedule says so (for PM2 cron)
 *   node scripts/prewarm.mjs --base http://100.68.230.36:3000
 *
 * What it hits, in order, one request at a time with a short pause:
 *   /api/slate (warms the slate memo and tells us the week), / for today,
 *   /?date=... for the week's other slate days, /radar, /draft, /rankings,
 *   /history, /sheet, then /game/<id> for every Division I game that is live
 *   or kicks off in the next 6 hours.
 *
 * Schedule (Eastern), enforced only with --scheduled:
 *   Saturday 9:00 AM through Sunday 1:00 AM   every 10 minutes
 *   any other time                            every 30 minutes (the :00 and :30 ticks)
 * PM2 fires the process every 10 minutes and the script decides whether this
 * tick is one of its own:
 *
 *   pm2 start scripts/prewarm.mjs --name scout-prewarm --cron "*\/10 * * * *" --no-autorestart --time -- --scheduled
 *
 * Exit code is 0 unless the slate endpoint itself cannot be reached.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const SCHEDULED = args.includes("--scheduled");
const baseArg = args.indexOf("--base");
const BASE = (baseArg >= 0 ? args[baseArg + 1] : process.env.PREWARM_BASE_URL) || "http://localhost:3000";
const PAUSE_MS = Number(process.env.PREWARM_PAUSE_MS ?? 400);
const TIMEOUT_MS = Number(process.env.PREWARM_TIMEOUT_MS ?? 90_000);
const KICKOFF_HOURS = 6;
const ET = "America/New_York";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- schedule */

function etParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "numeric", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** Saturday 9 AM through Sunday 1 AM ET is the fast window. */
function inFastWindow(p) {
  if (p.weekday === "Sat" && p.hour >= 9) return true;
  if (p.weekday === "Sun" && p.hour < 1) return true;
  return false;
}

function shouldRun() {
  if (!SCHEDULED) return { run: true, why: "manual" };
  const p = etParts();
  if (inFastWindow(p)) return { run: true, why: `Saturday window (${p.weekday} ${p.hour}:${String(p.minute).padStart(2, "0")} ET), every 10 min` };
  // PM2 fires every 10 minutes; take the ticks that land in the first 10 minutes of each half hour.
  const tick = p.minute % 30;
  if (tick < 10) return { run: true, why: `quiet schedule, :00/:30 tick (${p.weekday} ${p.hour}:${String(p.minute).padStart(2, "0")} ET)` };
  return { run: false, why: `quiet schedule, skipping the :${String(p.minute).padStart(2, "0")} tick` };
}

/* ---------------------------------------------------------------- fetch */

async function hit(pathname, { optional = false } = {}) {
  const url = `${BASE}${pathname}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "edgesheet-prewarm" } });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    const kb = Math.round(text.length / 1024);
    const ok = res.ok;
    const tag = ok ? "ok  " : optional && res.status === 404 ? "skip" : "FAIL";
    log(`${tag} ${String(res.status).padEnd(3)} ${String(ms).padStart(6)}ms ${String(kb).padStart(5)}kB ${pathname}`);
    return { pathname, status: res.status, ms, kb, ok, text };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    log(`FAIL ---  ${String(ms).padStart(6)}ms       ${pathname}  ${e?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : e?.message ?? e}`);
    return { pathname, status: 0, ms, kb: 0, ok: false, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------- main */

/**
 * Builds older than the /api/slate route (or a server that cannot answer it)
 * fall back to the links on the slate page: every /game/<id> on today's page
 * plus the ?date= day links. No kickoff info there, so every game on the page
 * is warmed, which is still the right set on a game day.
 */
function slateFromHtml(html) {
  const games = [...new Set([...html.matchAll(/href="\/game\/(\d+)"/g)].map((m) => m[1]))].map((id) => ({ id, status: "unknown", division: "FBS", kickoff: "", home: "", away: "" }));
  const days = [...new Set([...html.matchAll(/href="\/\?date=(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]))].map((date) => ({ date, count: 0 }));
  return { source: "html", date: "", days, games, weekGames: games };
}

async function main() {
  const decision = shouldRun();
  if (!decision.run) {
    log(`prewarm: ${decision.why}`);
    return 0;
  }
  log(`prewarm: ${decision.why}; base ${BASE}`);

  const results = [];
  const started = performance.now();

  let slate;
  const slateRes = await hit("/api/slate", { optional: true });
  results.push(slateRes);
  if (slateRes.ok) {
    try {
      slate = JSON.parse(slateRes.text);
    } catch {
      log("prewarm: /api/slate returned something that is not JSON, falling back to the slate page links");
    }
  }
  if (!slate) {
    await sleep(PAUSE_MS);
    const home = await hit("/");
    results.push(home);
    if (!home.ok) {
      log("prewarm: the slate page did not answer, nothing else to warm");
      return 1;
    }
    slate = slateFromHtml(home.text);
    log(`prewarm: /api/slate unavailable on this build, using ${slate.games.length} game links and ${slate.days.length} day links from the slate page`);
  }

  // CFBD monthly quota gone: the slate itself runs on ESPN, but game pages, other slate days, and
  // rankings would each try CFBD. Warm only the pages that read local files, and say so.
  const quotaOut = Boolean(slate.cfbdQuota?.exhausted);
  if (quotaOut) log(`prewarm: CFBD monthly quota is exhausted until ${slate.cfbdQuota.until}; skipping game pages, other days, and rankings`);

  const pages = slate.source === "html" ? [] : ["/"];
  if (!quotaOut) for (const d of slate.days ?? []) if (d.date !== slate.date) pages.push(`/?date=${d.date}`);
  pages.push("/radar", "/draft");
  if (!quotaOut) pages.push("/rankings");
  pages.push("/history");

  const now = Date.now();
  const soon = now + KICKOFF_HOURS * 3600 * 1000;
  const gamePages = (quotaOut ? [] : slate.weekGames ?? [])
    .filter((g) => g.division === "FBS" || g.division === "FCS")
    .filter((g) => {
      if (g.status === "live" || g.status === "unknown") return true;
      const t = Date.parse(g.kickoff);
      return g.status === "upcoming" && Number.isFinite(t) && t >= now - 15 * 60 * 1000 && t <= soon;
    })
    .sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) || Date.parse(a.kickoff) - Date.parse(b.kickoff));

  log(`prewarm: ${pages.length} pages, 1 optional page, ${gamePages.length} game pages (live or kickoff within ${KICKOFF_HOURS}h)`);

  for (const p of pages) {
    await sleep(PAUSE_MS);
    results.push(await hit(p));
  }
  await sleep(PAUSE_MS);
  results.push(await hit("/sheet", { optional: true }));
  let notFound = 0;
  for (const g of gamePages) {
    await sleep(PAUSE_MS);
    const r = await hit(`/game/${g.id}`);
    if (g.home) r.label = `${g.away} @ ${g.home} (${g.status})`;
    // A game the server could not build calls notFound() inside a streamed 200. Only a real game page carries the jump bar.
    if (r.ok && !r.text.includes('id="why"')) {
      r.notFound = true;
      notFound++;
      log(`     ^ rendered as not found (game lookup failed; a CFBD 429 looks exactly like this)`);
    }
    results.push(r);
  }

  const total = Math.round(performance.now() - started);
  const optional404 = (r) => (r.pathname === "/sheet" || r.pathname === "/api/slate") && r.status === 404;
  const failed = results.filter((r) => !r.ok && !optional404(r));
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
  log(`prewarm: done, ${results.length} requests in ${(total / 1000).toFixed(1)}s, ${failed.length} failed, ${notFound} game pages rendered as not found`);
  log(`prewarm: slowest ${slowest.map((r) => `${r.pathname} ${r.ms}ms`).join(", ")}`);
  if (failed.length) log(`prewarm: failed ${failed.map((r) => `${r.pathname} (${r.status || "no response"})`).join(", ")}`);

  // Keep the last run's numbers for the healthcheck and for curiosity.
  try {
    mkdirSync(path.join(WEB, "data"), { recursive: true });
    writeFileSync(
      path.join(WEB, "data", "prewarm-last.json"),
      JSON.stringify({ at: new Date().toISOString(), base: BASE, totalMs: total, failed: failed.length, results: results.map(({ text: _t, ...r }) => r) }, null, 2),
    );
  } catch {}
  return 0;
}

// process.exitCode instead of process.exit: on Windows, exiting with fetch handles still open trips a libuv assertion.
process.exitCode = await main();
