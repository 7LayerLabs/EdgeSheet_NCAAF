import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import { getGame } from "@/lib/slate";
import { COMPONENT_KEYS, COMPONENT_LABELS, WEIGHTS, availableWeight, prospectCounts, scoreTag, scoutScore } from "@/lib/score";
import { evaluateWeather } from "@/lib/weather";
import { asOf, etDateOf, kickoffTime, mlText, moveText, spreadText } from "@/lib/format";
import type { DefenseProfile, Game, OffenseProfile, Prospect, Team } from "@/lib/types";
import { CoverageBadge, DivisionTag, StatusPill } from "@/components/badges";
import { ScoutScore } from "@/components/ScoutScore";
import { FollowButton } from "@/components/FollowButton";
import { ProspectCard } from "@/components/ProspectCard";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: PageProps<"/game/[id]">) {
  const { id } = await params;
  const game = await getGame(id);
  if (!game) notFound();

  const score = scoutScore(game.scoreComponents);
  const tag = scoreTag(game);
  const flags = game.weather ? evaluateWeather(game.weather) : [];
  const { likely, future } = prospectCounts(game);

  const byYear = new Map<number, Prospect[]>();
  for (const p of game.prospects) byYear.set(p.draftYear, [...(byYear.get(p.draftYear) ?? []), p]);
  const years = [...byYear.keys()].sort();

  return (
    <article className="rise">
      <Link href={game.source === "live" ? `/?date=${etDateOf(game.kickoff)}` : "/"} className="mono text-xs text-chalk-3 hover:text-chalk">← Slate</Link>

      {/* 1. Header */}
      <header className="mt-3 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DivisionTag d={game.division} />
            <span className="mono text-xs text-chalk-2">{kickoffTime(game.kickoff)} ET</span>
            <span className="text-xs text-chalk-3">{game.network}</span>
            <StatusPill status={game.status} clock={game.score?.clock} />
            <CoverageBadge level={game.coverage} />
          </div>
          <h1 className="display mt-2 text-4xl font-extrabold leading-none text-chalk sm:text-5xl">
            <TeamName t={game.away} score={game.score?.away} />
            <span className="mx-2 text-chalk-3 sm:mx-3">@</span>
            <TeamName t={game.home} score={game.score?.home} />
          </h1>
          <p className="mt-2 text-sm text-chalk-3">
            {game.venue} · {game.city}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FollowButton kind="games" id={game.id} />
            {game.source === "live" && (
              <>
                <FollowButton kind="teams" id={game.away.short} label={`Follow ${game.away.short}`} size="sm" />
                <FollowButton kind="teams" id={game.home.short} label={`Follow ${game.home.short}`} size="sm" />
              </>
            )}
            <span className="mono text-xs text-chalk-3">Report as of {asOf(game.reportAsOf)}</span>
          </div>
        </div>
        <div className="sm:w-48">
          <ScoutScore score={score} tag={tag} size="lg" />
          <p className="mt-2 text-xs text-chalk-3">
            {game.source === "live"
              ? likely + future === 0
                ? "Nobody clears the radar yet"
                : `${likely} draft-eligible on radar · ${future} future`
              : `${likely} likely ${likely === 1 ? "pick" : "picks"} · ${future} future ${future === 1 ? "name" : "names"}`}
          </p>
        </div>
      </header>

      {game.gaps && game.gaps.length > 0 && (
        <aside className="card mt-6 border-chalk-3/40 p-4">
          <p className="eyebrow">Coverage {game.coverage} · what this report cannot say</p>
          <ul className="mt-2 grid gap-1 text-sm text-chalk-2 sm:grid-cols-2">
            {game.gaps.map((g) => (
              <li key={g} className="flex gap-2"><span className="text-chalk-3">–</span>{g}</li>
            ))}
          </ul>
        </aside>
      )}

      {/* 2. Why watch */}
      <Section n="Why watch" title={game.whyWatch}>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {game.whyWatchReasons.map((r, i) => (
            <li key={i} className="card p-4 text-sm leading-snug text-chalk-2">
              <span className="display block text-2xl font-bold text-flag">{i + 1}</span>
              <span className="mt-1 block">{r}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* 3. Team style */}
      <Section n="Team style" title={game.offense[game.home.abbr]?.sample === "unavailable" ? "Tendencies not charted for this division" : "How each side wants to play"}>
        {game.statsAsOf && <p className="mono mt-1 text-xs text-chalk-3">Season stats as of {asOf(game.statsAsOf)}. Ranks are within the team&apos;s division.</p>}
        <div className="mt-3 grid gap-2.5 md:grid-cols-2">
          {[game.away, game.home].map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-4 w-1 rounded-sm" style={{ background: t.color }} />
                <span className="display text-xl font-bold">{t.short}</span>
              </div>
              <StyleCard side="Offense" o={game.offense[t.abbr]} />
              <StyleCard side="Defense" d={game.defense[t.abbr]} />
            </div>
          ))}
        </div>
        <div className="card mt-2.5 border-flag/30 p-4">
          <p className="eyebrow text-flag">Pressure point</p>
          <p className="mt-1 text-sm leading-relaxed text-chalk">{game.pressurePoint}</p>
        </div>
      </Section>

      {/* 4. Weather */}
      <Section n="Conditions" title={game.weather ? weatherHeadline(game) : "No forecast available"}>
        {game.weather && (
          <>
            <div className="mono mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-chalk-2">
              <span>{game.weather.tempF}° / feels {game.weather.feelsLikeF}°</span>
              <span>Wind {game.weather.windDir} {game.weather.windMph} mph, gusts {game.weather.gustMph}</span>
              <span>Rain {game.weather.precipChance}%{game.weather.precipWindow ? ` ${game.weather.precipWindow}` : ""}</span>
              <span>Humidity {game.weather.humidity}%</span>
              <span>{game.weather.surface === "grass" ? "Grass" : "Turf"} · {roofLabel(game.weather.roof)}</span>
              <span>{game.weather.elevationFt.toLocaleString()} ft</span>
              <span className="text-chalk-3">as of {asOf(game.weather.asOf)}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {flags.length === 0 && (
                <p className="card p-4 text-sm text-chalk-2">No weather flag. Conditions are not expected to change play calling.</p>
              )}
              {flags.map((f) => (
                <div
                  key={f.key}
                  className={`card p-4 ${f.level === "elevated" ? "border-brick/60" : f.level === "flag" ? "border-warn/50" : ""}`}
                >
                  <p className={`text-sm font-semibold ${f.level === "elevated" ? "text-brick" : f.level === "flag" ? "text-warn" : "text-chalk-2"}`}>
                    {f.level === "elevated" ? "▲ " : f.level === "flag" ? "△ " : ""}
                    {f.title}
                  </p>
                  <p className="mt-1 text-sm leading-snug text-chalk-2">{f.effect}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* 5. Market */}
      <Section n="Market" title={game.market.spread ? `${spreadText(game.market.spread.team, game.market.spread.line)}, total ${game.market.total?.line}` : "No widely available line"}>
        {game.market.spread ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Stat label="Consensus spread" value={spreadText(game.market.spread.team, game.market.spread.line)} sub={moveText(game.market.spread.open, game.market.spread.line)} />
            {game.market.total && <Stat label="Total" value={String(game.market.total.line)} sub={moveText(game.market.total.open, game.market.total.line)} />}
            {game.market.moneyline ? (
              <Stat label="Moneyline" value={`${game.home.abbr} ${mlText(game.market.moneyline.home)} / ${game.away.abbr} ${mlText(game.market.moneyline.away)}`} sub={`one book; ${game.market.books} ${game.market.books === 1 ? "book" : "books"} on the spread`} />
            ) : (
              <Stat label="Books" value={String(game.market.books)} sub="consensus median" />
            )}
            <p className="mono text-xs text-chalk-3 sm:col-span-3">
              As of {asOf(game.market.asOf)}. Shown as game context, not a pick.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-chalk-3">No book we track lists this game. The report does not estimate a line.</p>
        )}
      </Section>

      {/* 6. Prospects */}
      <Section n="Must watch" title={game.prospects.length ? "Who NFL scouts are watching, by draft class" : "Nobody clears the radar yet"}>
        {game.prospects.some((p) => p.radar) && (
          <p className="mt-1 max-w-3xl text-sm text-chalk-3">
            Radar entries rank evidence: season production against the division, recruiting pedigree, usage share, and NFL size norms. They are not draft grades.
            {game.statsAsOf ? ` Stats as of ${asOf(game.statsAsOf)}.` : ""}
          </p>
        )}
        {years.map((y) => (
          <div key={y} className="mt-5">
            <div className="flex items-baseline gap-3">
              <span className="display text-2xl font-bold text-chalk">{y} draft</span>
              <span className="mono text-xs text-chalk-3">{y === years[0] ? "this year" : y === years[0] + 1 ? "next year" : "the year after"}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-2 grid gap-2.5 md:grid-cols-2">
              {byYear.get(y)!.map((p) => (
                <ProspectCard key={p.id} p={p} team={p.team === game.home.abbr ? game.home : game.away} />
              ))}
            </div>
          </div>
        ))}
        {game.prospects.length === 0 && (
          <p className="mt-2 text-sm text-chalk-3">No player on either roster clears the production, pedigree, or size thresholds. See Keep an eye on below.</p>
        )}
      </Section>

      {/* 7. Matchups */}
      {game.matchups.length > 0 && (
        <Section n="Matchups" title="Who tests whom">
          <div className="mt-3 grid gap-2">
            {game.matchups.map((m, i) => (
              <div key={i} className={`card grid gap-2 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center ${m.edge === "offense" ? "border-flag/40" : m.edge === "defense" ? "border-sky/40" : ""}`}>
                <span className={`display text-xl font-semibold ${m.edge === "offense" ? "text-flag" : "text-chalk"}`}>{m.a}</span>
                <span className="mono text-center text-xs text-chalk-3">{m.edge === "even" ? "EVEN" : "VS"}</span>
                <span className={`display text-xl font-semibold sm:text-right ${m.edge === "defense" ? "text-sky" : "text-chalk"}`}>{m.b}</span>
                <p className="text-sm text-chalk-2 sm:col-span-3">{m.why}</p>
                <p className="mono text-xs text-chalk-3 sm:col-span-3">Evidence: {m.evidence}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 8. Keep an eye on */}
      {game.keepAnEyeOn.length > 0 && (
        <Section n="Keep an eye on" title="Sleepers, risers, and young players">
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {game.keepAnEyeOn.map((k) => (
              <li key={k.name} className="card p-4">
                <span className="display text-xl font-semibold text-chalk">{k.name}</span>
                <span className="mono ml-2 text-xs text-chalk-3">{k.team}</span>
                <p className="mt-1 text-sm text-chalk-2">{k.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 9. Storylines */}
      <Section n="Storylines" title="Context that changes how you watch">
        {game.storylines.length === 0 && <p className="mt-2 text-sm text-chalk-3">Nothing on file beyond the schedule.</p>}
        <ul className="mt-3 grid gap-1.5">
          {game.storylines.map((s) => (
            <li key={s} className="flex gap-3 text-sm text-chalk-2">
              <span className="text-flag">—</span>
              {s}
            </li>
          ))}
        </ul>
      </Section>

      {/* 10. Live / postgame */}
      <Section
        n={game.status === "final" ? "Postgame" : "Live"}
        title={game.box ? "Who showed up" : game.status === "final" ? "Box score not published yet" : game.status === "live" ? "Box score arrives when the game settles" : "Opens at kickoff"}
      >
        {game.box ? (
          <>
            <div className="mt-3 grid gap-2.5 md:grid-cols-2">
              {game.box.teams.map((t) => (
                <div key={t.team} className="card p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="display text-xl font-bold text-chalk">{t.team}</span>
                    {t.points !== null && <span className="display text-2xl font-extrabold text-flag">{t.points}</span>}
                  </div>
                  <ul className="mt-2 grid gap-1.5">
                    {t.leaders.map((l) => (
                      <li key={l.id + l.category} className="flex items-baseline gap-2 text-sm">
                        <span className="mono w-16 shrink-0 text-[10px] uppercase tracking-wider text-chalk-3">{l.category === "interceptions" ? "INT" : l.category.slice(0, 7)}</span>
                        <Link href={`/player/${l.id}`} className="font-medium text-chalk hover:text-flag">{l.name}</Link>
                        <span className="mono truncate text-xs text-chalk-2">{l.headline}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-chalk-3">Radar players above show their line from this game. Stock does not move automatically; one game is one data point.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-chalk-3">
            {game.status === "upcoming"
              ? "Box score leaders and each radar player's line appear here once the game starts."
              : "The data feed posts player stats after the game settles. Check back in a few minutes."}
          </p>
        )}
      </Section>

      {/* Score breakdown */}
      <Section n="Scout Score" title={`${score} out of 100`}>
        <div className="mt-3 grid gap-2">
          {COMPONENT_KEYS.map((k) => {
            const v = game.scoreComponents[k];
            return (
              <div key={k} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-xs sm:grid-cols-[12rem_1fr_3rem]">
                <span className={v === null ? "text-chalk-3" : "text-chalk-2"}>
                  {COMPONENT_LABELS[k]} <span className="text-chalk-3">{Math.round(WEIGHTS[k] * 100)}%</span>
                </span>
                {v === null ? (
                  <span className="mono text-[10px] text-chalk-3">not available, excluded</span>
                ) : (
                  <div className="meter"><span style={{ width: `${v}%` }} /></div>
                )}
                <span className="mono text-right text-chalk">{v === null ? "–" : v}</span>
              </div>
            );
          })}
          <p className="mt-1 text-xs text-chalk-3">
            Ranks viewing value, not team quality. Weather adjusts matchup interest but never adds points on its own.
            {availableWeight(game.scoreComponents) < 0.999 && ` Scored on ${Math.round(availableWeight(game.scoreComponents) * 100)}% of the weights; excluded inputs are not ingested yet.`}
          </p>
        </div>
      </Section>
    </article>
  );
}

/* ---------------------------------------------------------------- bits */

function TeamName({ t, score }: { t: Team; score?: number }) {
  const hasScore = score !== undefined && Number.isFinite(score);
  return (
    <span className="inline-flex items-baseline gap-2">
      {t.logo && <Image src={t.logo} alt="" width={40} height={40} className="h-8 w-8 self-center object-contain sm:h-10 sm:w-10" unoptimized />}
      {t.rank && <span className="text-2xl text-flag sm:text-3xl" title={t.rankPoll}>{t.rank}</span>}
      <span style={{ color: "var(--chalk)" }}>{t.short}</span>
      {hasScore && <span className="text-flag">{score}</span>}
    </span>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <p className="eyebrow">{n}</p>
      <h2 className="display mt-1 text-2xl font-bold leading-tight text-chalk sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mono mt-1 text-xl text-sky">{value}</p>
      {sub && <p className="mono mt-0.5 text-xs text-chalk-3">{sub}</p>}
    </div>
  );
}

function StyleCard({ side, o, d }: { side: string; o?: OffenseProfile; d?: DefenseProfile }) {
  const prof = o ?? d;
  const label = prof?.label ?? "Unavailable";
  const sample = prof?.sample ?? "unavailable";
  const metrics = prof?.metrics;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{side}</p>
        {sample === "small" && <span className="mono text-[10px] text-flag-2">small sample</span>}
        {sample === "unavailable" && <span className="mono text-[10px] text-chalk-3">no charting</span>}
      </div>
      <p className="mt-0.5 text-base font-semibold text-chalk">{label}</p>
      {prof?.summary && <p className="mt-1 text-xs leading-snug text-chalk-2">{prof.summary}</p>}
      {metrics && metrics.length > 0 && (
        <dl className="mono mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 text-[11px]">
          {metrics.filter((m) => ["passRate", "sr", "ex", "rushSr", "passEx", "ly", "havoc", "pdSr"].includes(m.key)).map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}
        </dl>
      )}
      {sample !== "unavailable" && !metrics && o && (
        <dl className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-chalk-2">
          <Row k="Pass rate" v={`${o.passRate}% (${o.neutralPassRate}% neutral)`} />
          <Row k="Pace" v={`${o.secondsPerPlay}s per play`} />
          <Row k="Structure" v={o.structure ?? ""} />
          <Row k="Run game" v={o.runGame ?? ""} />
          <Row k="Pass game" v={o.passGame ?? ""} />
          <Row k="Success / explosive" v={`${o.successRate}% / ${o.explosiveRate}%`} />
          <Row k="Pressure allowed" v={`${o.pressureAllowed}%`} />
        </dl>
      )}
      {sample !== "unavailable" && !metrics && d && (
        <dl className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-chalk-2">
          <Row k="Front" v={d.front ?? ""} />
          <Row k="Coverage" v={d.coverage ?? ""} />
          <Row k="Blitz / pressure" v={`${d.blitzRate}% / ${d.pressureRate}%`} />
          <Row k="Stuff rate" v={`${d.stuffRate}%`} />
          <Row k="Explosives allowed" v={`${d.explosivesAllowed}%`} />
        </dl>
      )}
      {sample === "unavailable" && (
        <p className="mt-1 text-xs text-chalk-3">Advanced tendencies are published for FBS and FCS only.</p>
      )}
    </div>
  );
}

function MetricRow({ m }: { m: NonNullable<OffenseProfile["metrics"]>[number] }) {
  const pct = m.pct;
  const tone = pct === undefined ? "text-chalk-2" : pct >= 75 ? "text-turf" : pct <= 25 ? "text-brick" : "text-chalk-2";
  return (
    <>
      <dt className="text-chalk-3">{m.label}</dt>
      <dd className={`text-right ${tone}`}>{m.value}</dd>
      <dd className="w-14 text-right text-chalk-3">{m.rank ? `No. ${m.rank}` : ""}</dd>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-chalk-3">{k}</dt>
      <dd className="text-chalk-2">{v}</dd>
    </>
  );
}

function weatherHeadline(g: Game) {
  const flags = evaluateWeather(g.weather!);
  const top = flags.find((f) => f.level === "elevated") ?? flags.find((f) => f.level === "flag") ?? flags[0];
  return top ? top.title : `${g.weather!.tempF}°, calm`;
}

function roofLabel(r: NonNullable<Game["weather"]>["roof"]) {
  return r === "open" ? "open air" : r === "fixed" ? "fixed roof" : r === "retractable-closed" ? "roof closed" : "retractable, status unknown";
}
