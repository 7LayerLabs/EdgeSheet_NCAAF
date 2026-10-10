import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { getGame } from "@/lib/slate";
import { COMPONENT_KEYS, COMPONENT_LABELS, WEIGHTS, availableWeight, prospectCounts, scoreTag, scoutScore } from "@/lib/score";
import { evaluateWeather } from "@/lib/weather";
import { axisLabel, componentPhrase } from "@/lib/stadiums";
import { baselineLine } from "@/lib/climate";
import { asOf, etDateOf, kickoffTime, mlText, moveText, spreadText } from "@/lib/format";
import type { DefenseProfile, Game, GameStatus, OffenseProfile, Prospect, Team } from "@/lib/types";
import { cardLineFor } from "@/lib/sheet";
import { readReport, seasonOf } from "@/lib/report";
import { lastPlaysFor, type LastPlay } from "@/lib/playerlog";
import { ProspectCard } from "@/components/ProspectCard";
import { LineMovement } from "@/components/LineMovement";
import { PropsForRadar } from "@/components/PropsForRadar";
import { LivePanel } from "@/components/LivePanel";
import { WrittenReport } from "@/components/WrittenReport";
import { ConsensusLine, ConsensusTable } from "@/components/ConsensusTable";
import { Suspense } from "react";
import { BeatFeed, BeatFeedFallback } from "@/components/BeatFeed";
import { AvailabilityNote } from "@/components/AvailabilityNote";
import { SituationalCues, SituationsTable } from "@/components/Situations";
import { WatchGuide } from "@/components/WatchGuide";
import { publishedGuide } from "@/lib/watchguide";
import { Section, Fold } from "@/components/Section";
import { JumpOpener } from "@/components/JumpOpener";
import { GameMore } from "@/components/GameMore";
import { GameHeader } from "@/components/GameHeader";
import { GradeCard } from "@/components/GradeCard";
import { Recap } from "@/components/Recap";
import { buildRecap } from "@/lib/recap";
import { PregameScorecard } from "@/components/PregameScorecard";
import * as S from "@/lib/summaries";
import { boardSummary, matchBoard } from "@/lib/matchboard";
import { MatchBoard } from "@/components/MatchBoard";

export const dynamic = "force-dynamic";

/** Title and description for shared links (iMessage, Telegram). The card image comes from opengraph-image.tsx next to this file. */
export async function generateMetadata({ params }: PageProps<"/game/[id]">): Promise<Metadata> {
  const { id } = await params;
  const game = await getGame(id).catch(() => undefined);
  if (!game) return { title: "Game not found, EdgeSheet" };
  const name = (t: Team) => `${t.rank ? `No. ${t.rank} ` : ""}${t.short}`;
  const title = `${name(game.away)} at ${name(game.home)}, ${kickoffTime(game.kickoff)} ET on ${game.network || "TV not listed"}`;
  const description = cardLineFor(seasonOf(game.kickoff), game.id) ?? game.whyWatch;
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary_large_image", title, description } };
}

/**
 * The primary sections per state, in order; they start open. The matchup board
 * ("decided") is primary in every state. Everything else goes into the collapsed
 * "More on this game" group, in MORE order.
 */
const PRIMARY: Record<GameStatus, string[]> = {
  upcoming: ["why", "decided", "radar", "market"],
  live: ["live", "decided", "radar", "why", "market"],
  final: ["grade", "decided", "radar", "why", "market"],
};

