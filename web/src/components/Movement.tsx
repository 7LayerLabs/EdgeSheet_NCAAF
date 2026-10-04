import Link from "next/link";
import { adjustedProduction, qualityOfCompetition, AXIS_LABEL } from "@/lib/adjusted";
import { biggestMoves, listSnapshots, movementFor, scoreSeries, snapshotDateLabel, type MoveRow } from "@/lib/movement";
import { Sparkline } from "./MovementBits";

export { DeltaArrow, Sparkline } from "./MovementBits";

/**
 * Movement and schedule-strength pieces. The small ones (DeltaArrow, Sparkline)
 * take plain props and are safe anywhere. GameLog, StockPanel and BiggestMoves
 * read the digests and snapshots, so they are server components only.
 */

/* ------------------------------------------------------ player page pieces */

/** Sparkline plus a "this week" chip. Honest when only one snapshot exists. */
export function StockPanel({ playerId }: { playerId: string }) {
  const series = scoreSeries(playerId);
  const m = movementFor(playerId);
  const dates = listSnapshots();
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="eyebrow">Stock</p>
        {m ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-chalk">
            <span className={`mono rounded px-1.5 py-0.5 text-xs font-bold ${m.scoreDelta > 0 ? "bg-turf text-white" : m.scoreDelta < 0 ? "bg-brick text-white" : "bg-ink-2 text-chalk-2"}`}>
              This week {m.scoreDelta > 0 ? "+" : ""}{m.scoreDelta}
            </span>
            <span className="text-chalk-2">{m.prevScore} to {m.score}, {m.reasonText}</span>
            {m.bandFrom && m.bandTo && m.bandFrom !== m.bandTo && <span className="text-chalk-3">· forecast {m.bandFrom.replace(" range", "")} to {m.bandTo.replace(" range", "")}</span>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-chalk-3">
            {dates.length === 0
              ? "No weekly snapshot yet. Movement appears once two snapshots exist."
              : series.length === 0
                ? `Not in the ${snapshotDateLabel(dates[0])} snapshot. Movement appears once he is in two of them.`
                : `First snapshot taken ${snapshotDateLabel(dates[0])}. Movement appears after the next one.`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Sparkline points={series} />
        {series.length >= 2 && <span className="mono text-[11px] text-chalk-3">{series.length} wk</span>}
      </div>
    </div>
  );
}

/** Game log table with the opponent's rank on the player's production axis, and the schedule label. */
export function GameLog({ playerId, group }: { playerId: string; group: string }) {
  const a = adjustedProduction(playerId, group);
  const q = qualityOfCompetition(playerId, group);
  if (!a) {
    return (
      <section className="mt-8">
        <p className="eyebrow">Game log vs opponent quality</p>
        <p className="mt-2 text-sm text-chalk-3">No game log ingested for this player. Run npm run ingest:gamelogs inside web/.</p>
      </section>
    );
  }
  const axisLabel = a.axis ? AXIS_LABEL[a.axis] : null;
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="eyebrow">Game log vs opponent quality</p>
        {q.label !== "unmeasured" && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${q.label === "tough" ? "bg-navy text-white" : q.label === "soft" ? "bg-warn/20 text-chalk" : "bg-ink-2 text-chalk-2"}`}>
            {q.label} schedule
          </span>
        )}
        <span className="mono text-xs text-chalk-3">{q.text}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-1.5 pr-3 font-semibold text-chalk-3">Wk</th>
              <th className="pb-1.5 pr-3 font-semibold text-chalk-3">Opponent</th>
              <th className="pb-1.5 pr-3 font-semibold text-chalk-3">{axisLabel ? `Their ${axisLabel}` : "Opponent"}</th>
              <th className="pb-1.5 pr-3 font-semibold text-chalk-3">His line</th>
              <th className="pb-1.5 text-right font-semibold text-chalk-3" title="Game production, raw then opponent-weighted">Raw / adj</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r) => (
              <tr key={r.gameId + r.week} className="border-t border-line">
                <td className="mono py-1.5 pr-3 text-chalk-3">{r.week}</td>
                <td className="py-1.5 pr-3 text-chalk">
                  <Link href={`/game/${r.gameId}`} className="hover:text-sky">{r.homeAway === "home" ? "vs" : "at"} {r.opponent}</Link>
                </td>
                <td className="py-1.5 pr-3">
                  {r.oppRank !== null ? (
                    <span className={r.oppPct !== null && r.oppPct >= 75 ? "text-navy font-semibold" : r.oppPct !== null && r.oppPct <= 25 ? "text-chalk-3" : "text-chalk-2"}>No. {r.oppRank} of {r.oppOf}</span>
                  ) : (
                    <span className="text-chalk-3">{r.oppNote}</span>
                  )}
                </td>
                <td className="mono py-1.5 pr-3 text-chalk">{r.line}</td>
                <td className="mono py-1.5 text-right text-chalk-3">{r.raw} / {r.adjusted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-chalk-3">
        Each game is weighted by the opponent&apos;s season rank on this position&apos;s axis: 1.0 for an average unit, about 1.5 for the best, 0.6 for the worst or for an FCS opponent with no advanced stats. Raw per-game average {a.rawAvg}, adjusted {a.adjAvg}{a.ratio ? ` (${a.ratio}x)` : ""}. Production on the radar is half the raw season percentile and half the adjusted one.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- draft page */

function MoveList({ title, rows, forecast = false }: { title: string; rows: MoveRow[]; forecast?: boolean }) {
  return (
    <div>
      <p className="eyebrow">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-chalk-3">None this week.</p>
      ) : (
        <ol className="mt-1 grid gap-1">
          {rows.map((r) => (
            <li key={r.id} className="card flex items-center gap-3 px-3 py-2 text-sm">
              <span className={`mono w-12 shrink-0 text-right text-base font-bold ${(forecast ? r.overallDelta ?? 0 : r.scoreDelta) > 0 ? "text-turf" : "text-brick"}`}>
                {forecast ? `${(r.overallDelta ?? 0) > 0 ? "+" : ""}${r.overallDelta}` : `${r.scoreDelta > 0 ? "+" : ""}${r.scoreDelta}`}
              </span>
              <span className="min-w-0 flex-1">
                <Link href={`/player/${r.id}`} className="display block truncate text-lg font-bold text-chalk hover:text-sky">{r.name}</Link>
                <span className="mono text-[11px] text-chalk-3">{r.pos} · {r.team} · {r.cls} · {forecast ? `No. ${r.overallFrom} to No. ${r.overallTo}${r.bandFrom !== r.bandTo ? `, ${r.bandFrom?.replace(" range", "")} to ${r.bandTo?.replace(" range", "")}` : ""}` : `radar ${r.prevScore} to ${r.score}`}</span>
                <span className="block truncate text-xs text-chalk-2">{r.reasonText}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "Biggest moves this week" for the draft page. Says plainly when only one snapshot exists. */
export function BiggestMoves({ n = 5 }: { n?: number }) {
  const m = biggestMoves(n);
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="display text-4xl font-bold text-chalk">Biggest moves this week</h2>
        <span className="mono text-xs text-chalk-3">{m.note}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {m.available ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <MoveList title="Radar risers" rows={m.risers} />
          <MoveList title="Radar fallers" rows={m.fallers} />
          <MoveList title="Up the forecast board" rows={m.forecastRisers} forecast />
          <MoveList title="Down the forecast board" rows={m.forecastFallers} forecast />
        </div>
      ) : (
        <div className="card mt-3 p-5">
          <p className="text-base text-chalk">{m.note}</p>
          <p className="mt-1 text-sm text-chalk-3">Snapshots freeze every radar score and forecast band once a week. The second one turns this into risers and fallers with the reason: production, pedigree, usage, or a declaration.</p>
        </div>
      )}
    </section>
  );
}
