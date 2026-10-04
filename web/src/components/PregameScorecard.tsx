import type { Game } from "@/lib/types";
import { spreadText } from "@/lib/format";

/**
 * Live scorecard: the pregame call shown as rows being filled in. Each row
 * pairs what was called before kickoff with the evidence the live box has
 * right now. Box evidence is the leading line for the unit in question (the
 * live feed publishes leaders, not team totals), so each row says "leader so
 * far". Rows with no live evidence say "pending". Nothing is graded here;
 * grading happens once against the settled box score.
 */
export function PregameScorecard({ game }: { game: Game }) {
  const pre = game.archive?.pregame;
  const proj = pre?.projection ?? game.projection;
  const s = game.score;
  const l = game.live;
  const teamOf = (abbr?: string) => (abbr === game.home.abbr ? game.home : abbr === game.away.abbr ? game.away : undefined);
  const short = (abbr?: string) => teamOf(abbr)?.short ?? abbr ?? "";

  // Elapsed game minutes from the ESPN clock, for an "on pace" total. Halftime and empty clocks fall back to the period boundary.
  let elapsed: number | undefined;
  if (l?.period) {
    const m = /^(\d+):(\d+)$/.exec(l.clock ?? "");
    const left = m ? Number(m[1]) + Number(m[2]) / 60 : 0;
    elapsed = Math.min(60, Math.max(0, (Math.min(l.period, 4) - 1) * 15 + (15 - left)));
    if (l.period > 4) elapsed = 60;
  }
  const pts = s ? s.home + s.away : undefined;
  const pace = pts !== undefined && elapsed && elapsed >= 10 ? Math.round((pts / elapsed) * 60) : undefined;
  const homeMargin = s ? s.home - s.away : undefined;

  // Live box lines per school, from the ESPN leaders the LivePanel already shows.
  const leaders = (side: { short: string; abbr: string }, cat: "rushing" | "passing") => {
    const t = game.box?.teams.find((x) => x.team === side.short || x.abbr === side.abbr);
    const row = t?.leaders.find((ld) => ld.category === cat);
    if (row) return `${row.name} ${row.headline}`;
    // Before the CFBD box exists the ESPN summary carries leaders per side.
    const e = game.liveDetail?.box.find((x) => x.abbr === side.abbr);
    const er = e?.leaders.find((ld) => ld.category === cat);
    return er ? `${er.name} ${er.headline}` : undefined;
  };

  const rows: { label: string; called: string; now: string; state: "pending" | "on" | "off" | "note" }[] = [];

  if (proj) {
    const w = short(proj.winner);
    const called = `${w} by ${proj.margin.toFixed(1)} at ${Math.round(proj.winProb * 100)}%`;
    let now = "pending";
    let state: "pending" | "on" | "off" | "note" = "pending";
    if (homeMargin !== undefined && s) {
      const leader = homeMargin > 0 ? game.home : homeMargin < 0 ? game.away : undefined;
      now = leader ? `${leader.short} up ${Math.abs(homeMargin)}, ${s.clock}` : `tied ${s.home} to ${s.away}, ${s.clock}`;
      state = leader ? (leader.abbr === proj.winner ? "on" : "off") : "note";
    }
    rows.push({ label: "Winner", called, now, state });
  }

  const spread = pre?.spread ?? game.market.spread;
  const modelSide = proj?.modelSide;
  if (spread && modelSide) {
    const favHome = spread.team === game.home.abbr;
    const need = Math.abs(spread.line);
    let now = "pending";
    let state: "pending" | "on" | "off" | "note" = "pending";
    if (homeMargin !== undefined) {
      const favMargin = favHome ? homeMargin : -homeMargin;
      const favCovering = favMargin > need;
      const modelOnFav = modelSide === spread.team;
      const covering = modelOnFav ? favCovering : favMargin < need;
      now = `${short(spread.team)} ${favMargin >= 0 ? "up" : "down"} ${Math.abs(favMargin)} against ${need}`;
      state = favMargin === need ? "note" : covering ? "on" : "off";
    }
    rows.push({ label: "Side", called: `${short(modelSide)} against ${spreadText(spread.team, spread.line)}`, now, state });
  }

  const total = pre?.total ?? game.market.total?.line;
  if (total !== undefined && proj?.totalLean && proj.totalLean !== "none") {
    let now = "pending";
    let state: "pending" | "on" | "off" | "note" = "pending";
    if (pts !== undefined && pace !== undefined) {
      now = `${pts} points, on pace for about ${pace}`;
      state = proj.totalLean === "over" ? (pace > total ? "on" : "off") : pace < total ? "on" : "off";
    } else if (pts !== undefined) {
      now = `${pts} points so far, too early for a pace`;
      state = "note";
    }
    rows.push({ label: "Total", called: `${proj.totalLean} ${total}`, now, state });
  }

  const edges = pre?.edges ?? game.matchups.map((m) => ({ a: m.a, b: m.b, edge: m.edge ?? "even", axis: axisOf(m.a, m.b), offTeam: m.a.replace(/ (run game|deep passing|offensive line|on passing downs)$/i, "") }));
  for (const e of edges) {
    if (e.edge === "even") continue;
    const offSide = e.offTeam === game.home.name || e.offTeam === game.home.short ? game.home : game.away;
    const defSide = offSide === game.home ? game.away : game.home;
    const winner = e.edge === "offense" ? offSide : defSide;
    const called = `advantage ${winner.short}`;
    let now: string;
    let state: "pending" | "on" | "off" | "note";
    if (e.axis === "passing-downs") {
      now = "graded from play-by-play after the final";
      state = "pending";
    } else {
      const line = leaders(offSide, e.axis === "pass" ? "passing" : "rushing");
      now = line ? `${offSide.abbr} leader so far: ${line}` : "pending";
      state = line ? "note" : "pending";
    }
    rows.push({ label: `${e.a} vs ${e.b}`, called, now, state });
  }

  if (!rows.length) {
    return <p className="mt-2 text-sm text-chalk-3">No pregame call was locked for this game.</p>;
  }

  const pill = (st: (typeof rows)[number]["state"]) =>
    st === "on" ? "bg-turf text-white" : st === "off" ? "bg-brick text-white" : st === "note" ? "bg-ink-2 text-chalk" : "bg-ink-2 text-chalk-3";
  const word = (st: (typeof rows)[number]["state"]) => (st === "on" ? "holding" : st === "off" ? "behind" : st === "note" ? "so far" : "pending");

  return (
    <div className="mt-3 card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-chalk-3">
            <th className="px-3 py-2 font-semibold">Call</th>
            <th className="hidden px-3 py-2 font-semibold sm:table-cell">We said</th>
            <th className="px-3 py-2 font-semibold">Right now</th>
            <th className="px-3 py-2 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="px-3 py-2">
                <span className="font-semibold text-chalk">{r.label}</span>
                <span className="block text-xs text-chalk-2 sm:hidden">{r.called}</span>
              </td>
              <td className="hidden px-3 py-2 text-chalk-2 sm:table-cell">{r.called}</td>
              <td className={`px-3 py-2 ${r.state === "pending" ? "text-chalk-3" : "text-chalk"}`}>{r.now}</td>
              <td className="px-3 py-2 text-right">
                <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${pill(r.state)}`}>{word(r.state)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-2 text-xs text-chalk-3">
        Holding and behind are the current score against the call, not a grade. Matchup rows show the live leader line because the in-game feed does not publish team totals. The call is graded once, against the settled box score.
      </p>
    </div>
  );
}

function axisOf(a: string, b: string): string {
  const t = `${a} ${b}`.toLowerCase();
  if (t.includes("run game")) return "rush";
  if (t.includes("deep passing")) return "pass";
  if (t.includes("offensive line")) return "line";
  if (t.includes("passing downs")) return "passing-downs";
  return "other";
}
