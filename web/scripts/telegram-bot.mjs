#!/usr/bin/env node
/**
 * EdgeSheet Telegram bot. Long-running process for PM2:
 *
 *   cd web && pm2 start scripts/telegram-bot.mjs --name scout-telegram --time
 *
 * Schedule (all Eastern time):
 *   - Morning slate at 8:00 AM on any day with Division I games.
 *   - Kickoff reminders every 15 minutes while games are in a window, for
 *     followed teams (data/follows.json) with a kickoff in the next 60 minutes.
 *   - Postgame grades every 10 minutes while games are live or recently final,
 *     plus radar alerts for followed players who showed up. Hourly otherwise.
 *   - Commands by long polling: /slate, /leans, /record, /radar <team>, /game <team>, /help.
 *
 * The app's libraries are TypeScript; this script registers tsx and imports
 * them directly. Env comes from web/.env.local. State lives in
 * data/telegram-state.json (cursor, reminders sent, radar alerts sent).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerEsm } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(WEB); // the libs resolve data/ and tsconfig paths from cwd
const ENV_FILE = path.join(WEB, ".env.local");
const STATE_FILE = path.join(WEB, "data", "telegram-state.json");
const ET = "America/New_York";

loadEnv(ENV_FILE);
registerCjs();
registerEsm();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), ...a);

/* ----------------------------------------------------------------- env */

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// Wait for the token instead of crash-looping under PM2. Re-reads .env.local every 5 minutes.
while (!process.env.TELEGRAM_BOT_TOKEN) {
  warn("TELEGRAM_BOT_TOKEN is not set in web/.env.local. Get a token from @BotFather, add it, and this process will pick it up within 5 minutes (or pm2 restart scout-telegram).");
  await sleep(5 * 60_000);
  loadEnv(ENV_FILE);
}

/* ------------------------------------------------------------ app libs */

const tg = await import("../src/lib/telegram.ts");
const digests = await import("../src/lib/digests.ts");
const slateLib = await import("../src/lib/slate.ts");
const archive = await import("../src/lib/archive.ts");
const follows = await import("../src/lib/follows.ts");
const radar = await import("../src/lib/radar.ts");
const movement = await import("../src/lib/movement.ts");
// Live loop (followed-player big plays, followed-team score changes) and the /plan command.
const espn = await import("../src/lib/espn.ts");
const playerlog = await import("../src/lib/playerlog.ts");
const planLib = await import("../src/lib/plan.ts");
const planLoad = await import("../src/lib/plan-load.ts");

/* ------------------------------------------------- slate from the site */
/**
 * The bot used to build the slate in its own process: no Next fetch cache,
 * so every rebuild was nine CFBD calls, every 10 minutes, all week. Now it
 * reads the running site's /api/slate?full=1 and /api/game?id= (same memos
 * the pages use, zero extra CFBD calls). Building in-process is only the
 * fallback when the site does not answer, and it warns every time so the
 * logs show it.
 */
const SITE = digests.baseUrl();
const SITE_TIMEOUT_MS = 45_000;
let fallbackWarnedAt = 0;

