#!/usr/bin/env node
/**
 * Dry run: prints every Telegram digest to the console without sending.
 * No bot token needed. Useful for checking wording before a game day.
 *
 *   node scripts/telegram-preview.mjs            (today)
 *   node scripts/telegram-preview.mjs 2026-10-10 (a specific date)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerEsm } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(WEB);
const envFile = path.join(WEB, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
registerCjs();
registerEsm();

const d = await import("../src/lib/digests.ts");
const s = await import("../src/lib/slate.ts");
const a = await import("../src/lib/archive.ts");
const tg = await import("../src/lib/telegram.ts");
const f = await import("../src/lib/follows.ts");

const date = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2] ?? "") ? process.argv[2] : undefined;
const t0 = Date.now();
const slate = await s.getSlate(date);
const d1 = slate.games.filter((g) => g.division === "FBS" || g.division === "FCS");
console.log(`Slate ${slate.date}: ${slate.games.length} games (${d1.length} Division I), source ${slate.source}, built in ${Date.now() - t0} ms`);
console.log(`Telegram ready: ${tg.telegramReady()}${tg.telegramMissing() ? ` (${tg.telegramMissing()})` : ""}\n`);

const section = (title, text) => console.log(`\n==================== ${title} ====================\n${text ?? "(nothing to send)"}`);

section("MORNING SLATE", d.morningSlate(slate));
section("LEANS", d.leansDigest(d1, slate.date));

const follows = f.readFollows();
const sample = follows.teams.length ? follows : { teams: slate.games.slice(0, 2).flatMap((g) => [g.home.short]), players: [], games: [] };
const first = slate.games.find((g) => g.home.short === sample.teams[0]);
const pretend = first ? new Date(new Date(first.kickoff).getTime() - 30 * 60_000) : new Date();
section(`KICKOFF REMINDER (follows: ${sample.teams.join(", ") || "none"}; clock set 30 min before ${first ? `${first.away.short} at ${first.home.short}` : "now"})`, d.kickoffReminder(d.upcomingForFollows(slate.games, sample, pretend, 60)));

const entries = a.listEntries(slate.season);
section("POSTGAME GRADES (every graded game in the archive)", d.postgameDigest(d.newlyGraded(entries).entries));
section("RADAR ALERTS (followed players who showed up)", d.radarAlertDigest(d.radarAlerts(entries, follows)));
section("RECORD", d.recordDigest(entries));

const g = d1[0] ?? slate.games[0];
if (g) section(`GAME (${g.away.short} at ${g.home.short})`, d.gameDigest(g));
section("HELP", d.helpDigest());
