#!/usr/bin/env node
/**
 * EdgeSheet healthcheck. Curls the pages a reader would hit, checks that they
 * are real pages and not the error boundary, checks that Telegram is ready,
 * and exits non-zero with a plain message when anything is wrong.
 *
 *   node scripts/healthcheck.mjs                  # print the checks, exit 1 on failure
 *   node scripts/healthcheck.mjs --notify         # also send a Telegram message on failure (and once on recovery)
 *   node scripts/healthcheck.mjs --base http://100.68.230.36:3000
 *
 * Checks: GET /, /radar, /history, one Division I game page (picked from
 * /api/slate), and /api/notify (reports Telegram readiness from the server's
 * own env). A page passes when it answers 200 within 60s, contains the site
 * shell, and does not contain the error-boundary heading.
 *
 * PM2, every 15 minutes, quiet unless something breaks:
 *
 *   pm2 start scripts/healthcheck.mjs --name scout-health --cron "*\/15 * * * *" --no-autorestart --time -- --notify
 *
 * Telegram alerts go through src/lib/telegram.ts (loaded with tsx). Sending a
 * message does not conflict with the bot process; only long polling does.
 * To avoid a message every 15 minutes during a long outage, alerts repeat at
 * most once an hour while failing and send one "back up" note on recovery.
 * State lives in data/healthcheck-state.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(WEB);
const args = process.argv.slice(2);
const NOTIFY = args.includes("--notify");
const baseArg = args.indexOf("--base");
const BASE = (baseArg >= 0 ? args[baseArg + 1] : process.env.HEALTHCHECK_BASE_URL) || "http://localhost:3000";
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 60_000);
const REPEAT_ALERT_MS = 60 * 60 * 1000;
const STATE_FILE = path.join(WEB, "data", "healthcheck-state.json");
const ENV_FILE = path.join(WEB, ".env.local");

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv(ENV_FILE);

/* ---------------------------------------------------------------- checks */