async function siteJson(pathname) {
  const res = await fetch(`${SITE}${pathname}`, { headers: { Accept: "application/json", "User-Agent": "edgesheet-telegram-bot" }, signal: AbortSignal.timeout(SITE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  return res.json();
}

function warnFallback(what, err) {
  // Once a minute at most, so a long outage does not flood the log.
  if (Date.now() - fallbackWarnedAt < 60_000) return;
  fallbackWarnedAt = Date.now();
  warn(`[site] ${what} not available from ${SITE} (${err?.message ?? err}); building in this process instead. This costs CFBD calls. Is pm2 "scout" up?`);
}

/** The slate for a date from the site; in-process build only when the site is down. */
async function loadSlate(date) {
  try {
    const q = date ? `?date=${date}&full=1` : "?full=1";
    return await siteJson(`/api/slate${q}`);
  } catch (e) {
    warnFallback("slate", e);
    return slateLib.getSlate(date);
  }
}

/** One built game from the site; in-process build only when the site is down. Resolves undefined when nobody can build it. */
async function loadGame(id) {
  try {
    return await siteJson(`/api/game?id=${encodeURIComponent(id)}`);
  } catch (e) {
    if (/HTTP 404/.test(e?.message ?? "")) return undefined;
    warnFallback(`game ${id}`, e);
    return slateLib.getGame(id).catch(() => undefined);
  }
}

const me = await tg.getMe().catch((e) => {
  warn(`Telegram rejected the token: ${e.message}`);
  process.exit(1);
});
log(`Bot @${me.username} online. Chat id ${tg.telegramChatId() ?? "NOT SET (push messages disabled until TELEGRAM_CHAT_ID is in .env.local)"}. Base URL ${digests.baseUrl()}.`);

/* --------------------------------------------------------------- state */

function readState() {
  try {
    if (existsSync(STATE_FILE)) return { remindersSent: {}, radarSent: [], liveCursor: {}, liveSent: {}, scoreSeen: {}, scoreSent: {}, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {}
  return { remindersSent: {}, radarSent: [], liveCursor: {}, liveSent: {}, scoreSeen: {}, scoreSent: {} };
}
function writeState(s) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
}
const state = readState();
if (!state.gradesCursor) {
  // First run: do not replay every grade already in the archive.
  state.gradesCursor = new Date().toISOString();
  log(`No grades cursor yet. Starting from now (${state.gradesCursor}); earlier grades are on /history.`);
  writeState(state);
}

/* ------------------------------------------------------------ helpers */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function etParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "numeric", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" }).format(d));
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), date: slateLib.etDate(d), weekday };
}
const isD1 = (g) => g.division === "FBS" || g.division === "FCS";

async function push(text, label) {
  if (!tg.telegramChatId()) {
    warn(`[${label}] skipped: TELEGRAM_CHAT_ID is not set. Message the bot, then run node scripts/telegram-chat-id.mjs.`);
    return false;
  }
  try {
    const sent = await tg.sendMessage(text, { parseMode: "HTML" });
    log(`[${label}] sent ${sent.length} message(s).`);
    return true;
  } catch (e) {
    warn(`[${label}] failed: ${e.message}`);
    return false;
  }
}

/** Is any Division I game today in a "window": kicked off in the last 6 hours or kicking off in the next 2. */
function gameWindow(games, now = Date.now()) {
  return games.some((g) => {
    if (!isD1(g)) return false;
    const k = new Date(g.kickoff).getTime();
    return k >= now - 6 * 3600_000 && k <= now + 2 * 3600_000;
  });
}
/** Any Division I game live, or final with a kickoff in the last 6 hours. */
function gradingWindow(games, now = Date.now()) {
  return games.some((g) => isD1(g) && (g.status === "live" || (g.status === "final" && new Date(g.kickoff).getTime() >= now - 6 * 3600_000)));
}

/* ----------------------------------------------------------- live loop */
/**
 * Every 60 seconds while a Division I game is live: a ping for each NEW big
 * play by a followed player (20+ yds, TD, sack, INT, TFL, turnover), throttled
 * to one message per player per 2 minutes, and a score-change ping per followed
 * team's game, one per 5 minutes. Cursors live in telegram-state.json
 * (liveCursor = last play sequence sent per game:player, scoreSeen = last score
 * sent per game) so a restart never resends. Live state comes from the ESPN
 * scoreboard (30s memo, no CFBD calls); the slate comes from the site's
 * /api/slate at most every 10 min, so this loop never touches CFBD.
 */
const ordinalQ = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : n === 5 ? "OT" : `${n - 4}OT`);
let liveSlate = { at: 0, slate: undefined };
async function slateForLive(today) {
  if (!liveSlate.slate || liveSlate.slate.date !== today || Date.now() - liveSlate.at > 10 * 60_000) {
    liveSlate = { at: Date.now(), slate: await loadSlate(today) };
  }
  return liveSlate.slate;
}

