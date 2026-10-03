import Link from "next/link";
import { backtestResults, recommendedWeights, type DraftAcc, type GridRow, type ProjectionGrade, type ProjectionSection } from "@/lib/backtest";

export const dynamic = "force-dynamic";

export const metadata = { title: "Track record" };

const pct = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : v.toFixed(d));
const sign = (v: number | null | undefined) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);

const GROUP_LABEL: Record<string, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end", OL: "Offensive line",
  DL: "Interior D-line", EDGE: "Edge", LB: "Linebacker", CB: "Cornerback", S: "Safety",
};

export default function BacktestPage() {
  const r = backtestResults();
  const w = recommendedWeights();

  if (!r) {
    return (
      <div>
        <p className="eyebrow">Track record</p>
        <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">No backtest on file</h1>
        <p className="mt-2 max-w-3xl text-base text-chalk-3">
          The historical replay has not been run. From the web folder, run <span className="mono">node scripts/backtest.mjs</span> with a CollegeFootballData key in .env.local. It writes data/backtest/results.json and this page reads it.
        </p>
        <p className="mt-4 text-sm"><Link href="/history" className="text-sky">Back to the record</Link></p>
      </div>
    );
  }

  const wf = r.walkForward;
  const full = r.projection;
  const liveRow = (s: ProjectionSection | null) => s?.overall.grid.find((g) => g.net === "live" && g.eloWeight === s.live.eloWeight && g.edgeDivisor === s.live.edgeDivisor);
  const eloRow = (s: ProjectionSection | null) => s?.overall.grid.find((g) => g.net === "live" && g.eloWeight === 1);
  const edgesRow = (s: ProjectionSection | null) => s?.overall.grid.find((g) => g.net === "live" && g.eloWeight === 0 && g.edgeDivisor === s.live.edgeDivisor);
  const wfLive = liveRow(wf);
  const wfElo = eloRow(wf);
  const wfEdges = edgesRow(wf);
  const draft = r.draft;
  const groups = Object.keys(GROUP_LABEL);

  return (
    <div>
      <p className="eyebrow">Track record</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">How the models did on past seasons</h1>
      <p className="mt-2 max-w-3xl text-base text-chalk-3">
        The projection, the radar, and the draft forecast replayed on {r.seasons.join(", ")} and graded against real finals, closing lines, and real draft picks.
        Replay run {new Date(r.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
        {r.skipped.length > 0 && ` Skipped: ${r.skipped.map((s) => `${s.season} (${s.reason})`).join("; ")}.`}
      </p>

      <section className="card mt-5 p-4">
        <p className="eyebrow">What this can and cannot claim</p>
        <ul className="mt-2 grid gap-1.5 text-sm text-chalk-2">
          <li>The walk-forward numbers use only what the site would have known the week before each game: pregame Elo and advanced stats through the prior week. Those are the honest numbers and the ones the recommended weights come from.</li>
          <li>The full-season replay feeds each game its own result through the season totals. It is shown for comparison and should not be quoted.</li>
          <li>The closing line is the median across books that CollegeFootballData lists. The model side cover rate counts every game, including ones where the model and the market nearly agree, so it is a weak signal by design. Watch the rows with a 2 or 4 point lean.</li>
          <li>Draft hit rates use the full regular season of stats, which is what the site has when the draft board matters. Juniors are kept in the pool whether or not they declared, because the replay has no declaration file.</li>
          <li>Four seasons is a small sample. A rate that moves two points between seasons is noise, not a trend.</li>
        </ul>
      </section>

      {wf && wfLive && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">Game projection, walk-forward</h2>
          <p className="mt-1 text-sm text-chalk-3">
            {wf.overall.counts.graded} FBS regular-season games from week {wf.minWeek ?? 4} on, {wf.overall.seasons?.join(", ")}. Each game graded with stats through the week before it.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Winner right" value={pct(wfLive.winnerRate)} sub={`${wfLive.winnerRight} of ${wfLive.winnerGraded}. Closing line: ${pct(wf.overall.market.winnerRate)}`} />
            <Tile label="Margin error" value={num(wfLive.mae)} sub={`points off per game. Closing line: ${num(wf.overall.market.mae)}. Elo only: ${num(wfElo?.mae)}`} />
            <Tile label="Model side vs number" value={pct(wfLive.coverRate)} sub={`${wfLive.coverRight} of ${wfLive.coverGraded}. With a 4 point lean: ${pct(wfLive.lean4CoverRate)} on ${wfLive.lean4Graded}`} />
            <Tile label="Total lean" value={pct(wf.overall.total.leanRate)} sub={`${wf.overall.total.leanRight} of ${wf.overall.total.leans} leans. Over ${pct(wf.overall.total.overRate)} on ${wf.overall.total.overLeans}, under ${pct(wf.overall.total.underRate)} on ${wf.overall.total.underLeans}`} />
          </div>
          <p className="mt-2 text-sm text-chalk-3">
            Favorites covered the closing number {pct(wf.overall.market.favoriteCoverRate)} of the time on these games, which is the baseline a side lean has to beat.
            Model total error {num(wf.overall.total.modelMae)} points against {num(wf.overall.total.marketMae)} for the posted total.
          </p>

          <h3 className="display mt-6 text-2xl font-bold text-chalk">By season</h3>
          <SeasonTable rows={wf.perSeason} live={wf.live} />

          <h3 className="display mt-6 text-2xl font-bold text-chalk">Which blend graded best</h3>
          <p className="mt-1 text-sm text-chalk-3">
            Margin = eloWeight times the Elo margin, plus net unit-edge percentile points divided by edgeDivisor. The live setting is {wf.live.eloWeight} and {wf.live.edgeDivisor}.
            Highlighted: lowest margin error. Rows marked all eight use every signed edge gap instead of the four largest with small gaps zeroed.
          </p>
          <GridTable grid={wf.overall.grid} best={wf.best} live={wf.live} />

          <h3 className="display mt-6 text-2xl font-bold text-chalk">Is the win probability honest?</h3>
          <p className="mt-1 text-sm text-chalk-3">Games bucketed by the live blend&apos;s stated win probability for its pick, against how often that pick won.</p>
          <div className="mt-2 grid gap-1.5">
            {wf.overall.calibration.map((b) => (
              <div key={b.bucket} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-3 text-sm">
                <span className="display text-xl font-bold text-chalk">{b.bucket}</span>
                <div className="meter !h-3"><span style={{ width: `${(b.winRate ?? 0) * 100}%` }} /></div>
                <span className="mono text-right text-xs text-chalk-2">{pct(b.winRate, 0)} of {b.games}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {full && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">Full-season replay, for comparison only</h2>
          <p className="mt-1 text-sm text-chalk-3">
            Same grid with end-of-season stats, {full.overall.counts.graded} games including weeks 1 to 3. Each game&apos;s own result is inside its inputs, so the edge-heavy rows look better than they are.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Tile label="Winner right (live blend)" value={pct(liveRow(full)?.winnerRate)} sub={`Closing line ${pct(full.overall.market.winnerRate)}`} />
            <Tile label="Margin error (live blend)" value={num(liveRow(full)?.mae)} sub={`Closing line ${num(full.overall.market.mae)}`} />
            <Tile label="Best row" value={full.best ? `${full.best.eloWeight} / ${full.best.edgeDivisor}` : "n/a"} sub={full.best ? `margin error ${num(full.best.mae)}, winner ${pct(full.best.winnerRate)}` : undefined} />
          </div>
        </section>
      )}

      {draft && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">Draft forecast</h2>
          <p className="mt-1 text-sm text-chalk-3">
            Drafts {draft.overall.draftYears.join(", ")}. Recall: of the players really taken, how many the forecast had in that range the season before. Specialists excluded.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Round one, in Round 1 range" value={pct(draft.overall.total.r1HitRate, 0)} sub={`${draft.overall.total.r1Hit} of ${draft.overall.total.r1} real first-rounders`} />
            <Tile label="Top 100, in Round 1 or Day 2 range" value={pct(draft.overall.total.top100HitRate, 0)} sub={`${draft.overall.total.top100Hit} of ${draft.overall.total.top100}`} />
            <Tile label="Draftees on the radar at all" value={pct(draft.overall.total.onRadarRate, 0)} sub={`${draft.overall.total.onRadar} of ${draft.overall.total.drafted}. In the eligible pool: ${pct(draft.overall.total.inPoolRate, 0)}`} />
            <Tile label="Rank correlation" value={sign(draft.overall.total.rankCorrelation)} sub={`Spearman, forecast board vs real pick, ${draft.overall.total.correlationN} drafted players. 1 is perfect, 0 is random.`} />
          </div>

          <h3 className="display mt-6 text-2xl font-bold text-chalk">Precision: what happened to the names in each band</h3>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
                <tr><th className="px-3 py-2">Band</th><th className="px-3 py-2 text-right">Names</th><th className="px-3 py-2 text-right">Drafted</th><th className="px-3 py-2 text-right">Round one</th><th className="px-3 py-2 text-right">Top 100</th></tr>
              </thead>
              <tbody>
                {draft.overall.bands.map((b) => (
                  <tr key={b.band} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold text-chalk">{b.band}</td>
                    <td className="mono px-3 py-2 text-right">{b.entries}</td>
                    <td className="mono px-3 py-2 text-right">{b.drafted} ({pct(b.draftedRate, 0)})</td>
                    <td className="mono px-3 py-2 text-right">{b.r1}</td>
                    <td className="mono px-3 py-2 text-right">{b.top100}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="display mt-6 text-2xl font-bold text-chalk">By position</h3>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
                <tr>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2 text-right">Drafted</th>
                  <th className="px-3 py-2 text-right">On radar</th>
                  <th className="px-3 py-2 text-right">R1 hit</th>
                  <th className="px-3 py-2 text-right">Top 100 hit</th>
                  <th className="px-3 py-2 text-right">Rank corr.</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const a: DraftAcc | undefined = draft.overall.byGroup[g];
                  if (!a) return null;
                  return (
                    <tr key={g} className="border-t border-line">
                      <td className="px-3 py-2 font-semibold text-chalk">{GROUP_LABEL[g]}</td>
                      <td className="mono px-3 py-2 text-right">{a.drafted}</td>
                      <td className="mono px-3 py-2 text-right">{pct(a.onRadarRate, 0)}</td>
                      <td className="mono px-3 py-2 text-right">{a.r1Hit} of {a.r1}</td>
                      <td className="mono px-3 py-2 text-right">{a.top100Hit} of {a.top100}</td>
                      <td className="mono px-3 py-2 text-right">{sign(a.rankCorrelation)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {draft.perSeason.map((s) => (
              <div key={s.season} className="card p-3">
                <p className="eyebrow">{s.draftYear} draft</p>
                {s.available && s.total ? (
                  <p className="mt-1 text-sm text-chalk-2">
                    R1 {s.total.r1Hit} of {s.total.r1}. Top 100 {s.total.top100Hit} of {s.total.top100}. On radar {pct(s.total.onRadarRate, 0)}. Pool {s.poolSize}. Corr. {sign(s.total.rankCorrelation)}.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-chalk-3">{s.reason ?? "Not available"}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {r.excitement && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">Does the Scout Score track watchability?</h2>
          <p className="mt-1 text-sm text-chalk-3">
            CollegeFootballData&apos;s excitement index (0 to 10, from the win probability swings) against two Scout Score inputs we can rebuild for past games: competitive expectation from the closing spread, and style contrast. Correlation, 1 is perfect.
          </p>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
                <tr><th className="px-3 py-2">Season</th><th className="px-3 py-2 text-right">Games</th><th className="px-3 py-2 text-right">Competitive</th><th className="px-3 py-2 text-right">Style contrast</th><th className="px-3 py-2 text-right">Both averaged</th><th className="px-3 py-2">Avg excitement by competitive bucket</th></tr>
              </thead>
              <tbody>
                {r.excitement.perSeason.map((e) => (
                  <tr key={e.season} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold text-chalk">{e.season}</td>
                    <td className="mono px-3 py-2 text-right">{e.games}</td>
                    <td className="mono px-3 py-2 text-right">{sign(e.competitive.spearman)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(e.styleContrast.spearman)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(e.proxy.spearman)}</td>
                    <td className="mono px-3 py-2 text-xs text-chalk-2">{e.byCompetitiveBucket.map((b) => `${b.label}: ${num(b.avgExcitement)}`).join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {r.nfl && !r.nfl.error && (
        <section className="mt-8">
          <h2 className="display text-3xl font-bold text-chalk">NFL outcomes</h2>
          <p className="mt-1 text-sm text-chalk-3">
            {r.nfl.matched} drafted radar players joined to nflverse career value through the {r.nfl.lastNflSeason} NFL season. Value is approximate value per season played.
            Rank correlation of each radar input with that value, next to the real draft slot as the benchmark. Careers this young are mostly noise; read the sign, not the size.
          </p>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
                <tr><th className="px-3 py-2">Group</th><th className="px-3 py-2 text-right">Players</th><th className="px-3 py-2 text-right">Production</th><th className="px-3 py-2 text-right">Pedigree</th><th className="px-3 py-2 text-right">Usage</th><th className="px-3 py-2 text-right">Radar score</th><th className="px-3 py-2 text-right">Real pick</th></tr>
              </thead>
              <tbody>
                {[r.nfl.overall, ...r.nfl.byGroup].map((s) => (
                  <tr key={s.group} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold text-chalk">{GROUP_LABEL[s.group] ?? "All positions"}</td>
                    <td className="mono px-3 py-2 text-right">{s.n}</td>
                    <td className="mono px-3 py-2 text-right">{sign(s.production)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(s.pedigree)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(s.usage)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(s.radarScore)}</td>
                    <td className="mono px-3 py-2 text-right">{sign(s.realPick)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {r.nfl?.error && <p className="mt-6 text-sm text-chalk-3">NFL outcomes not available: {r.nfl.error}</p>}

      {w?.projection && (
        <section className="card mt-8 p-4">
          <p className="eyebrow">Recommended weights (not applied)</p>
          <p className="mt-1 text-sm text-chalk-2">
            eloWeight {w.projection.eloWeight}, edgeDivisor {w.projection.edgeDivisor}. Written to data/weights.json by the backtest. The live projection keeps its constants until USE_FITTED_WEIGHTS=1 is set.
          </p>
          {w.comment && <p className="mt-2 text-xs text-chalk-3">{w.comment}</p>}
        </section>
      )}

      <section className="mt-8">
        <h2 className="display text-2xl font-bold text-chalk">Where the replay differs from the live code</h2>
        <ul className="mt-2 grid gap-1 text-sm text-chalk-3">
          {r.drift.map((d) => <li key={d}>{d}</li>)}
        </ul>
        <p className="mt-4 text-sm"><Link href="/history" className="text-sky">Back to the record</Link></p>
      </section>
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

function SeasonTable({ rows, live }: { rows: ProjectionGrade[]; live: { eloWeight: number; edgeDivisor: number } }) {
  return (
    <div className="card mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
          <tr>
            <th className="px-3 py-2">Season</th>
            <th className="px-3 py-2 text-right">Games</th>
            <th className="px-3 py-2 text-right">Winner</th>
            <th className="px-3 py-2 text-right">Line winner</th>
            <th className="px-3 py-2 text-right">Margin err</th>
            <th className="px-3 py-2 text-right">Line err</th>
            <th className="px-3 py-2 text-right">Side vs number</th>
            <th className="px-3 py-2 text-right">4 pt lean</th>
            <th className="px-3 py-2 text-right">Total lean</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const g = s.grid.find((x) => x.net === "live" && x.eloWeight === live.eloWeight && x.edgeDivisor === live.edgeDivisor);
            return (
              <tr key={s.season} className="border-t border-line">
                <td className="px-3 py-2 font-semibold text-chalk">{s.season}</td>
                <td className="mono px-3 py-2 text-right">{s.counts.graded}</td>
                <td className="mono px-3 py-2 text-right">{pct(g?.winnerRate)}</td>
                <td className="mono px-3 py-2 text-right">{pct(s.market.winnerRate)}</td>
                <td className="mono px-3 py-2 text-right">{num(g?.mae)}</td>
                <td className="mono px-3 py-2 text-right">{num(s.market.mae)}</td>
                <td className="mono px-3 py-2 text-right">{pct(g?.coverRate)}</td>
                <td className="mono px-3 py-2 text-right">{pct(g?.lean4CoverRate)} ({g?.lean4Graded ?? 0})</td>
                <td className="mono px-3 py-2 text-right">{pct(s.total.leanRate)} ({s.total.leans})</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GridTable({ grid, best, live }: { grid: GridRow[]; best: GridRow | null; live: { eloWeight: number; edgeDivisor: number } }) {
  const isBest = (g: GridRow) => !!best && g.net === best.net && g.eloWeight === best.eloWeight && g.edgeDivisor === best.edgeDivisor;
  const isLive = (g: GridRow) => g.net === "live" && g.eloWeight === live.eloWeight && g.edgeDivisor === live.edgeDivisor;
  return (
    <div className="card mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-chalk-3">
          <tr>
            <th className="px-3 py-2">Elo weight</th>
            <th className="px-3 py-2">Edge divisor</th>
            <th className="px-3 py-2">Edges used</th>
            <th className="px-3 py-2 text-right">Winner</th>
            <th className="px-3 py-2 text-right">Margin err</th>
            <th className="px-3 py-2 text-right">Side vs number</th>
            <th className="px-3 py-2 text-right">2 pt lean</th>
            <th className="px-3 py-2 text-right">4 pt lean</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((g) => (
            <tr key={`${g.net}-${g.eloWeight}-${g.edgeDivisor}`} className={`border-t border-line ${isBest(g) ? "bg-turf/10 font-semibold" : isLive(g) ? "bg-ink-2" : ""}`}>
              <td className="mono px-3 py-2">{g.eloWeight === 1 ? "1 (Elo only)" : g.eloWeight === 0 ? "0 (edges only)" : g.eloWeight}{isLive(g) ? " (live)" : ""}{isBest(g) ? " (best)" : ""}</td>
              <td className="mono px-3 py-2">{g.eloWeight === 1 ? "n/a" : g.edgeDivisor}</td>
              <td className="px-3 py-2 text-chalk-2">{g.net === "raw" ? "all eight" : "top four"}</td>
              <td className="mono px-3 py-2 text-right">{pct(g.winnerRate)}</td>
              <td className="mono px-3 py-2 text-right">{num(g.mae, 2)}</td>
              <td className="mono px-3 py-2 text-right">{pct(g.coverRate)}</td>
              <td className="mono px-3 py-2 text-right">{pct(g.lean2CoverRate)} ({g.lean2Graded})</td>
              <td className="mono px-3 py-2 text-right">{pct(g.lean4CoverRate)} ({g.lean4Graded})</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
