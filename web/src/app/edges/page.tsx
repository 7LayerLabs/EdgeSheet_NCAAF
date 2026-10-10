import Link from "next/link";
import { edgeStats, readLedger, readLines, currentLine, pickText, LEAN, MIN_LEAD_HOURS, RULE_TEXT, type EdgePick } from "@/lib/edges";
import { asOf } from "@/lib/format";

export const dynamic = "force-dynamic";

const season = () => new Date().getFullYear();
const signed = (n: number | null | undefined) => (n == null ? "–" : n > 0 ? `+${n}` : String(n));
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

export default function EdgesPage() {
  const ledger = readLedger(season());
  const picks = Object.values(ledger.picks).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const stats = edgeStats(picks);
  const lines = new Map(readLines(season()).map((r) => [r.id, r]));
  const pending = picks.filter((p) => !p.result);
  const graded = picks.filter((p) => p.result);

  return (
    <div>
      <p className="eyebrow">Paper trading · {season()} season</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">Opener edges</h1>
      <p className="mt-2 max-w-3xl text-base text-chalk-3">
        The one betting angle four seasons of history support: when the model and the opening line disagree by {LEAN} or more points, take the model&apos;s side
        early in the week. On 2022 to 2025 games that covered 55.9% against the opener (57.4% with our own Elo), but only 53.8% against the closing line, because
        the market tends to move toward the model before kickoff. Break-even at -110 is 52.4%.
      </p>
      <p className="mt-1 text-sm text-chalk-3">
        This page tests it live, with no money down. Picks lock automatically and are never edited. <Link href="/backtest" className="text-sky">Historical track record</Link>
      </p>

      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Record" value={stats.graded ? `${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ""}` : "0-0"} sub={stats.winRate != null ? `${stats.winRate}% (need 52.4%)` : "No graded picks yet"} />
        <Tile label="Units at -110" value={signed(stats.units)} sub={stats.roi != null ? `${signed(stats.roi)}% return per bet` : "One unit per pick"} />
        <Tile label="Closing-line value" value={stats.clvAvg != null ? `${signed(stats.clvAvg)} pts` : "–"} sub={stats.clvPositive != null ? `line moved our way ${stats.clvPositive}% of the time` : "The truest early sign of an edge"} />
        <Tile label="Open picks" value={String(stats.pending)} sub={`${stats.picks} on the ledger`} />
      </section>
      {stats.graded < 100 && (
        <p className="mono mt-2 text-xs text-chalk-3">
          Small sample: {stats.graded} graded. Judge it on closing-line value first; a win rate means little before about 100 picks.
        </p>
      )}

      <h2 className="display mt-10 text-3xl font-bold text-chalk">This week</h2>
      {pending.length === 0 ? (
        <div className="card mt-3 p-6 text-center">
          <p className="text-base text-chalk-2">No open picks.</p>
          <p className="mt-1 text-sm text-chalk-3">New openers post Sunday and Monday. The tracker checks every hour and locks any game where the model and the line differ by {LEAN}+ points, seen at least {MIN_LEAD_HOURS} hours before kickoff.</p>
        </div>
      ) : (
        <PickTable picks={pending} live={(p) => {
          const r = lines.get(p.gameId);
          const now = r ? currentLine(r) : null;
          return now == null ? undefined : { text: pickText(p.side, now, p.homeAbbr, p.awayAbbr), clv: Math.round((p.side === "home" ? now - p.lockLine : p.lockLine - now) * 10) / 10 };
        }} />
      )}

      <h2 className="display mt-10 text-3xl font-bold text-chalk">Graded</h2>
      {graded.length === 0 ? (
        <p className="mt-2 text-sm text-chalk-3">Nothing graded yet. The first picks grade after their games go final.</p>
      ) : (
        <PickTable picks={graded} />
      )}

      <details className="mt-10 text-sm text-chalk-3">
        <summary className="cursor-pointer select-none hover:text-chalk-2">The rule, exactly</summary>
        <p className="mt-2 max-w-3xl">{RULE_TEXT}</p>
        <p className="mt-1 max-w-3xl">
          Lines are DraftKings via ESPN. The model margin is the same projection the game pages show: Elo (CollegeFootballData&apos;s, or our fitted copy when theirs is
          unavailable) plus unit edges. Closing-line value is how many points the final pregame line moved toward the pick. A simulation, not betting advice.
        </p>
        {picks[0] && <p className="mt-1">Last lock {asOf(picks.map((p) => p.lockedAt).sort().at(-1)!)} ET.</p>}
      </details>
    </div>
  );
}

function PickTable({ picks, live }: { picks: EdgePick[]; live?: (p: EdgePick) => { text: string; clv: number } | undefined }) {
  return (
    <div className="card mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-chalk-3">
            <th className="px-3 py-2">Game</th>
            <th className="px-3 py-2">Pick</th>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2 text-right">Gap</th>
            <th className="px-3 py-2">{live ? "Line now" : "Close"}</th>
            <th className="px-3 py-2 text-right">CLV</th>
            {!live && <th className="px-3 py-2">Result</th>}
          </tr>
        </thead>
        <tbody>
          {picks.map((p) => {
            const now = live?.(p);
            const clv = live ? now?.clv : p.clv;
            const model = p.model >= 0 ? `${p.homeAbbr} by ${p.model.toFixed(1)}` : `${p.awayAbbr} by ${Math.abs(p.model).toFixed(1)}`;
            return (
              <tr key={p.gameId} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/game/${p.gameId}`} className="font-semibold text-chalk hover:text-sky">{p.away} at {p.home}</Link>
                  <div className="mono text-[11px] text-chalk-3">Wk {p.week} · {when(p.kickoff)} ET</div>
                </td>
                <td className="px-3 py-2">
                  <span className="mono font-semibold text-chalk">{p.pick}</span>
                  <div className="mono text-[11px] text-chalk-3">locked {when(p.lockedAt)}</div>
                </td>
                <td className="mono px-3 py-2 text-chalk-2">{model}</td>
                <td className="mono px-3 py-2 text-right text-chalk-2">{p.gap}</td>
                <td className="mono px-3 py-2 text-chalk-2">
                  {live ? now?.text ?? "–" : p.closeLine != null ? pickText(p.side, p.closeLine, p.homeAbbr, p.awayAbbr) : "–"}
                </td>
                <td className={`mono px-3 py-2 text-right ${clv == null || clv === 0 ? "text-chalk-3" : clv > 0 ? "text-turf" : "text-brick"}`}>{signed(clv)}</td>
                {!live && (
                  <td className="px-3 py-2">
                    <span className={`mono text-xs font-semibold uppercase ${p.result === "win" ? "text-turf" : p.result === "loss" ? "text-brick" : "text-chalk-3"}`}>{p.result}</span>
                    {p.final && <div className="mono text-[11px] text-chalk-3">{p.awayAbbr} {p.final.away}, {p.homeAbbr} {p.final.home}</div>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="display mt-1 text-4xl font-bold text-chalk">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-chalk-3">{sub}</p>}
    </div>
  );
}
