import Link from "next/link";
import { genDraft, generatedLoaded } from "@/lib/generated";
import { forecastNextDraft, pickText, type Band, type ForecastEntry } from "@/lib/forecast";
import { GROUP_LABEL, type PosGroup } from "@/lib/radar";
import { Avatar } from "@/components/Avatar";
import { gameIndexForWeek } from "@/lib/slate";
import type { Game } from "@/lib/types";
import { BiggestMoves } from "@/components/Movement";

export const dynamic = "force-dynamic";

/** Group CFBD's long position names into the radar's groups. */
const GROUP: Record<string, string> = {
  Quarterback: "QB", "Running Back": "RB", "Wide Receiver": "WR", "Tight End": "TE",
  "Offensive Tackle": "OT", "Offensive Guard": "IOL", Center: "IOL",
  "Defensive Edge": "EDGE", "Defensive Tackle": "DT", "Defensive End": "EDGE", Linebacker: "LB",
  Cornerback: "CB", Safety: "S", "Place Kicker": "K", Punter: "P", "Long Snapper": "LS",
};

const BAND_TONE: Record<Band, string> = {
  "Round 1 range": "bg-navy text-white",
  "Day 2 range": "bg-sky text-white",
  "Day 3 range": "bg-ink-2 text-chalk",
  "Priority free agent": "bg-ink-2 text-chalk-3",
};