async function get(pathname) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${pathname}`, { signal: ctl.signal, headers: { "User-Agent": "edgesheet-healthcheck" } });
    const text = await res.text();
    return { status: res.status, text, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { status: 0, text: "", ms: Math.round(performance.now() - t0), error: e?.name === "AbortError" ? `no answer in ${TIMEOUT_MS / 1000}s` : e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function pageProblem(r, { game = false } = {}) {
  if (r.error) return r.error;
  if (r.status !== 200) return `HTTP ${r.status}`;
  if (!r.text.includes("EdgeSheet")) return "answered 200 but the site shell is missing";
  if (r.text.includes("This page could not load") || r.text.includes("This game could not be built")) return "rendered the error boundary";
  // A game page that cannot be built calls notFound(), which streams inside a 200. The jump bar id is only on a real game page.
  if (game && !r.text.includes('id="why"')) return "rendered as not found (game lookup failed; check the CFBD quota, a 429 looks exactly like this)";
  return null;
}

const problems = [];
const lines = [];

function record(name, ms, problem) {
  const tag = problem ? "FAIL" : "ok  ";
  const line = `${tag} ${String(ms).padStart(6)}ms  ${name}${problem ? `  ${problem}` : ""}`;
  lines.push(line);
  log(line);
  if (problem) problems.push(`${name}: ${problem}`);
}

// 1. Pages.
let homeHtml = "";
for (const p of ["/", "/radar", "/history"]) {
  const r = await get(p);
  if (p === "/") homeHtml = r.text;
  record(p, r.ms, pageProblem(r));
}

// 2. One Division I game page, picked from the slate API (nearest kickoff, live first).
//    Builds without /api/slate fall back to the first game link on the slate page.
{
  const r = await get("/api/slate");
  let gameId;
  let label = "/game/<none>";
  if (r.status === 404) {
    const m = homeHtml.match(/href="\/game\/(\d+)"/);
    if (m) {
      gameId = m[1];
      label = `/game/${gameId} (first link on the slate page)`;
    }
    record("/api/slate", r.ms, gameId ? null : "route missing on this build and no game links on the slate page");
  } else if (r.status === 200) {
    try {
      const slate = JSON.parse(r.text);
      const games = (slate.weekGames ?? []).filter((g) => g.division === "FBS" || g.division === "FCS");
      const now = Date.now();
      const pick = games.find((g) => g.status === "live") ?? games.filter((g) => Date.parse(g.kickoff) >= now).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0] ?? games[0];
      if (pick) {
        gameId = pick.id;
        label = `/game/${pick.id} (${pick.away} @ ${pick.home}, ${pick.status})`;
      }
      record("/api/slate", r.ms, games.length ? null : slate.source === "sample" ? "CFBD_API_KEY missing, sample slate" : "no Division I games in the week");
    } catch {
      record("/api/slate", r.ms, "not JSON");
    }
  } else record("/api/slate", r.ms, r.error ?? `HTTP ${r.status}`);
  if (gameId) {
    const g = await get(`/game/${gameId}`);
    record(label, g.ms, pageProblem(g, { game: true }));
  }
}

// 3. Telegram readiness, as the server sees it.
{
  const r = await get("/api/notify");
  let problem = r.error ?? (r.status === 200 ? null : `HTTP ${r.status}`);
  if (!problem) {
    try {
      const j = JSON.parse(r.text);
      if (!j.ready) problem = `Telegram not ready: ${j.missing ?? "unknown"}`;
    } catch {
      problem = "not JSON";
    }
  }
  record("/api/notify (Telegram readiness)", r.ms, problem);
}

/* ------------------------------------------------------------ state + alert */

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { failing: false, lastAlertAt: null, failingSince: null };
  }
}
function writeState(s) {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

async function telegram(text) {
  if (!NOTIFY) return;
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    log("healthcheck: cannot send the alert, TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env.local");
    return;
  }
  try {
    const { register: registerEsm } = await import("tsx/esm/api");
    const { register: registerCjs } = await import("tsx/cjs/api");
    registerCjs();
    registerEsm();
    const tg = await import("../src/lib/telegram.ts");
    await tg.sendMessage(text, { parseMode: "HTML", disablePreview: true });
    log("healthcheck: Telegram alert sent");
  } catch (e) {
    log(`healthcheck: Telegram send failed: ${e?.message ?? e}`);
  }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const state = readState();
const now = Date.now();

if (problems.length) {
  const since = state.failing && state.failingSince ? state.failingSince : new Date(now).toISOString();
  const repeat = !state.lastAlertAt || now - Date.parse(state.lastAlertAt) >= REPEAT_ALERT_MS;
  const shouldAlert = !state.failing || repeat;
  console.error(`\nHEALTHCHECK FAILED (${problems.length} of ${lines.length} checks) against ${BASE}\n  ${problems.join("\n  ")}`);
  if (shouldAlert) {
    await telegram(`<b>EdgeSheet healthcheck failed</b> (${BASE})\n${problems.map((p) => `• ${esc(p)}`).join("\n")}\n<i>failing since ${since.replace("T", " ").slice(0, 16)} UTC</i>`);
    writeState({ failing: true, failingSince: since, lastAlertAt: new Date(now).toISOString() });
  } else {
    log("healthcheck: still failing, alert already sent within the hour");
    writeState({ ...state, failing: true, failingSince: since });
  }
  // exitCode, not process.exit: on Windows, exiting with fetch handles still open trips a libuv assertion.
  process.exitCode = 1;
} else {
  log(`healthcheck: all ${lines.length} checks passed against ${BASE}`);
  if (state.failing) {
    await telegram(`<b>EdgeSheet is back</b> (${BASE}). All ${lines.length} checks pass.`);
  }
  writeState({ failing: false, failingSince: null, lastAlertAt: state.lastAlertAt ?? null });
}
