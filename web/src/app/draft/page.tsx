import Link from "next/link";
import { genDraft, generatedLoaded } from "@/lib/generated";

export const dynamic = "force-dynamic";

/** Group CFBD's long position names into the radar's groups. */
const GROUP: Record<string, string> = {
  Quarterback: "QB", "Running Back": "RB", "Wide Receiver": "WR", "Tight End": "TE",
  "Offensive Tackle": "OT", "Offensive Guard": "IOL", Center: "IOL",
  "Defensive Edge": "EDGE", "Defensive Tackle": "DT", "Defensive End": "EDGE", Linebacker: "LB",
  Cornerback: "CB", Safety: "S", "Place Kicker": "K", Punter: "P", "Long Snapper": "LS",
};

export default function DraftPage() {
  const picks = genDraft();
  const loaded = generatedLoaded() && picks.length > 0;
  const years = [...new Set(picks.map((p) => p.year))].sort((a, b) => b - a);
  const latest = years[0];

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
  const latestMap = byYearGroup.get(latest) ?? new Map();
  const prevMap = byYearGroup.get(years[1]) ?? new Map();
  const ranked = groups
    .map((g) => ({ g, ...(latestMap.get(g) ?? { all: 0, r1: 0, top50: 0 }), prev: prevMap.get(g)?.top50 ?? 0 }))
    .sort((a, b) => b.top50 - a.top50 || b.all - a.all);
  const maxTop50 = Math.max(1, ...ranked.map((r) => r.top50));

  const colleges = new Map<string, { picks: number; r1: number; conf: string | null }>();
  for (const p of picks.filter((x) => x.year === latest)) {
    const e = colleges.get(p.college) ?? colleges.set(p.college, { picks: 0, r1: 0, conf: p.conf }).get(p.college)!;
    e.picks++;
    if (p.round === 1) e.r1++;
  }
  const topColleges = [...colleges].sort((a, b) => b[1].picks - a[1].picks || b[1].r1 - a[1].r1).slice(0, 15);

  const confs = new Map<string, number>();
  for (const p of picks.filter((x) => x.year === latest)) confs.set(p.conf ?? "Other", (confs.get(p.conf ?? "Other") ?? 0) + 1);
  const topConfs = [...confs].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const round1 = picks.filter((p) => p.year === latest && p.round === 1).sort((a, b) => a.overall - b.overall);

  return (
    <div>
      <p className="eyebrow">What scouts went after</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">{loaded ? `${latest} NFL Draft` : "NFL Draft"}</h1>
      <p className="mt-2 max-w-3xl text-sm text-chalk-3">
        The last three drafts, by position and by school. This is the demand side of the radar: where NFL teams actually spent picks, so you know which positions and which pipelines to watch on Saturdays.
      </p>

      {!loaded && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-2xl text-chalk">Draft history needs ingested data</p>
          <p className="mt-1 text-sm text-chalk-3">Run <code className="mono">npm run ingest</code> inside web/.</p>
        </div>
      )}

      {loaded && (
        <>
          <section className="mt-8">
            <div className="flex items-baseline gap-3">
              <h2 className="display text-2xl font-bold text-chalk">Positions in the top 50</h2>
              <span className="mono text-xs text-chalk-3">{latest} vs {years[1]}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-3 grid gap-1.5">
              {ranked.map((r) => {
                const delta = r.top50 - r.prev;
                return (
                  <div key={r.g} className="grid grid-cols-[3rem_1fr_7.5rem] items-center gap-3 text-sm sm:grid-cols-[3.5rem_1fr_9rem_6.5rem]">
                    <span className="display text-2xl font-bold text-chalk">{r.g}</span>
                    <div className="meter !h-3"><span style={{ width: `${(r.top50 / maxTop50) * 100}%` }} /></div>
                    <span className="mono whitespace-nowrap text-right text-xs text-chalk-2">{r.top50} top-50 · {r.r1} R1</span>
                    <span className={`mono hidden text-right text-xs sm:block ${delta > 0 ? "text-turf" : delta < 0 ? "text-brick" : "text-chalk-3"}`}>
                      {delta > 0 ? `+${delta}` : delta === 0 ? "even" : delta} vs {years[1]}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-chalk-3">Top-50 picks are where scouting departments spend the most time. Edge, tackle, corner, and receiver are the premium groups; a rise here is where to point your Saturday attention.</p>
          </section>

          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="display text-2xl font-bold text-chalk">Pipeline schools, {latest}</h2>
              <ol className="mt-3 grid gap-1">
                {topColleges.map(([school, e], i) => (
                  <li key={school} className="flex items-center gap-3 text-sm">
                    <span className="mono w-6 text-right text-xs text-chalk-3">{i + 1}</span>
                    <Link href={`/radar?q=${encodeURIComponent(school)}`} className="display text-lg font-semibold text-chalk hover:text-flag">{school}</Link>
                    <span className="mono ml-auto text-xs text-chalk-2">{e.picks} picks · {e.r1} R1</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-chalk-3">Tap a school to see who is on its radar this season.</p>
            </div>
            <div>
              <h2 className="display text-2xl font-bold text-chalk">By conference, {latest}</h2>
              <ol className="mt-3 grid gap-1">
                {topConfs.map(([conf, n], i) => (
                  <li key={conf} className="flex items-center gap-3 text-sm">
                    <span className="mono w-6 text-right text-xs text-chalk-3">{i + 1}</span>
                    <span className="display text-lg font-semibold text-chalk">{conf}</span>
                    <span className="mono ml-auto text-xs text-chalk-2">{n} picks</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-baseline gap-3">
              <h2 className="display text-2xl font-bold text-chalk">Round 1, {latest}</h2>
              <span className="h-px flex-1 bg-line" />
            </div>
            <ol className="mt-3 grid gap-1 sm:grid-cols-2">
              {round1.map((p) => (
                <li key={p.overall} className="card flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="display w-8 text-2xl font-extrabold text-flag">{p.overall}</span>
                  <span className="min-w-0">
                    <span className="display block truncate text-lg font-semibold text-chalk">{p.name}</span>
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