function bigPlayMessage(p, g, lg, plays, log, base) {
  const last = plays[plays.length - 1];
  const score = `${g.away.short} ${last.awayScore}, ${g.home.short} ${last.homeScore}`;
  const lines = [];
  if (plays.length === 1) {
    lines.push(`<b>${tg.escapeHtml(p.name)}</b> (${tg.escapeHtml(log.abbr ?? p.team)} ${tg.escapeHtml(p.pos)}): ${tg.escapeHtml(last.tag)}, ${ordinalQ(last.quarter)} quarter ${last.clock}. ${tg.escapeHtml(score)}`);
  } else {
    lines.push(`<b>${tg.escapeHtml(p.name)}</b> (${tg.escapeHtml(log.abbr ?? p.team)} ${tg.escapeHtml(p.pos)}): ${plays.length} big plays. ${tg.escapeHtml(score)}`);
    for (const x of plays) lines.push(`• ${tg.escapeHtml(x.tag)}, ${ordinalQ(x.quarter)} quarter ${x.clock}`);
  }
  lines.push(`   <i>${tg.escapeHtml(last.text)}</i>`);
  if (log.lineText.length) lines.push(`   Today: ${tg.escapeHtml(log.lineText.map((l) => l.headline).join(" · "))}`);
  lines.push(`   <a href="${base}/player/${p.id}">player page</a> · <a href="${base}/game/${g.id}">${tg.escapeHtml(`${g.away.short} at ${g.home.short}`)}</a>${lg?.broadcast ? ` · ${tg.escapeHtml(lg.broadcast)}` : ""}`);
  return lines.join("\n");
}

function scoreMessage(g, lg, teams, base) {
  const lines = [`<b>Score change</b>: ${tg.escapeHtml(g.away.short)} ${lg.away.score}, ${tg.escapeHtml(g.home.short)} ${lg.home.score}, ${tg.escapeHtml(lg.detail)}. You follow ${teams.map(tg.escapeHtml).join(" and ")}.`];
  if (lg.lastPlay) lines.push(`   <i>${tg.escapeHtml(lg.lastPlay)}</i>`);
  if (lg.homeWinProb !== undefined) lines.push(`   Win prob ${tg.escapeHtml(g.home.abbr)} ${Math.round(lg.homeWinProb * 100)}, ${tg.escapeHtml(g.away.abbr)} ${Math.round((1 - lg.homeWinProb) * 100)}${lg.downDistance ? ` · ${tg.escapeHtml(lg.downDistance)}` : ""}`);
  lines.push(`   <a href="${base}/game/${g.id}">${tg.escapeHtml(`${g.away.short} at ${g.home.short}`)}</a>${lg.broadcast ? ` · ${tg.escapeHtml(lg.broadcast)}` : ""}`);
  return lines.join("\n");
}

