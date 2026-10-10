// Runs under tsx (see scripts/edges.mjs). Locks new opener edges and grades finished ones.
const { readLines, readLedger, writeLedger, decide, grade, pickText, currentLine, leadHours, MIN_WEEK, MIN_LEAD_HOURS, RULE_TEXT } = await import("../../src/lib/edges");
const { getSlate, etDate } = await import("../../src/lib/slate");

const now = Date.now();
const lines = readLines(Number(process.env.SEASON ?? new Date().getFullYear()));
if (!lines.length) {
  console.log("[edges] no line files yet; run node scripts/lines-espn.mjs first");
  process.exit(0);
}
const season = lines[0].season;
const ledger = readLedger(season);
ledger.rule = RULE_TEXT;

/* ---------------------------------------------- lock */
const upcoming = lines.filter((r) => !ledger.picks[r.id] && new Date(r.kickoff).getTime() > now && r.week >= MIN_WEEK && currentLine(r) != null);
// Lines we first saw too close to kickoff are out: the backtested edge is against early-week numbers.
const open = upcoming.filter((r) => leadHours(r) >= MIN_LEAD_HOURS);
const late = upcoming.length - open.length;
const byDate = new Map<string, typeof open>();
for (const r of open) {
  const d = etDate(new Date(r.kickoff));
  (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(r);
}
let locked = 0, checked = 0, noModel = 0;
for (const [date, recs] of byDate) {
  const slate = await getSlate(date).catch((e) => {
    console.log(`[edges] slate ${date} failed: ${e instanceof Error ? e.message : e}`);
    return undefined;
  });
  if (!slate) continue;
  const games = new Map([...slate.weekGames, ...slate.games].map((g) => [g.id, g]));
  for (const r of recs) {
    const g = games.get(r.id);
    const p = g?.projection;
    if (!g || !p || p.confidence !== "high" || p.eloMargin == null) {
      noModel++;
      continue;
    }
    checked++;
    const model = p.winner === g.home.abbr ? p.margin : -p.margin;
    const line = currentLine(r)!;
    const d = decide(model, line);
    if (!d) continue;
    ledger.picks[r.id] = {
      gameId: r.id, season, week: r.week, kickoff: r.kickoff,
      home: g.home.short, away: g.away.short, homeAbbr: g.home.abbr, awayAbbr: g.away.abbr,
      side: d.side, pick: pickText(d.side, line, g.home.abbr, g.away.abbr),
      lockedAt: new Date().toISOString(), lockLine: line, openLine: r.open.spread,
      model: Math.round(model * 10) / 10, gap: d.gap, eloMargin: p.eloMargin, netEdge: p.netEdge, book: r.book,
    };
    locked++;
    console.log(`[edges] LOCK ${ledger.picks[r.id].pick}  (${g.away.short} at ${g.home.short}, model ${model >= 0 ? g.home.abbr : g.away.abbr} by ${Math.abs(model).toFixed(1)}, line ${pickText("home", line, g.home.abbr, g.away.abbr)})`);
  }
}

/* ---------------------------------------------- grade */
const lineById = new Map(lines.map((r) => [r.id, r]));
let graded = 0;
for (const p of Object.values(ledger.picks)) {
  if (p.result || new Date(p.kickoff).getTime() > now) continue;
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${p.gameId}`).then((x) => (x.ok ? x.json() : undefined)).catch(() => undefined);
  const c = res?.header?.competitions?.[0];
  if (!c?.status?.type?.completed) continue;
  const h = c.competitors.find((x: { homeAway: string }) => x.homeAway === "home");
  const a = c.competitors.find((x: { homeAway: string }) => x.homeAway === "away");
  const r = lineById.get(p.gameId);
  const close = r?.close?.spread ?? r?.snapshots.at(-1)?.spread ?? null;
  grade(p, { home: Number(h.score), away: Number(a.score) }, close);
  graded++;
  console.log(`[edges] GRADE ${p.pick}: ${p.result}, final ${p.homeAbbr} ${h.score}-${a.score} ${p.awayAbbr}, CLV ${p.clv ?? "n/a"}`);
}

writeLedger(ledger);
console.log(`[edges] ${checked} games checked against the model (${noModel} without a full model, ${late} first seen under ${MIN_LEAD_HOURS}h before kickoff), ${locked} locked, ${graded} graded, ${Object.keys(ledger.picks).length} picks on the ledger`);
process.exit(0);