export default async function GamePage({ params }: PageProps<"/game/[id]">) {
  const { id } = await params;
  const game = await getGame(id);
  if (!game) notFound();
  const guide = publishedGuide(game);

  const status = game.status;
  // Finished Division I game: the full recap of every call against what happened (src/lib/recap.ts).
  const recap = status === "final" && (game.division === "FBS" || game.division === "FCS") ? await buildRecap(game).catch(() => undefined) : undefined;
  const primaryKeys = status === "final" && recap ? ["recap", "decided", "radar", "why", "market"] : PRIMARY[status];
  const isOpen = (key: string) => primaryKeys.includes(key);
  const score = scoutScore(game.scoreComponents);
  const tag = scoreTag(game);
  const flags = game.weather ? evaluateWeather(game.weather) : [];
  const { likely, future } = prospectCounts(game);
  const d1 = game.division === "FBS" || game.division === "FCS";
  const cachedReport = d1 ? readReport(seasonOf(game.kickoff), game.id) : undefined;
  const post = game.archive?.postgame;

  // Live Division I game: the newest play-by-play line naming each radar player, for the cards. Empty when ESPN has no summary.
  const lastPlays: Record<string, LastPlay> =
    game.status === "live" && d1 && game.prospects.length
      ? await lastPlaysFor(game.id, game.prospects.map((p) => p.id)).catch(() => ({}))
      : {};

  const byYear = new Map<number, Prospect[]>();
  for (const p of game.prospects) byYear.set(p.draftYear, [...(byYear.get(p.draftYear) ?? []), p]);
  const years = [...byYear.keys()].sort();

  /* ------------------------------------------------------------ sections */

  const why = (
    <Section key="why" n="Why watch" id="why" title={guide?.headline ?? game.whyWatch} summary={guide?.hook ?? S.whyWatchSummary(game)} defaultOpen={isOpen("why")}>
      {guide ? (
        <WatchGuide game={game} guide={guide} />
      ) : (
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {game.whyWatchReasons.map((r, i) => (
            <li key={i} className="card p-4 text-base leading-snug text-chalk-2">
              <span className="display block text-3xl font-bold text-flag">{i + 1}</span>
              <span className="mt-1 block">{r}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );

  const report = (
    <Section
      key="report"
      n="Written report"
      id="report"
      title={cachedReport?.report?.headline ?? (d1 ? "No report written yet" : "Reports are written for Division I games")}
      summary={S.reportSummary(cachedReport?.report?.headline, cachedReport?.report?.oneLineForCard)}
      defaultOpen={isOpen("report")}
    >
      <WrittenReport game={game} embedded />
    </Section>
  );

  const board = game.division === "FBS" ? matchBoard(game.away.short, game.home.short) : undefined;
  const decided = (
    <Section
      key="decided"
      n={status === "final" ? "What we called" : "Matchups"}
      id="decided"
      title={game.matchups.length ? (status === "final" ? "Where we said the game would be decided" : "Where the game gets decided") : "Not charted for this division"}
      summary={board ? [boardSummary(board), S.decidedSummary(game).split("; ").slice(1).join("; ")].filter(Boolean).join("; ") : S.decidedSummary(game)}
      defaultOpen={isOpen("decided")}
    >
      {game.matchups.length > 0 ? (
        <>
          <div className="card mt-3 border-l-4 border-l-navy p-5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="eyebrow">Pressure point</p>
              {post && <VerdictPill v={post.pressurePointVerdict} />}
            </div>
            {/* A graded game keeps the sentence its verdict was graded against. */}
            <p className="mt-2 text-lg leading-relaxed text-chalk">{post || !board ? game.pressurePoint : board.pressurePoint}</p>
          </div>
          {board && <MatchBoard board={board} away={game.away} home={game.home} />}
          <Fold label={post ? "The locked calls and how they graded" : "Model inputs: the four largest unit gaps"} className="mt-3">
            <div className="mt-2 grid gap-2">
              {game.matchups.map((m, i) => {
                const result = post?.edges.find((e) => e.a === m.a && e.b === m.b);
                const label = m.strength === "dominant" ? "Mismatch" : m.strength === "clear" ? "Clear edge" : m.strength === "real" ? "Edge" : "Even";
                return (
                  <div key={i} className="rounded border border-line bg-panel p-3 text-sm">
                    <p className="font-semibold text-chalk">
                      <span className="eyebrow mr-2">{label}</span>
                      {m.a} vs {m.b}
                    </p>
                    <p className="mono mt-1 text-[11px] text-chalk-3">{m.evidence}</p>
                    {result && (
                      <p className="mt-2 flex flex-wrap items-center gap-2">
                        <VerdictPill v={result.verdict} />
                        <span className="text-chalk-2">{result.actual}</span>
                      </p>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-chalk-3">The projection reads these four gaps. The board above is the cleaner read of the same team stats, by position group.</p>
            </div>
          </Fold>
          {game.situations && <SituationalCues cues={game.situations.cues} />}
          {game.projection && <ProjectionBox game={game} />}
        </>
      ) : (
        <>
          <p className="mt-2 text-base text-chalk-3">{game.pressurePoint}</p>
          {game.projection && <ProjectionBox game={game} />}
        </>
      )}
    </Section>
  );

  const radar = (
    <Section
      key="radar"
      n="Draft radar"
      id="radar"
      title={game.prospects.length ? (status === "upcoming" ? "Who NFL scouts are watching, by draft class" : status === "live" ? "Radar names and their lines so far" : "Radar names and what they did") : "Nobody clears the radar yet"}
      summary={S.radarSummary(game)}
      defaultOpen={isOpen("radar")}
    >
      {game.prospects.some((p) => p.radar) && (
        <p className="mt-1 max-w-3xl text-sm text-chalk-3">
          Radar entries rank evidence: season production against the division, recruiting pedigree, usage share, and NFL size norms. They are not draft grades.
          {game.statsAsOf ? ` Stats as of ${asOf(game.statsAsOf)}.` : ""}
        </p>
      )}
      {years.map((y) => (
        <div key={y} className="mt-5">
          <div className="flex items-baseline gap-3">
            <span className="display text-3xl font-bold text-chalk">{y} draft</span>
            <span className="mono text-xs text-chalk-3">{y === years[0] ? "this year" : y === years[0] + 1 ? "next year" : "the year after"}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-2 grid gap-2.5 md:grid-cols-2">
            {byYear.get(y)!.map((p) => (
              <ProspectCard key={p.id} p={p} team={p.team === game.home.abbr ? game.home : game.away} lastPlay={lastPlays[p.id]} grade={game.status !== "upcoming" ? { gameId: game.id, date: etDateOf(game.kickoff) } : undefined} note={<Suspense fallback={null}><AvailabilityNote schools={[game.away.short, game.home.short]} players={game.prospects.map((x) => ({ id: x.id, name: x.name, team: x.team === game.home.abbr ? game.home.short : game.away.short }))} playerId={p.id} /></Suspense>} />
            ))}
          </div>
        </div>
      ))}
      {game.odds && game.prospects.length > 0 && <PropsForRadar gameId={game.id} odds={game.odds} prospects={game.prospects} upcoming={status === "upcoming"} />}
      {game.prospects.length === 0 && (
        <p className="mt-2 text-sm text-chalk-3">No player on either roster clears the production, pedigree, or size thresholds. See Keep an eye on below.</p>
      )}
    </Section>
  );

  const eye = game.keepAnEyeOn.length > 0 && (
    <Section key="eye" n="Keep an eye on" id="eye" title="Sleepers, risers, and young players" summary={S.eyeSummary(game)} defaultOpen={isOpen("eye")}>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {game.keepAnEyeOn.map((k) => (
          <li key={k.name} className="card p-4">
            <span className="display text-2xl font-semibold text-chalk">{k.name}</span>
            <span className="mono ml-2 text-xs text-chalk-3">{k.team}</span>
            <p className="mt-1 text-base text-chalk-2">{k.note}</p>
          </li>
        ))}
      </ul>
    </Section>
  );

  const boxLeaders = game.box && (
    <>
      <div className="mt-3 grid gap-2.5 md:grid-cols-2">
        {game.box.teams.map((t) => (
          <div key={t.team} className="card p-4">
            <div className="flex items-baseline justify-between">
              <span className="display text-2xl font-bold text-chalk">{t.team}</span>
              {t.points !== null && <span className="display text-3xl font-extrabold text-flag">{t.points}</span>}
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
      <p className="mt-2 text-xs text-chalk-3">
        {game.box.source === "espn" ? "In-game box from the ESPN feed; the settled CollegeFootballData box replaces it after the final. " : ""}
        Radar players show their line from this game. Stock does not move automatically; one game is one data point.
      </p>
    </>
  );

  // Live: the feed first.
  const live = status === "live" && (
    <Section key="live" n="Live" id="live" title={game.live ? "Live from the feed" : "Box score arrives when the game settles"} summary={S.liveSummary(game)} defaultOpen={isOpen("live")} tone="live">
      <LivePanel game={game} />
      {boxLeaders}
      {!game.live && !game.box && <p className="mt-2 text-base text-chalk-3">The data feed posts player stats after the game settles. Check back in a few minutes.</p>}
    </Section>
  );

  const scorecard = status === "live" && (
    <Section key="scorecard" n="Pregame call" id="scorecard" title="How the call is holding up" summary={S.pregameCallSentence(game) ?? "No pregame call locked"} defaultOpen={isOpen("scorecard")}>
      <PregameScorecard game={game} />
    </Section>
  );

  // Final: grade card first, then who showed up.
  const grade = status === "final" && (
    <Section key="grade" n="Postgame" id="grade" title={game.score ? `${game.away.short} ${game.score.away}, ${game.home.short} ${game.score.home}` : "Final"} summary={game.archive?.pregame.projection && S.pregameCallSentence(game) ? `${S.pregameCallSentence(game)}.` : "No pregame call locked"} defaultOpen={isOpen("grade")} tone="final">
      <div className="mt-3">
        <GradeCard game={game} />
      </div>
    </Section>
  );

  const showed = status !== "live" && (
    <Section
      key="showed"
      n={status === "final" ? "Who showed up" : "Live"}
      id="showed"
      title={game.box ? "Who showed up" : status === "final" ? "Box score not published yet" : "Opens at kickoff"}
      summary={S.showedSummary(game)}
      defaultOpen={isOpen("showed")}
    >
      {status === "final" && <LivePanel game={game} />}
      {boxLeaders}
      {!game.box && (
        <p className="mt-2 text-base text-chalk-3">
          {status === "upcoming" ? "Box score leaders and each radar player's line appear here once the game starts." : "The data feed posts player stats after the game settles. Check back in a few minutes."}
        </p>
      )}
      {post && <Accountability entry={game.archive!} />}
      {status === "upcoming" && game.archive && (
        <p className="mono mt-3 text-xs text-chalk-3">
          Pregame call locked {asOf(game.archive.pregame.capturedAt)}: {game.archive.pregame.edges.length} matchup calls, {game.archive.pregame.prospects.length} radar names, Scout Score {game.archive.pregame.scoutScore}. It gets graded against the box score after the final. <Link href="/history" className="text-sky">See the record</Link>.
        </p>
      )}
    </Section>
  );

  const style = (
    <Section key="style" n="Team style" id="style" title={game.offense[game.home.abbr]?.sample === "unavailable" ? "Tendencies not charted for this division" : "How each side wants to play"} summary={S.styleSummary(game)} defaultOpen={isOpen("style")}>
      {game.statsAsOf && <p className="mono mt-1 text-xs text-chalk-3">Season stats as of {asOf(game.statsAsOf)}. Ranks are within the team&apos;s division.</p>}
      <div className="mt-3 grid gap-2.5 md:grid-cols-2">
        {[game.away, game.home].map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-4 w-1 rounded-sm" style={{ background: t.color }} />
              <span className="display text-2xl font-bold">{t.short}</span>
            </div>
            <StyleCard side="Offense" o={game.offense[t.abbr]} />
            <StyleCard side="Defense" d={game.defense[t.abbr]} />
          </div>
        ))}
      </div>
      {game.situations && <SituationsTable away={game.away} home={game.home} s={game.situations} />}
    </Section>
  );

  const conditions = (
    <Section key="conditions" n="Conditions" id="conditions" title={game.weather ? weatherHeadline(game) : "No forecast available"} summary={S.conditionsSummary(game)} defaultOpen={isOpen("conditions")}>
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
          {game.weather.roof === "open" && (
            <p className="mt-2 text-sm text-chalk-2">
              {game.weather.windMph > 0 ? `Wind ${game.weather.windDir} ${game.weather.windMph} mph` : "Calm"}
              {game.weather.windComponent && game.weather.fieldBearing != null
                ? `, ${componentPhrase(game.weather.windComponent)} (field runs ${axisLabel(game.weather.fieldBearing)}${game.weather.fieldBearingConfidence !== "high" ? ", from the stadium outline" : ""}).`
                : game.weather.fieldBearing != null
                  ? `. Field runs ${axisLabel(game.weather.fieldBearing)}.`
                  : ". Field orientation is not on file for this venue, so the crosswind call is unmeasured."}
            </p>
          )}
          {game.climate ? (
            <p className="mt-1 text-sm text-chalk-2">{baselineLine(game.climate, game.weather)}</p>
          ) : (
            d1 && <p className="mt-1 text-sm text-chalk-3">No weather baseline on file for this venue.</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {flags.length === 0 && <p className="card p-4 text-sm text-chalk-2">No weather flag. Conditions are not expected to change play calling.</p>}
            {flags.map((f) => (
              <div key={f.key} className={`card p-4 ${f.level === "elevated" ? "border-brick/60" : f.level === "flag" ? "border-warn/50" : ""}`}>
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
      {!game.weather && game.climate && <p className="mt-2 text-sm text-chalk-2">{baselineLine(game.climate)}</p>}
    </Section>
  );

  const market = (
    <Section key="market" n="Market" id="market" title={game.market.spread ? `${spreadText(game.market.spread.team, game.market.spread.line)}, total ${game.market.total?.line}` : "No widely available line"} summary={S.marketSummary(game)} defaultOpen={isOpen("market")}>
      {game.market.spread ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label="Consensus spread" value={spreadText(game.market.spread.team, game.market.spread.line)} sub={moveText(game.market.spread.open, game.market.spread.line)} />
          {game.market.total && <Stat label="Total" value={String(game.market.total.line)} sub={moveText(game.market.total.open, game.market.total.line)} />}
          {game.market.moneyline ? (
            <Stat label="Moneyline" value={`${game.home.abbr} ${mlText(game.market.moneyline.home)} / ${game.away.abbr} ${mlText(game.market.moneyline.away)}`} sub={`one book; ${game.market.books} ${game.market.books === 1 ? "book" : "books"} on the spread`} />
          ) : (
            <Stat label="Books" value={String(game.market.books)} sub="consensus median" />
          )}
          <p className="mono text-xs text-chalk-3 sm:col-span-3">As of {asOf(game.market.asOf)}. Shown as game context, not a pick.</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-chalk-3">No book we track lists this game. The report does not estimate a line.</p>
      )}
      {game.projection && (game.projection.vsMarket || game.projection.totalNote) && <ModelVsMarket game={game} />}
      {game.odds && <LineMovement odds={game.odds} home={game.home} away={game.away} />}
    </Section>
  );

  const storylines = (
    <Section key="storylines" n="Storylines" id="storylines" title="Context that changes how you watch" summary={S.storylinesSummary(game)} defaultOpen={isOpen("storylines")}>
      {game.storylines.length === 0 && <p className="mt-2 text-sm text-chalk-3">Nothing on file beyond the schedule.</p>}
      <ul className="mt-3 grid gap-1.5">
        {game.storylines.map((s) => (
          <li key={s} className="flex gap-3 text-sm text-chalk-2">
            <span className="text-flag">–</span>
            {s}
          </li>
        ))}
      </ul>
    </Section>
  );

  const feed = (
    <Section key="feed" n="Beat feed" id="feed" title={`What people are saying about ${game.away.short} and ${game.home.short}`} summary={S.feedSummary(game)} defaultOpen={isOpen("feed")}>
      <Suspense fallback={<BeatFeedFallback />}>
        <BeatFeed
          schools={[game.away.short, game.home.short]}
          players={game.prospects.map((p) => ({ id: p.id, name: p.name, team: p.team === game.home.abbr ? game.home.short : game.away.short, pos: p.pos }))}
        />
      </Suspense>
    </Section>
  );

  const scoreSec = (
    <Section key="score" n="Scout Score" id="score" title={`${score} out of 100`} summary={S.scoreSummary(game)} defaultOpen={isOpen("score")}>
      <div className="mt-3 grid gap-2">
        {COMPONENT_KEYS.map((k) => {
          const v = game.scoreComponents[k];
          return (
            <div key={k} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-xs sm:grid-cols-[12rem_1fr_3rem]">
              <span className={v === null ? "text-chalk-3" : "text-chalk-2"}>
                {COMPONENT_LABELS[k]} <span className="text-chalk-3">{Math.round(WEIGHTS[k] * 100)}%</span>
              </span>
              {v === null ? <span className="mono text-[10px] text-chalk-3">not available, excluded</span> : <div className="meter"><span style={{ width: `${v}%` }} /></div>}
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
  );

  const recapSection = recap ? (
    <Section key="recap" n="Recap" id="recap" title={recap.headline.split(". ")[0] + "."} summary={`${recap.score.right} of ${recap.score.right + recap.score.wrong + recap.score.mixed} calls right`} defaultOpen={isOpen("recap")} tone="final">
      <Recap recap={recap} game={game} />
    </Section>
  ) : null;

  /* ------------------------------------------------------------ order per state */

  const all =
    status === "live"
      ? [live, scorecard, radar, why, report, decided, eye, style, conditions, market, storylines, feed, scoreSec]
      : status === "final"
        ? [recapSection, grade, report, showed, decided, radar, why, eye, style, conditions, market, storylines, feed, scoreSec]
        : [why, report, decided, radar, eye, showed, style, conditions, market, storylines, feed, scoreSec];
  const present = all.filter((s): s is React.ReactElement => Boolean(s));
  const byKey = new Map(present.map((s) => [String(s.key), s]));
  const primary = primaryKeys.map((k) => byKey.get(k)).filter((s): s is React.ReactElement => Boolean(s));
  const rest = present.filter((s) => !primaryKeys.includes(String(s.key)));

  const LABELS: Record<string, string> = {
    recap: "Recap",
    why: "Why watch",
    report: "Report",
    decided: status === "final" ? "What we called" : "Matchups",
    radar: "Draft radar",
    eye: "Eye on",
    live: "Live",
    scorecard: "Pregame call",
    grade: "Grade card",
    showed: status === "upcoming" ? "Live" : "Who showed up",
    style: "Team style",
    conditions: "Conditions",
    market: "Market",
    storylines: "Storylines",
    feed: "Feed",
    score: "Score",
  };
  const jumps = primary.map((s) => String(s.key));

  return (
    <article className="rise">
      <JumpOpener />
      <Link href={game.source === "live" ? `/?date=${etDateOf(game.kickoff)}` : "/"} className="mono text-xs text-chalk-3 hover:text-chalk">← Slate</Link>

      <GameHeader game={game} score={score} tag={tag} likely={likely} future={future} />

      {game.gaps && game.gaps.length > 0 && (
        <Fold label={`Coverage ${game.coverage.toLowerCase()}: ${game.gaps.length} ${game.gaps.length === 1 ? "thing" : "things"} this report cannot say`} className="mt-4">
          <ul className="grid gap-1 text-sm text-chalk-2 sm:grid-cols-2">
            {game.gaps.map((g) => (
              <li key={g} className="flex gap-2"><span className="text-chalk-3">–</span>{g}</li>
            ))}
          </ul>
        </Fold>
      )}

      <nav className="jumpbar" aria-label="Sections">
        {jumps.map((k) => (
          <a key={k} href={`#${k}`}>{LABELS[k] ?? k}</a>
        ))}
        {rest.length > 0 && <a href="#more">More ({rest.length})</a>}
      </nav>

      {primary}

      {rest.length > 0 && <GameMore labels={rest.map((s) => LABELS[String(s.key)] ?? String(s.key))}>{rest}</GameMore>}
    </article>
  );
}

/* ---------------------------------------------------------------- bits */

function VerdictPill({ v }: { v: string }) {
  const tone =
    v === "played out" || v === "showed up" ? "bg-turf text-white" : v === "did not play out" || v === "quiet" ? "bg-brick text-white" : v === "mixed" ? "bg-warn text-chalk" : "bg-ink-2 text-chalk-3";
  return <span className={`inline-block w-fit rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{v}</span>;
}

function ModelVsMarket({ game }: { game: Game }) {
  const p = game.projection!;
  const sideTeam = p.modelSide ? (p.modelSide === game.home.abbr ? game.home : game.away) : undefined;
  const sideStrength = (p.sideGap ?? 0) >= 6 ? "strong" : (p.sideGap ?? 0) >= 3 ? "moderate" : (p.sideGap ?? 0) >= 2 ? "slight" : "none";
  const totalStrength = Math.abs(p.totalGap ?? 0) >= 6 ? "strong" : Math.abs(p.totalGap ?? 0) >= 4 ? "moderate" : Math.abs(p.totalGap ?? 0) >= 2.5 ? "slight" : "none";
  const tone = (s: string) => (s === "strong" ? "bg-brick text-white" : s === "moderate" ? "bg-navy text-white" : s === "slight" ? "bg-ink-2 text-chalk" : "bg-ink-2 text-chalk-3");
  const graded = game.archive?.postgame?.projectionResult;
  return (
    <div className="card mt-4 border-l-4 border-l-brick p-5">
      <p className="eyebrow">What the stats say against the posted numbers · a model, not a pick</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded border border-line bg-panel-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Side</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone(sideStrength)}`}>{sideStrength === "none" ? "no lean" : `${sideStrength} lean`}</span>
          </div>
          {sideTeam && game.market.spread ? (
            <>
              <p className="display mt-1 flex items-center gap-2 text-3xl font-bold text-chalk">
                <TeamMark team={sideTeam} state={sideStrength === "none" ? "even" : "win"} />
                {sideTeam.short}
                <span className="mono text-base font-normal text-chalk-3">{spreadText(game.market.spread.team, game.market.spread.line)}</span>
              </p>
              <p className="mt-1 text-base text-chalk">{p.vsMarket}</p>
              <ConsensusLine game={game} />
            </>
          ) : (
            <p className="mt-1 text-base text-chalk-3">No posted spread to compare.</p>
          )}
        </div>
        <div className="rounded border border-line bg-panel-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Total</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone(totalStrength)}`}>{p.totalLean && p.totalLean !== "none" ? `${totalStrength} ${p.totalLean}` : "no lean"}</span>
          </div>
          {p.modelTotal !== undefined && game.market.total ? (
            <>
              <p className="display mt-1 text-3xl font-bold text-chalk">
                {p.totalLean && p.totalLean !== "none" ? p.totalLean.toUpperCase() : "Even"} <span className="mono text-base font-normal text-chalk-3">model {p.modelTotal} · posted {game.market.total.line}</span>
              </p>
              <p className="mt-1 text-base text-chalk">{p.totalNote}</p>
              {p.weatherTilt && <p className="mt-1 text-sm text-chalk-2"><span className="eyebrow mr-1">Weather</span>{p.weatherTilt}</p>}
            </>
          ) : p.modelTotal !== undefined ? (
            <p className="mt-1 text-base text-chalk">Model total {p.modelTotal}. No posted total to compare.</p>
          ) : (
            <p className="mt-1 text-base text-chalk-3">Total needs tendency data for both teams.</p>
          )}
        </div>
      </div>
      {graded && (graded.totalLeanRight !== undefined || graded.modelSideCovered !== undefined) && (
        <p className="mt-3 text-sm text-chalk">
          <span className="eyebrow mr-1">Graded</span>
          {graded.modelSideCovered !== undefined && `Side ${graded.modelSideCovered ? "covered" : "did not cover"}. `}
          {graded.totalLeanRight !== undefined && `Total lean ${graded.totalLeanRight ? "right" : "wrong"}.`}
        </p>
      )}
      <Fold label="How this was computed" className="mt-3">
        <p className="text-xs text-chalk-3">
          Side comes from the projected margin (Elo and unit edges) against the spread. Total comes from each offense&apos;s EPA per play against the other defense, over both teams&apos; pace, plus a weather tilt when the forecast is flagged. A lean under 2 points is noise. Both are locked pregame and graded on the Record page.
        </p>
      </Fold>
    </div>
  );
}

/** Team logo chip. The side with the advantage is full color with a ring; the other side is shaded. */
function TeamMark({ team, state, size = "md" }: { team: Team; state: "win" | "lose" | "even"; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const ring = state === "win" ? "ring-2 ring-turf ring-offset-2 ring-offset-white" : state === "lose" ? "opacity-30 grayscale" : "";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white ${dim} ${ring}`} title={team.name}>
      {team.logo ? (
        <Image src={team.logo} alt={team.short} width={48} height={48} className="h-[82%] w-[82%] object-contain" unoptimized />
      ) : (
        <span className="display text-sm font-bold" style={{ color: team.color }}>{team.abbr}</span>
      )}
    </span>
  );
}

function ProjectionBox({ game }: { game: Game }) {
  const p = game.projection!;
  const winnerTeam = p.winner === game.home.abbr ? game.home : game.away;
  const graded = game.archive?.postgame?.projectionResult;
  const locked = game.archive?.pregame.projection;
  const final = game.status === "final" && game.score ? game.score : undefined;
  const actualWinner = final ? (final.home > final.away ? game.home : final.away > final.home ? game.away : undefined) : undefined;
  return (
    <div className="card mt-4 border-l-4 border-l-brick p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{final ? "Projected vs actual · a model, not a pick" : "Projected outcome · a model, not a pick"}</p>
          <div className={final ? "mt-2 grid gap-3 sm:grid-cols-2" : "mt-1"}>
            <div>
              {final && <p className="eyebrow text-chalk-3">Projected</p>}
              <p className="display flex flex-wrap items-center gap-x-3 text-3xl font-bold text-chalk sm:text-5xl">
                <TeamMark team={game.away} state={p.winner === game.away.abbr ? "win" : "lose"} size="lg" />
                <span>{game.away.short} {p.away}</span>
                <span className="text-chalk-3">@</span>
                <TeamMark team={game.home} state={p.winner === game.home.abbr ? "win" : "lose"} size="lg" />
                <span>{game.home.short} {p.home}</span>
              </p>
              <p className="mt-1 text-base text-chalk sm:text-lg">
                <span className="font-semibold" style={{ color: winnerTeam.color }}>{winnerTeam.short}</span> by {p.margin.toFixed(1)} · {Math.round(p.winProb * 100)}% to win · total {p.total}
              </p>
            </div>
            {final && (
              <div className="rounded border border-line bg-panel-2 p-3">
                <p className="eyebrow text-chalk-3">Actual</p>
                <p className="display flex flex-wrap items-center gap-x-3 text-3xl font-bold text-chalk sm:text-5xl">
                  <TeamMark team={game.away} state={actualWinner ? (actualWinner === game.away ? "win" : "lose") : "even"} size="lg" />
                  <span>{game.away.short} {final.away}</span>
                  <span className="text-chalk-3">@</span>
                  <TeamMark team={game.home} state={actualWinner ? (actualWinner === game.home ? "win" : "lose") : "even"} size="lg" />
                  <span>{game.home.short} {final.home}</span>
                </p>
                <p className="mt-1 text-base text-chalk sm:text-lg">
                  {actualWinner ? (
                    <>
                      <span className="font-semibold" style={{ color: actualWinner.color }}>{actualWinner.short}</span> by {Math.abs(final.home - final.away)} · total {final.home + final.away}
                    </>
                  ) : (
                    `Tied · total ${final.home + final.away}`
                  )}
                  {graded && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${graded.winnerRight ? "bg-turf text-white" : "bg-brick text-white"}`}>winner {graded.winnerRight ? "right" : "wrong"}, off by {graded.marginError.toFixed(0)}</span>}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="eyebrow">Confidence</p>
          <p className={`display text-3xl font-bold ${p.confidence === "high" ? "text-turf" : p.confidence === "medium" ? "text-chalk" : "text-chalk-3"}`}>{p.confidence}</p>
          <p className="text-[11px] text-chalk-3">{p.confidence === "high" ? "Elo and tendencies agree on inputs" : p.confidence === "medium" ? "Elo only; no tendency data" : "thin inputs"}</p>
        </div>
      </div>
      <p className="mt-3 text-base leading-relaxed text-chalk">{p.shape}</p>
      {p.vsMarket && (
        <p className="mt-2 rounded border border-line bg-panel-2 px-3 py-2 text-base text-chalk">
          <span className="eyebrow mr-1">vs the number</span>
          {p.vsMarket}
        </p>
      )}
      <ConsensusTable game={game} />
      <Fold label="How this was computed" className="mt-3">
        <ul className="mono grid gap-0.5 text-xs text-chalk-3">
          {p.basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-chalk-3">
          Margin is pregame Elo plus 40% of the unit-edge adjustment, with the market total for the score line. Win probability assumes a 16-point standard deviation.
          {locked && !graded && ` Locked ${asOf(game.archive!.pregame.capturedAt)}; graded after the final.`}
          {graded && ` Graded: winner ${graded.winnerRight ? "right" : "wrong"}, margin off by ${graded.marginError.toFixed(0)}${graded.modelSideCovered !== undefined ? `, model side ${graded.modelSideCovered ? "covered" : "did not cover"}` : ""}.`}
        </p>
      </Fold>
    </div>
  );
}

function Accountability({ entry }: { entry: NonNullable<Game["archive"]> }) {
  const post = entry.postgame!;
  const pre = entry.pregame;
  const graded = post.edges.filter((e) => e.edge !== "even" && e.verdict !== "unmeasured");
  const hits = graded.filter((e) => e.verdict === "played out").length;
  const pros = post.prospects.filter((p) => p.verdict !== "unmeasured");
  const showed = pros.filter((p) => p.verdict === "showed up").length;
  return (
    <div className="card mt-4 border-l-4 border-l-navy p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-3xl font-bold text-chalk">Did it play out?</h3>
        <span className="mono text-xs text-chalk-3">Call locked {asOf(pre.capturedAt)} · graded {asOf(post.capturedAt)}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {graded.length > 0 && <Stat label="Matchup calls" value={`${hits} of ${graded.length}`} sub="played out" />}
        {pros.length > 0 && <Stat label="Radar names" value={`${showed} of ${pros.length}`} sub="showed up" />}
        <Stat label="Pressure point" value={post.pressurePointVerdict} />
        <Stat label="Market" value={post.spreadResult ?? "no line"} sub={post.totalResult ? `total went ${post.totalResult}` : undefined} />
        {post.projectionResult && (
          <Stat
            label="Projection"
            value={post.projectionResult.winnerRight ? "winner right" : "winner wrong"}
            sub={`margin off by ${post.projectionResult.marginError.toFixed(0)}${post.projectionResult.modelSideCovered !== undefined ? ` · model side ${post.projectionResult.modelSideCovered ? "covered" : "lost"}` : ""}`}
          />
        )}
      </div>
      <ul className="mt-4 grid gap-2">
        {post.edges.map((e, i) => (
          <li key={i} className="grid gap-1 rounded border border-line bg-panel-2 p-3 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-3">
            <VerdictPill v={e.verdict} />
            <span>
              <span className="text-base font-semibold text-chalk">{e.a} vs {e.b}</span>
              <span className="block text-sm text-chalk-2">Called: advantage {e.edge}. Actual: {e.actual}.</span>
            </span>
          </li>
        ))}
        {post.prospects.map((p) => (
          <li key={p.id} className="grid gap-1 rounded border border-line bg-panel-2 p-3 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-3">
            <VerdictPill v={p.verdict} />
            <span>
              <Link href={`/player/${p.id}`} className="text-base font-semibold text-chalk hover:text-sky">{p.name}</Link>
              <span className="text-sm text-chalk-3"> {p.pos} · radar {p.score}</span>
              <span className="block text-sm text-chalk-2">{p.line}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-chalk-3">
        Scout Score was {pre.scoutScore}{post.excitement != null ? `; the feed's excitement index for the game was ${post.excitement.toFixed(1)}` : ""}. Every graded game goes into <Link href="/history" className="text-sky">the record</Link>, so the thresholds can be tuned against real results instead of opinion.
      </p>
    </div>
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
      {prof?.summary && <p className="mt-1 text-sm leading-snug text-chalk-2">{prof.summary}</p>}
      {metrics && metrics.length > 0 && (
        <dl className="mono mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 text-[13px]">
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
      {sample === "unavailable" && <p className="mt-1 text-xs text-chalk-3">Advanced tendencies are published for FBS and FCS only.</p>}
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
