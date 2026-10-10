/**
 * Opening and current lines from ESPN (DraftKings via ESPN's pickcenter; free, no key).
 *
 * For every FBS game this week and next, one summary call per game not yet final:
 *   open       the book's opening spread and total (ESPN publishes it, so a late first look still sees it)
 *   snapshots  every distinct current line we have seen, with the time we saw it
 *   close      the last current line seen before kickoff (set once the game starts)
 *
 * Spreads are stored as the home margin the line implies (home -7 => +7), the same convention
 * as data/backtest/<season>/lines.json, so the edge tracker can compare to the model directly.
 *
 * Writes data/lines/<season>/<gameId>.json. Safe to run as often as you like.
 *
 *   node scripts/lines-espn.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const log = (...a) => console.log("[lines]", ...a);

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
      if (res.status === 404) return undefined;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return undefined;
}

const num = (s) => {
  const n = Number(String(s ?? "").replace(/^[ou]/i, ""));
  return Number.isFinite(n) ? n : null;
};

/** { spread: home margin, total } for "open" or "close" from one pickcenter row. */
function lineOf(p, which) {
  const homeLine = num(p?.pointSpread?.home?.[which]?.line);
  const total = num(p?.total?.over?.[which]?.line);
  return { spread: homeLine == null ? null : -homeLine, total };
}

/* ------------------------------------------------ this week and next */
const cur = await getJson(`${BASE}/scoreboard?groups=80&limit=400`);
const season = cur?.season?.year ?? new Date().getFullYear();
const week = cur?.week?.number;
const seasonType = cur?.season?.type ?? 2;
const events = [...(cur?.events ?? [])];
if (week) {
  const next = await getJson(`${BASE}/scoreboard?groups=80&seasontype=${seasonType}&week=${week + 1}&dates=${season}&limit=400`);
  events.push(...(next?.events ?? []));
}
log(`season ${season}, week ${week}: ${events.length} FBS games this week and next`);

const DIR = path.join(root, "data", "lines", String(season));
await mkdir(DIR, { recursive: true });
const now = new Date().toISOString();
let touched = 0, moved = 0, closed = 0;

for (const e of events) {
  const f = path.join(DIR, `${e.id}.json`);
  const rec = existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : null;
  const state = e.status?.type?.state; // pre | in | post
  if (rec?.close && state !== "pre") continue; // already closed
  if (!rec && state !== "pre") continue; // never saw it before kickoff; nothing honest to record

  const sum = await getJson(`${BASE}/summary?event=${e.id}`);
  const pc = (sum?.pickcenter ?? []).find((p) => p.pointSpread) ?? null;
  if (!pc) continue;
  const c = e.competitions?.[0];
  const home = c?.competitors?.find((x) => x.homeAway === "home");
  const away = c?.competitors?.find((x) => x.homeAway === "away");
  const open = lineOf(pc, "open");
  const current = lineOf(pc, "close"); // ESPN's "close" is the live number until kickoff
  const r = rec ?? {
    id: e.id,
    season,
    week: e.week?.number ?? week,
    kickoff: e.date,
    home: { id: home?.team?.id, name: home?.team?.location, abbr: home?.team?.abbreviation },
    away: { id: away?.team?.id, name: away?.team?.location, abbr: away?.team?.abbreviation },
    neutral: Boolean(c?.neutralSite),
    book: pc.provider?.name ?? "ESPN",
    open,
    snapshots: [],
  };
  r.kickoff = e.date;
  if (state === "pre") {
    const last = r.snapshots.at(-1);
    if (!last || last.spread !== current.spread || last.total !== current.total) {
      r.snapshots.push({ at: now, ...current });
      if (last) moved++;
    }
  } else {
    // Game has started: the last pregame number we saw is the close. ESPN's own "close" is used when it is present.
    r.close = { at: now, spread: current.spread ?? r.snapshots.at(-1)?.spread ?? null, total: current.total ?? r.snapshots.at(-1)?.total ?? null };
    closed++;
  }
  await writeFile(f, JSON.stringify(r, null, 1));
  touched++;
}
log(`updated ${touched} games (${moved} line moves, ${closed} closed)`);
