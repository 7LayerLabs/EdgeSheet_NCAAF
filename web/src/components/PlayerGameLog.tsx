import type { PlayerLog } from "@/lib/playerlog";

/**
 * Play-by-play for one player in one game, from ESPN's summary. Big plays are
 * highlighted. The computed line sits next to the box line so the reader can
 * see the two agree (or not). Server component, plain props.
 */
export function PlayerGameLog({ log, boxLines, live }: { log: PlayerLog; boxLines?: { category: string; headline: string }[]; live: boolean }) {
  const q = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : n === 5 ? "OT" : `${n - 4}OT`);
  const score = log.home.score != null && log.away.score != null ? `${log.away.abbr} ${log.away.score}, ${log.home.abbr} ${log.home.score}` : "";
  const big = log.plays.filter((p) => p.isBig).length;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={`eyebrow ${live ? "text-turf" : ""}`}>{live ? "Live log" : "Game log, this week"}</p>
        <span className="mono text-xs text-chalk-3">
          {log.detail}{score ? ` · ${score}` : ""}
        </span>
      </div>

      {log.reason ? (
        <p className="mt-2 text-sm text-chalk-3">{log.reason}</p>
      ) : (
        <>
          {log.ambiguous && (
            <p className="mt-2 rounded border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-chalk">
              Name match is ambiguous: {log.ambiguousWith} shares the jersey, initial, and last name, so some of these plays could be his.
            </p>
          )}

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="card p-3">
              <p className="eyebrow">From the plays</p>
              {log.lineText.length ? (
                <ul className="mono mt-1 grid gap-0.5 text-sm text-chalk">
                  {log.lineText.map((l) => (
                    <li key={l.category}>
                      <span className="text-chalk-3">{l.category}: </span>
                      {l.headline}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mono mt-1 text-sm text-chalk-3">No play names him yet ({log.playsParsed} plays parsed).</p>
              )}
            </div>
            <div className="card p-3">
              <p className="eyebrow">Box score</p>
              {boxLines && boxLines.length ? (
                <ul className="mono mt-1 grid gap-0.5 text-sm text-chalk">
                  {boxLines.map((l) => (
                    <li key={l.category}>
                      <span className="text-chalk-3">{l.category}: </span>
                      {l.headline}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mono mt-1 text-sm text-chalk-3">No box line yet.</p>
              )}
            </div>
          </div>

          {log.plays.length > 0 && (
            <>
              <p className="mono mt-3 text-xs text-chalk-3">
                {log.plays.length} plays involving him, {big} big. Big means 20 or more yards, a score, a sack, an interception, a tackle for loss, or a turnover.
              </p>
              <ol className="mt-2 grid gap-1">
                {[...log.plays].reverse().map((p) => (
                  <li
                    key={p.id}
                    className={`grid grid-cols-[4.5rem_1fr] gap-2 rounded border px-3 py-2 text-sm sm:grid-cols-[4.5rem_9rem_1fr] ${
                      p.isScoring ? "border-turf/50 bg-turf/10" : p.isBig ? "border-navy/40 bg-panel" : "border-line"
                    }`}
                  >
                    <span className="mono text-xs text-chalk-3">
                      {q(p.quarter)} {p.clock}
                    </span>
                    <span className="mono hidden text-xs text-chalk-3 sm:block">{p.situation ?? ""}</span>
                    <span className="min-w-0">
                      <span className={`font-semibold ${p.isScoring ? "text-turf" : p.isBig ? "text-navy" : "text-chalk"}`}>{p.tag}</span>
                      <span className="mono ml-2 text-xs text-chalk-3">
                        {p.awayScore}-{p.homeScore}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-chalk-2">{p.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