let liveTicking = false;
async function liveTick() {
  if (liveTicking) return;
  liveTicking = true;
  try {
    const f = follows.readFollows();
    if (!f.players.length && !f.teams.length) return;
    const { date: today } = etParts();
    const slate = await slateForLive(today);
    if (slate.date !== today) return;
    const games = slate.games.filter(isD1);
    if (!gameWindow(games)) return;
    const board = await espn.liveScoreboard(today);
    const liveGames = games.filter((g) => board.get(g.id)?.state === "in");
    if (!liveGames.length) return;
    const base = digests.baseUrl();
    const now = Date.now();
    let dirty = false;

    // 1. Big plays by followed players.
    const players = planLoad.followedPlayers(f.players);
    const byGame = new Map();
    for (const p of players) {
      const g = liveGames.find((x) => x.home.short === p.team || x.away.short === p.team);
      if (g) byGame.set(g.id, [...(byGame.get(g.id) ?? []), p]);
    }
    for (const [gameId, ps] of byGame) {
      const g = liveGames.find((x) => x.id === gameId);
      const lg = board.get(gameId);
      const logs = await playerlog.playerLogs(gameId, ps.map((p) => p.id));
      for (const p of ps) {
        const log = logs[p.id];
        if (!log) continue;
        const key = `${gameId}:${p.id}`;
        const maxSeq = log.plays.reduce((m, x) => Math.max(m, x.seq), 0);
        if (!(key in state.liveCursor)) {
          // First sight of this player in this game (bot start or new follow): do not replay what already happened.
          state.liveCursor[key] = maxSeq;
          dirty = true;
          continue;
        }
        const fresh = log.plays.filter((x) => x.seq > state.liveCursor[key]);
        if (!fresh.length) continue;
        const big = fresh.filter((x) => x.isBig);
        if (!big.length) {
          state.liveCursor[key] = maxSeq;
          dirty = true;
          continue;
        }
        const lastSent = state.liveSent[p.id] ? new Date(state.liveSent[p.id]).getTime() : 0;
        if (now - lastSent < 2 * 60_000) continue; // throttled: cursor stays, so the play goes out next tick
        const ok = await push(bigPlayMessage(p, g, lg, big.slice(-3), log, base), `live:${p.name}`);
        if (ok) {
          state.liveCursor[key] = maxSeq;
          state.liveSent[p.id] = new Date(now).toISOString();
          dirty = true;
        }
      }
    }

    // 2. Score changes in followed teams' games.
    const followedTeams = new Set(f.teams.map((t) => t.toLowerCase()));
    for (const g of liveGames) {
      const teams = [g.away, g.home].filter((t) => followedTeams.has(t.short.toLowerCase())).map((t) => t.short);
      if (!teams.length) continue;
      const lg = board.get(g.id);
      if (lg.home.score == null || lg.away.score == null) continue;
      const cur = `${lg.away.score}-${lg.home.score}`;
      if (!(g.id in state.scoreSeen)) {
        state.scoreSeen[g.id] = cur;
        dirty = true;
        continue;
      }
      if (state.scoreSeen[g.id] === cur) continue;
      const lastSent = state.scoreSent[g.id] ? new Date(state.scoreSent[g.id]).getTime() : 0;
      if (now - lastSent < 5 * 60_000) continue;
      const ok = await push(scoreMessage(g, lg, teams, base), `score:${g.id}`);
      if (ok) {
        state.scoreSeen[g.id] = cur;
        state.scoreSent[g.id] = new Date(now).toISOString();
        dirty = true;
      }
    }

    // Keep the maps small: drop cursors for games that are not on today's slate.
    const todayIds = new Set(games.map((g) => g.id));
    for (const key of Object.keys(state.liveCursor)) if (!todayIds.has(key.split(":")[0])) { delete state.liveCursor[key]; dirty = true; }
    for (const id of Object.keys(state.scoreSeen)) if (!todayIds.has(id)) { delete state.scoreSeen[id]; delete state.scoreSent[id]; dirty = true; }
    if (dirty) writeState(state);
  } catch (e) {
    warn(`[live] ${e.message}`);
  } finally {
    liveTicking = false;
  }
}

/* ----------------------------------------------------------- scheduled */

