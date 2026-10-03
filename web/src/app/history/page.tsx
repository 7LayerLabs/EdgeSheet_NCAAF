import Link from "next/link";
import { historyStats, listEntries } from "@/lib/archive";
import { asOf, kickoffTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

export default function HistoryPage() {
  const entries = listEntries();
  const stats = historyStats(entries);
  const graded = entries.filter((e) => e.postgame);
  const pending = entries.filter((e) => !e.postgame);

  return (
    <div>
      <p className="eyebrow">The record</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">Did it play out?</h1>
      <p className="mt-2 max-w-3xl text-base text-chalk-3">
        Every Division I game gets its pregame call locked before kickoff: the matchup edges, the pressure point, the radar names, the Scout Score, the line.
        After the final, the box score grades it. Nothing is edited after the fact. This is the archive the thresholds get tuned against.
      </p>

      {entries.length === 0 && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-3xl text-chalk">Nothing locked yet</p>
          <p className="mt-1 text-base text-chalk-3">Calls lock the first time a slate or game page is built while the game is still upcoming.</p>
        </div>
      )}

      {entries.length > 0 && (
        <section className="mt-6 grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Tile label="Games locked" value={String(stats.games)} sub={`${stats.graded} graded`} />
          <Tile label="Model winner" value={pct(stats.winnerRight, stats.winnerGraded)} sub={`${stats.winnerRight} of ${stats.winnerGraded}${stats.avgMarginError != null ? ` · margin off by ${stats.avgMarginError.toFixed(1)} avg` : ""}`} />
          <Tile label="Model vs number" value={pct(stats.modelSideCovered, stats.modelSideGraded)} sub={`${stats.modelSideCovered} of ${stats.modelSideGraded} model sides covered`} />
          <Tile label="Model total lean" value={pct(stats.totalLeanRight, stats.totalLeanGraded)} sub={`${stats.totalLeanRight} of ${stats.totalLeanGraded} over/under leans right`} />
          <Tile label="Matchup calls" value={pct(stats.edgePlayedOut, stats.edgeCalls)} sub={`${stats.edgePlayedOut} played out, ${stats.edgeMissed} missed, of ${stats.edgeCalls}`} />
          <Tile label="Pressure point" value={pct(stats.pressurePlayedOut, stats.pressureGraded)} sub={`${stats.pressurePlayedOut} of ${stats.pressureGraded}`} />
          <Tile label="Radar names" value={pct(stats.prospectShowedUp, stats.prospectCalls)} sub={`${stats.prospectShowedUp} of ${stats.prospectCalls} showed up`} />
          <Tile label="Favorites covered" value={pct(stats.favoriteCovered, stats.spreadGraded)} sub={`${stats.favoriteCovered} of ${stats.spreadGraded} (context, not picks)`} />
        </section>
      )}

      {stats.graded > 0 && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">Scout Score vs how the game actually played</h2>
          <p className="mt-1 text-sm text-chalk-3">Average excitement index (from the data feed, 0 to 10) by pregame Scout Score bucket. If the score means anything, the top bucket should sit highest.</p>
          <div className="mt-3 grid gap-1.5">
            {stats.byBucket.map((b) => (
              <div key={b.label} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3 text-sm">
                <span className="display text-xl font-bold text-chalk">{b.label}</span>
                <div className="meter !h-3"><span style={{ width: `${((b.avgExcitement ?? 0) / 10) * 100}%` }} /></div>
                <span className="mono text-right text-xs text-chalk-2">{b.avgExcitement != null ? b.avgExcitement.toFixed(1) : "–"} · {b.games} g</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {graded.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="display text-3xl font-bold text-chalk">Graded</h2>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ol className="mt-3 grid gap-2">
            {graded.map((e) => {
              const p = e.postgame!;
              const edges = p.edges.filter((x) => x.edge !== "even" && x.verdict !== "unmeasured");
              const hits = edges.filter((x) => x.verdict === "played out").length;
              const pros = p.prospects.filter((x) => x.verdict !== "unmeasured");
              const showed = pros.filter((x) => x.verdict === "showed up").length;
              return (
                <li key={e.gameId} className="card final-card grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <Link href={`/game/${e.gameId}`} className="display text-2xl font-bold text-chalk hover:text-sky">
                      {e.pregame.away} {p.score.away} @ {e.pregame.home} {p.score.home}
                    </Link>
                    <p className="mono mt-0.5 text-xs text-chalk-3">
                      {asOf(e.pregame.kickoff)} · Scout Score {e.pregame.scoutScore}{p.excitement != null ? ` · excitement ${p.excitement.toFixed(1)}` : ""}{p.spreadResult ? ` · ${p.spreadResult}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-chalk-2">{e.pregame.pressurePoint.split(". ").slice(0, 2).join(". ")}.</p>
                  </div>
                  <div className="flex gap-2 text-center">
                    <Badge value={`${hits}/${edges.length}`} label="edges" tone={hits >= edges.length / 2 ? "good" : "bad"} />
                    <Badge value={`${showed}/${pros.length}`} label="radar" tone={showed >= pros.length / 2 ? "good" : "bad"} />
                    <Badge value={p.pressurePointVerdict === "played out" ? "yes" : p.pressurePointVerdict === "did not play out" ? "no" : "–"} label="pressure" tone={p.pressurePointVerdict === "played out" ? "good" : p.pressurePointVerdict === "did not play out" ? "bad" : "neutral"} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="display text-3xl font-bold text-chalk">Locked, waiting on a final</h2>
            <span className="mono text-xs text-chalk-3">{pending.length}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="mt-3 grid gap-1.5">
            {pending.map((e) => (
              <li key={e.gameId} className="card flex items-center justify-between gap-3 px-4 py-2.5">
                <Link href={`/game/${e.gameId}`} className="display text-xl font-bold text-chalk hover:text-sky">
                  {e.pregame.away} @ {e.pregame.home}
                </Link>
                <span className="mono shrink-0 text-xs text-chalk-3">{kickoffTime(e.pregame.kickoff)} ET · locked {asOf(e.pregame.capturedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function Badge({ value, label, tone }: { value: string; label: string; tone: "good" | "bad" | "neutral" }) {
  const t = tone === "good" ? "border-turf text-turf" : tone === "bad" ? "border-brick text-brick" : "border-line text-chalk-3";
  return (
    <span className={`flex w-16 flex-col rounded border-2 bg-white px-2 py-1 ${t}`}>
      <span className="display text-xl font-bold">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </span>
  );
}