export default async function DraftPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const picks = genDraft();
  const loaded = generatedLoaded() && picks.length > 0;
  const years = [...new Set(picks.map((p) => p.year))].sort((a, b) => b - a);
  const latest = years[0];
  const histYear = years.includes(Number(sp.year)) ? Number(sp.year) : latest;

  /* ------------------------------------------------ five-year history */
  const byYearGroup = new Map<number, Map<string, { all: number; r1: number; top50: number }>>();
  for (const p of picks) {
    const g = GROUP[p.pos] ?? p.pos;
    const m = byYearGroup.get(p.year) ?? byYearGroup.set(p.year, new Map()).get(p.year)!;
    const e = m.get(g) ?? m.set(g, { all: 0, r1: 0, top50: 0 }).get(g)!;
    e.all++;
    if (p.round === 1) e.r1++;
    if (p.overall <= 50) e.top50++;
  }
  const groups = [...new Set(picks.map((p) => GROUP[p.pos] ?? p.pos))].filter((g) => !["K", "P", "LS"].includes(g));
  const asc = [...years].sort();
  const rows = groups
    .map((g) => ({ g, cells: asc.map((y) => byYearGroup.get(y)?.get(g)?.top50 ?? 0), avg: asc.reduce((s, y) => s + (byYearGroup.get(y)?.get(g)?.top50 ?? 0), 0) / Math.max(1, asc.length) }))
    .sort((a, b) => b.avg - a.avg);
  const maxCell = Math.max(1, ...rows.flatMap((r) => r.cells));

  const colleges = new Map<string, { picks: number; r1: number }>();
  for (const p of picks) {
    const e = colleges.get(p.college) ?? colleges.set(p.college, { picks: 0, r1: 0 }).get(p.college)!;
    e.picks++;
    if (p.round === 1) e.r1++;
  }
  const topColleges = [...colleges].sort((a, b) => b[1].picks - a[1].picks || b[1].r1 - a[1].r1).slice(0, 15);
  const confs = new Map<string, number>();
  for (const p of picks) confs.set(p.conf ?? "Other", (confs.get(p.conf ?? "Other") ?? 0) + 1);
  const topConfs = [...confs].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const round1 = picks.filter((p) => p.year === histYear && p.round === 1).sort((a, b) => a.overall - b.overall);

  /* ------------------------------------------------------- forecast */
  const fc = loaded ? forecastNextDraft() : undefined;
  const games: Map<string, Game> = loaded ? await gameIndexForWeek() : new Map();
  const r1Board = fc?.board.filter((e) => e.band === "Round 1 range") ?? [];
  const day2 = fc?.board.filter((e) => e.band === "Day 2 range") ?? [];
  const posFilter = (typeof sp.pos === "string" ? sp.pos : undefined) as PosGroup | undefined;
  const groupList = fc && posFilter && fc.byGroup.has(posFilter) ? fc.byGroup.get(posFilter)! : [];

  return (
    <div>
      <p className="eyebrow">NFL Draft</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">{fc ? `${fc.draftYear} forecast` : "NFL Draft"}</h1>
      <p className="mt-2 max-w-3xl text-base text-chalk-3">
        Supply is the scouting radar: this season&apos;s production, recruiting pedigree, usage, and size for every draft-eligible Division I player. Demand is the last five drafts: how many players at each position actually go in round one, the top 100, and overall. The forecast matches the two and assigns a range, never a pick. It is a model, not a scouting consensus, and it does not know about injuries, film, or character.
      </p>

      {!loaded && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-3xl text-chalk">Draft data needs ingest</p>
          <p className="mt-1 text-base text-chalk-3">Run <code className="mono">npm run ingest</code> inside web/.</p>
        </div>
      )}

      {fc && (
        <>
          <BiggestMoves n={5} />

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="display text-4xl font-bold text-chalk">Round 1 range</h2>
              <span className="mono text-xs text-chalk-3">{r1Board.length} names, matched to the five-year average of first-round picks by position</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <ol className="mt-3 grid gap-2 md:grid-cols-2">
              {r1Board.map((e) => (
                <ForecastRow key={e.player.id} e={e} games={games} />
              ))}
            </ol>
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="display text-4xl font-bold text-chalk">By position</h2>
              <span className="mono text-xs text-chalk-3">five-year demand per position, then that position&apos;s board</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="scroll-x -mx-4 mt-3 flex gap-2 px-4 pb-1">
              {fc.demand.map((d) => (
                <Link key={d.group} href={`/draft?pos=${d.group}`} className="chip" aria-pressed={posFilter === d.group}>
                  {d.group} <span className="mono text-[10px] opacity-70">{d.r1.toFixed(1)} R1 · {d.perDraft.toFixed(0)}/yr</span>
                </Link>
              ))}
            </div>
            {posFilter && groupList.length > 0 ? (
              <ol className="mt-3 grid gap-2 md:grid-cols-2">
                {groupList.map((e) => (
                  <ForecastRow key={e.player.id} e={e} games={games} showPos />
                ))}
              </ol>
            ) : (
              <>
                <ol className="mt-3 grid gap-2 md:grid-cols-2">
                  {day2.slice(0, 16).map((e) => (
                    <ForecastRow key={e.player.id} e={e} games={games} />
                  ))}
                </ol>
                <p className="mt-2 text-xs text-chalk-3">Showing the top of the Day 2 range. Pick a position above for its full board.</p>
              </>
            )}
          </section>

          <section className="mt-6 grid gap-2 text-sm text-chalk-3 sm:grid-cols-2">
            <div className="card p-4">
              <p className="eyebrow">How the forecast works</p>
              <p className="mt-1 leading-relaxed">
                Each position gets as many Round 1, Day 2, and Day 3 slots as the last five drafts averaged for that position. Players fill the slots in radar order after a demand adjustment: positions the league pays up for early (edge, tackle, corner, receiver, quarterback) get a bump of up to 8 points; positions it waits on (running back, linebacker, safety) get a haircut. Five-star recruits with starter usage get a 12-point pedigree bump, because the league pays for pedigree through an average month. The estimated pick is the board position, with a spread of 6 in round one, 15 on day two, and 40 on day three. Seniors are eligible. Juniors stay on the board until they announce they are returning; mark that on the player page and the board re-forms.
              </p>
            </div>
            <div className="card p-4">
              <p className="eyebrow">How to use it</p>
              <p className="mt-1 leading-relaxed">
                Treat the band as a bar to clear, not a prediction of where he goes. A Round 1 range player is the one to study on Saturday; the radar score tells you how much of that is production versus pedigree. Follow him and his games land on your watchlist. The Record tab will show how often these names show up when it matters.
              </p>
            </div>
          </section>
        </>
      )}

      {loaded && (
        <>
          <section className="mt-12">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="display text-4xl font-bold text-chalk">What scouts went after</h2>
              <span className="mono text-xs text-chalk-3">top-50 picks by position, {asc[0]} to {latest}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 pr-3 font-semibold text-chalk-3">Pos</th>
                    {asc.map((y) => (
                      <th key={y} className="pb-2 pr-3 text-right font-semibold text-chalk-3">{y}</th>
                    ))}
                    <th className="pb-2 text-right font-semibold text-chalk-3">avg</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.g} className="border-t border-line">
                      <td className="display py-1.5 pr-3 text-xl font-bold text-chalk">{r.g}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="py-1.5 pr-3 text-right">
                          <span className="mono inline-block min-w-[2rem] rounded px-1.5 py-0.5 text-chalk" style={{ background: `rgba(47,122,58,${0.08 + (c / maxCell) * 0.5})` }}>{c}</span>
                        </td>
                      ))}
                      <td className="mono py-1.5 text-right font-semibold text-chalk">{r.avg.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-chalk-3">Darker green means more top-50 picks that year. The avg column is the demand the forecast uses.</p>
          </section>

          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="display text-3xl font-bold text-chalk">Pipeline schools, {asc[0]} to {latest}</h2>
              <ol className="mt-3 grid gap-1">
                {topColleges.map(([school, e], i) => (
                  <li key={school} className="flex items-center gap-3 text-sm">
                    <span className="mono w-6 text-right text-xs text-chalk-3">{i + 1}</span>
                    <Link href={`/radar?q=${encodeURIComponent(school)}`} className="display text-xl font-bold text-chalk hover:text-sky">{school}</Link>
                    <span className="mono ml-auto text-xs text-chalk-2">{e.picks} picks · {e.r1} R1</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-chalk-3">Tap a school to see who is on its radar this season.</p>
            </div>
            <div>
              <h2 className="display text-3xl font-bold text-chalk">By conference, five years</h2>
              <ol className="mt-3 grid gap-1">
                {topConfs.map(([conf, n], i) => (
                  <li key={conf} className="flex items-center gap-3 text-sm">
                    <span className="mono w-6 text-right text-xs text-chalk-3">{i + 1}</span>
                    <span className="display text-xl font-bold text-chalk">{conf}</span>
                    <span className="mono ml-auto text-xs text-chalk-2">{n} picks</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="display text-3xl font-bold text-chalk">Round 1, {histYear}</h2>
              <span className="seg">
                {years.map((y) => (
                  <Link key={y} href={`/draft?year=${y}${posFilter ? `&pos=${posFilter}` : ""}#round1`} aria-current={y === histYear}>{y}</Link>
                ))}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <ol id="round1" className="mt-3 grid gap-1 sm:grid-cols-2">
              {round1.map((p) => (
                <li key={p.overall} className="card flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="display w-8 text-3xl font-extrabold text-navy">{p.overall}</span>
                  <span className="min-w-0">
                    <span className="display block truncate text-xl font-bold text-chalk">{p.name}</span>
                    <span className="mono text-[11px] text-chalk-3">{GROUP[p.pos] ?? p.pos} · {p.college} · to {p.nfl}</span>
                  </span>
                  {p.grade && <span className="mono ml-auto text-xs text-chalk-3">grade {p.grade}</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function ForecastRow({ e, games, showPos = false }: { e: ForecastEntry; games: Map<string, Game>; showPos?: boolean }) {
  const p = e.player;
  const g = games.get(p.team);
  const team = g ? (g.home.short === p.team ? g.home : g.away) : undefined;
  return (
    <li className="card flex items-center gap-3 px-3 py-2.5">
      <span className="display w-8 shrink-0 text-right text-2xl font-extrabold text-navy">{showPos ? e.posRank : e.overall}</span>
      <Avatar jersey={p.jersey} color={team?.color ?? "#3b4658"} logo={team?.logo} size="sm" playerId={p.id} name={p.name} />
      <span className="min-w-0 flex-1">
        <Link href={`/player/${p.id}`} className="display block truncate text-xl font-bold text-chalk hover:text-sky">{p.name}</Link>
        <span className="mono text-[11px] text-chalk-3">
          {p.pos} · {p.team} · {p.cls}{p.height ? ` · ${Math.floor(p.height / 12)}-${p.height % 12}, ${p.weight}` : ""} · {GROUP_LABEL[p.group]} No. {e.posRank}
        </span>
        <span className="block truncate text-xs text-chalk-2">{p.stat}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="mono text-[11px] font-semibold text-navy">{pickText(e)}</span>
          {e.decision === "declared" && <span className="rounded bg-turf px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Declared</span>}
          {e.decision === "returning" && <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-chalk-3">Returning</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BAND_TONE[e.band]}`}>{e.band.replace(" range", "")}</span>
        <span className="mono text-xs text-chalk-3" title="radar score, then demand-adjusted">{p.score} · {e.adjusted}</span>
      </span>
    </li>
  );
}