async function morning(today) {
  const slate = await loadSlate(today);
  state.lastSlateDate = today;
  writeState(state);
  if (slate.date !== today || !slate.games.some(isD1)) {
    log(`[slate] no Division I games on ${today}; nothing sent.`);
    return;
  }
  await push(digests.morningSlate(slate), "slate");
  // The Saturday sheet as a photo (src/lib/render.ts, headless Chrome). Needs the site up on PUBLIC_BASE_URL; failures are logged, not fatal.
  try {
    const render = await import("../src/lib/render.ts");
    const png = await render.renderSheetPng(today, digests.baseUrl());
    await tg.sendPhoto(png, `EdgeSheet, ${digests.longDate(today)}. ${digests.NOT_A_PICK} ${digests.baseUrl()}/sheet?date=${today}`);
    log(`[sheet] sent ${png}.`);
  } catch (e) {
    warn(`[sheet] not sent: ${e.message}`);
  }
}

async function reminders(slate) {
  const f = follows.readFollows();
  if (!f.teams.length && !f.games.length) return;
  const hits = digests.upcomingForFollows(slate.games, f, new Date(), 60).filter((h) => !state.remindersSent[h.game.id]);
  if (!hits.length) return;
  const ok = await push(digests.kickoffReminder(hits), "kickoff");
  if (ok) {
    for (const h of hits) state.remindersSent[h.game.id] = new Date().toISOString();
    // Keep the map small: drop entries older than 2 days.
    const cutoff = Date.now() - 2 * 86400_000;
    for (const [id, at] of Object.entries(state.remindersSent)) if (new Date(at).getTime() < cutoff) delete state.remindersSent[id];
    writeState(state);
  }
}

async function grades(season) {
  // getSlate() grades every final on today's slate that has a locked call, so the archive is fresh after this.
  const entries = archive.listEntries(season);
  const { entries: fresh, cursor } = digests.newlyGraded(entries, state.gradesCursor);
  if (fresh.length) {
    const ok = await push(digests.postgameDigest(fresh), "grades");
    if (ok) {
      state.gradesCursor = cursor;
      writeState(state);
    }
  }
  const f = follows.readFollows();
  const alerts = digests.radarAlerts(entries, f, new Set(state.radarSent));
  if (alerts.length) {
    const ok = await push(digests.radarAlertDigest(alerts), "radar");
    if (ok) {
      state.radarSent = [...state.radarSent, ...alerts.map((a) => a.key)].slice(-500);
      writeState(state);
    }
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const { hour, minute, date: today, weekday } = etParts();
    const slateNeeded = (hour === 8 && minute < 10 && state.lastSlateDate !== today) || (hour === 7 && minute < 10 && state.lastStockDate !== today) || minute % 15 === 0 || minute % 10 === 0 || minute === 0;
    if (!slateNeeded) return;
    const slate = await loadSlate(today);
    const todays = slate.date === today ? slate.games : [];

    if (hour === 8 && minute < 10 && state.lastSlateDate !== today) await morning(today);
    // Monday 7:00 AM ET stock report, after the 6:30 AM snapshot cron (npm run snapshot).
    if (weekday === 1 && hour === 7 && minute < 10 && state.lastStockDate !== today) {
      state.lastStockDate = today;
      writeState(state);
      await push(digests.stockDigest(movement.biggestMoves(5)), "stock");
    }
    if (minute % 15 === 0 && gameWindow(todays)) await reminders(slate);
    if ((minute % 10 === 0 && gradingWindow(todays)) || minute === 0) await grades(slate.season);
  } catch (e) {
    warn(`[tick] ${e.message}`);
  } finally {
    ticking = false;
  }
}

/* ------------------------------------------------------------ commands */

