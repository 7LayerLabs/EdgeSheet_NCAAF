import type { Game } from "@/lib/types";
import type { CallVerdict, Recap as RecapData, RecapMatchup } from "@/lib/recap";
import type { TeamGame } from "@/lib/espn-final";
import { asOf } from "@/lib/format";

/**
 * The postgame recap: every call from before kickoff, what actually happened, and whether it was
 * right, plus the plays that swung the game and how the players we flagged did.
 */
export function Recap({ recap, game }: { recap: RecapData; game: Game }) {
  const total = recap.score.right + recap.score.wrong + recap.score.mixed;
  return (
    <div className="mt-3 grid min-w-0 gap-4 *:min-w-0">
      <div className="card border-l-4 border-l-navy p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="display text-5xl font-extrabold text-chalk">
            {recap.score.right}
            <span className="text-2xl text-chalk-3"> of {total}</span>
          </span>
          <span className="text-sm text-chalk-2">
            calls right
            {recap.score.mixed ? `, ${recap.score.mixed} mixed` : ""}
            {recap.score.wrong ? `, ${recap.score.wrong} wrong` : ""}
          </span>
        </div>
        <p className="mt-2 text-lg leading-relaxed text-chalk">{recap.headline}</p>
        <p className="mt-1 text-xs text-chalk-3">
          {recap.lockedAt ? `Calls locked ${asOf(recap.lockedAt)} ET, before kickoff, and never edited. ` : ""}
          {recap.reconstructed
            ? "This game was locked before the matchup board existed, so the board here is rebuilt from the same team stats it would have used (unchanged since Oct 3). Quarterback ranks are rebuilt too and include this game."
            : ""}
        </p>
      </div>

      <Block title="The calls">
        <div className="grid gap-2">
          {recap.calls.map((c) => (
            <Line key={c.label} label={c.label} called={c.called} actual={c.actual} verdict={c.verdict} />
          ))}
          {recap.pressure && <Line label="Pressure point" called={recap.pressure.text} actual="Graded on that matchup below." verdict={recap.pressure.verdict} />}
        </div>
      </Block>

      {recap.swings.length > 0 && (
        <Block title="Turning points" note="The plays that moved the win chance the most.">
          <ol className="grid gap-2">
            {recap.swings.map((s, i) => (
              <li key={i} className="rounded border border-line bg-panel p-3 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="mono text-xs text-chalk-3">{s.when}</span>
                  <span className="font-semibold text-chalk">
                    {s.team}: {s.before}% to {s.after}% to win
                  </span>
                </p>
                <p className="mt-1 break-words text-chalk-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Block>
      )}

      {recap.matchups.length > 0 && (
        <Block title="Matchups: what we said and what happened" note="Each verdict uses a plain rule on this game's numbers, shown next to it. Even calls are not graded.">
          <div className="grid gap-2">
            {groupRows(recap.matchups).map(([title, rows]) => (
              <div key={title} className="rounded border border-line bg-panel">
                <p className="display border-b border-line px-3 py-1.5 text-lg font-bold text-chalk">{title}</p>
                <div className="grid md:grid-cols-2 md:divide-x md:divide-line">
                  {rows.map((m) => (
                    <div key={m.offense} className="p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="eyebrow">{m.offense} offense</p>
                        <Pill v={m.verdict} />
                      </div>
                      <p className="mt-1 text-chalk-2">
                        <span className="eyebrow mr-1">We said</span>
                        {m.called}
                      </p>
                      <p className="mt-1 text-chalk">
                        <span className="eyebrow mr-1">What happened</span>
                        {m.actual}{" "}
                        <span className="text-chalk-3">
                          {m.winner === "offense" ? `${m.offense} won it.` : m.winner === "defense" ? `${m.defense} won it.` : m.winner === "even" ? "Neither side won it." : ""}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {recap.qbs.length > 0 && (
        <Block title="Quarterbacks">
          <div className="grid gap-2 md:grid-cols-2">
            {recap.qbs.map((q) => (
              <div key={q.name} className="rounded border border-line bg-panel p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-chalk">{q.name}</span>
                  <span className="rounded bg-ink-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-chalk">{q.type}</span>
                  <span className={`text-xs font-semibold ${q.verdict === "above his average" ? "text-turf" : q.verdict === "below his average" ? "text-brick" : "text-chalk-3"}`}>{q.verdict}</span>
                </p>
                <p className="mt-1 text-xs text-chalk-3">
                  {q.team}. Ranked No. {q.rank} of {q.of} FBS quarterbacks before the game.
                </p>
                <p className="mono mt-1 text-chalk">{q.line}</p>
                {q.vsSeason && <p className="mt-0.5 text-chalk-2">{q.vsSeason}.</p>}
              </div>
            ))}
          </div>
        </Block>
      )}

      {recap.players.length > 0 && (
        <Block title="Players we flagged" note="The radar names in the pregame report and their lines.">
          <ul className="grid gap-1.5 md:grid-cols-2">
            {recap.players.map((p) => (
              <li key={p.name} className="flex items-start justify-between gap-2 rounded border border-line bg-panel px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-chalk">{p.name}</span> <span className="text-xs text-chalk-3">{p.pos}, {p.team}</span>
                  <span className="mono block text-xs text-chalk-2">{p.line}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${p.verdict === "showed up" ? "bg-turf text-white" : p.verdict === "quiet" ? "bg-ink-2 text-chalk-2" : "bg-ink-2 text-chalk-3"}`}>{p.verdict}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Team stats">
        <TeamStats away={recap.teams.away} home={recap.teams.home} game={game} />
      </Block>
    </div>
  );
}

function groupRows(rows: RecapMatchup[]): [string, RecapMatchup[]][] {
  const m = new Map<string, RecapMatchup[]>();
  for (const r of rows) (m.get(r.title) ?? m.set(r.title, []).get(r.title)!).push(r);
  return [...m];
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="display text-2xl font-bold text-chalk">{title}</h3>
      {note && <p className="mb-2 text-xs text-chalk-3">{note}</p>}
      <div className={note ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

function Pill({ v }: { v: CallVerdict }) {
  const tone = v === "right" ? "bg-turf text-white" : v === "wrong" ? "bg-brick text-white" : v === "mixed" ? "bg-[#b45309] text-white" : "bg-ink-2 text-chalk-3";
  return <span className={`w-fit shrink-0 self-start justify-self-start rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{v}</span>;
}

function Line({ label, called, actual, verdict }: { label: string; called: string; actual: string; verdict: CallVerdict }) {
  return (
    <div className="grid min-w-0 gap-1 rounded border border-line bg-panel p-3 text-sm sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
      <span className="eyebrow">{label}</span>
      <span className="text-chalk-2">
        <span className="eyebrow mr-1 sm:hidden">We said</span>
        {called}
      </span>
      <span className="text-chalk">
        <span className="eyebrow mr-1 sm:hidden">Happened</span>
        {actual}
      </span>
      <Pill v={verdict} />
    </div>
  );
}

function TeamStats({ away, home, game }: { away: TeamGame; home: TeamGame; game: Game }) {
  const ypc = (t: TeamGame) => (t.rushAtt ? (t.rushYds / t.rushAtt).toFixed(1) : "0");
  const ypa = (t: TeamGame) => (t.passAtt ? (t.passYds / t.passAtt).toFixed(1) : "0");
  const rows: [string, (t: TeamGame) => string][] = [
    ["Points", (t) => String(t.points)],
    ["Total yards", (t) => String(t.totalYards)],
    ["Rushing", (t) => `${t.rushYds} yds, ${ypc(t)} a carry`],
    ["Passing", (t) => `${t.passYds} yds, ${t.completions}/${t.passAtt}, ${ypa(t)} a throw`],
    ["Third downs", (t) => t.thirdDowns],
    ["Turnovers", (t) => String(t.turnovers)],
    ["Sacks made", (t) => String(t.sacks)],
    ["Tackles for loss made", (t) => String(t.tfl)],
    ["Big plays", (t) => `${t.explosivePasses} passes of 20+, ${t.explosiveRuns} runs of 15+`],
    ["Inside the 40", (t) => `${t.trips} trips: ${t.tripTd} TD, ${t.tripFg} FG`],
  ];
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-chalk-3">
            <th className="px-3 py-2"></th>
            <th className="px-3 py-2">{game.away.short}</th>
            <th className="px-3 py-2">{game.home.short}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-1.5 text-chalk-3">{label}</td>
              <td className="mono px-3 py-1.5 text-chalk">{f(away)}</td>
              <td className="mono px-3 py-1.5 text-chalk">{f(home)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