async function handle(text, chatId) {
  const m = text.trim().match(/^\/([a-z]+)(?:@\w+)?\s*(.*)$/i);
  if (!m) return undefined;
  const cmd = m[1].toLowerCase();
  const arg = m[2].trim();
  const reply = (t) => tg.sendMessage(t, { parseMode: "HTML", chatId });
  switch (cmd) {
    case "start":
    case "help":
      return reply(digests.helpDigest());
    case "stock":
      return reply(digests.stockDigest(movement.biggestMoves(5)));
    case "slate": {
      const slate = await loadSlate(/^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined);
      return reply(digests.morningSlate(slate));
    }
    case "leans": {
      const slate = await loadSlate(/^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined);
      return reply(digests.leansDigest(slate.games.filter(isD1), slate.date));
    }
    case "record": {
      const slate = await loadSlate();
      return reply(digests.recordDigest(archive.listEntries(slate.season)));
    }
    case "radar": {
      if (!arg) return reply("Usage: /radar &lt;team&gt;, for example /radar LSU");
      const slate = await loadSlate();
      let school = digests.resolveSchool(slate.weekGames, arg);
      if (!school) {
        const q = arg.toLowerCase();
        const keys = [...radar.radarIndex().byTeam.keys()];
        school = keys.find((k) => k.toLowerCase() === q) ?? keys.find((k) => k.toLowerCase().startsWith(q)) ?? keys.find((k) => k.toLowerCase().includes(q));
      }
      if (!school) return reply(`No team matches "${tg.escapeHtml(arg)}" on this week's slate or in the ingested rosters.`);
      const game = slate.weekGames.find((g) => g.home.short === school || g.away.short === school);
      return reply(digests.teamRadarDigest(school, radar.radarForTeam(school), game));
    }
    case "game": {
      if (!arg) return reply("Usage: /game &lt;team&gt;, for example /game Ohio State");
      const slate = await loadSlate();
      const hit = digests.findTeamGames(slate.weekGames, arg)[0];
      if (!hit) return reply(`No game this week for "${tg.escapeHtml(arg)}".`);
      const full = (await loadGame(hit.id)) ?? hit;
      return reply(digests.gameDigest(full));
    }
    case "plan": {
      const planDate = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined;
      const { plan } = await planLoad.getPlan(planDate, await loadSlate(planDate));
      return reply(planLib.planText(plan, digests.baseUrl()));
    }
    default:
      return reply(`Unknown command /${tg.escapeHtml(cmd)}.\n\n${digests.helpDigest()}`);
  }
}

async function poll() {
  let offset = state.lastUpdateId ? state.lastUpdateId + 1 : undefined;
  const allowed = tg.telegramChatId();
  for (;;) {
    let updates = [];
    try {
      updates = await tg.getUpdates(offset, 30);
    } catch (e) {
      warn(`[poll] ${e.message}${/409/.test(e.message) || /terminated by other/i.test(e.message) ? " (another process is polling this bot; stop it, only one poller is allowed)" : ""}`);
      await sleep(10_000);
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      state.lastUpdateId = u.update_id;
      const msg = u.message;
      if (!msg?.text) continue;
      const from = String(msg.chat.id);
      if (!allowed) {
        warn(`[poll] message from chat id ${from} (${msg.chat.type}${msg.chat.username ? `, @${msg.chat.username}` : ""}). Add TELEGRAM_CHAT_ID=${from} to .env.local and restart.`);
        await tg.sendMessage(`This chat id is <code>${from}</code>. Add <code>TELEGRAM_CHAT_ID=${from}</code> to web/.env.local and restart the bot (pm2 restart scout-telegram).`, { parseMode: "HTML", chatId: msg.chat.id }).catch(() => {});
        continue;
      }
      if (from !== allowed) {
        warn(`[poll] ignored message from chat id ${from} (not TELEGRAM_CHAT_ID).`);
        continue;
      }
      log(`[cmd] ${msg.text}`);
      try {
        await handle(msg.text, msg.chat.id);
      } catch (e) {
        warn(`[cmd] ${msg.text} failed: ${e.message}`);
        await tg.sendMessage(`That failed: ${tg.escapeHtml(e.message)}`, { parseMode: "HTML", chatId: msg.chat.id }).catch(() => {});
      }
    }
    if (updates.length) writeState(state);
  }
}

/* ---------------------------------------------------------------- run */

setInterval(tick, 60_000);
setInterval(liveTick, 60_000);
tick();
liveTick();
poll();
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
