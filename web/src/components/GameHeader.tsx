import Image from "next/image";
import type { Game, Team } from "@/lib/types";
import type { ScoreTag } from "@/lib/score";
import { asOf, kickoffTime } from "@/lib/format";
import { CoverageBadge, DivisionTag, StatusPill } from "./badges";
import { ScoutScore } from "./ScoutScore";
import { FollowButton } from "./FollowButton";
import { LivePoller } from "./LivePoller";
import { ShareButton } from "./ShareButton";

/**
 * Game page header in three states. On phones everything fits one screen:
 * a two-row scoreboard, one meta line, the Scout Score as an inline badge,
 * and follow buttons as short chips. Desktop keeps the big display line and
 * the Scout Score block on the right.
 */
export function GameHeader({ game, score, tag, likely, future }: { game: Game; score: number; tag: ScoreTag; likely: number; future: number }) {
  const live = game.status === "live";
  const final = game.status === "final";
  const l = game.live;
  const situation = live && l ? [l.possession ? `${l.possession} ball` : "", l.downDistance ?? ""].filter(Boolean).join(", ") : "";
  const winner = final && game.score ? (game.score.home > game.score.away ? game.home.abbr : game.score.away > game.score.home ? game.away.abbr : undefined) : undefined;
  const radarLine =
    game.source === "live"
      ? likely + future === 0
        ? "Nobody clears the radar yet"
        : `${likely} draft-eligible on radar · ${future} future`
      : `${likely} likely ${likely === 1 ? "pick" : "picks"} · ${future} future ${future === 1 ? "name" : "names"}`;

  return (
    <header className={`mt-3 ${final ? "rounded border-l-4 border-brick pl-3 sm:pl-4" : live ? "rounded border-l-4 border-turf pl-3 sm:pl-4" : ""}`}>
      {/* Meta line: division, kickoff, network, status. One line on phones. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <DivisionTag d={game.division} />
        <span className="mono text-chalk-2">{kickoffTime(game.kickoff)} ET</span>
        {game.network && <span className="text-chalk-3">{game.network}</span>}
        <StatusPill status={game.status} clock={game.score?.clock} />
        <LivePoller active={live} />
        <span className="hidden sm:inline"><CoverageBadge level={game.coverage} /></span>
      </div>

      <div className="mt-2 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0">
          {/* Phone scoreboard: one row per team, score on the right. */}
          <div className="grid gap-1 sm:hidden">
            <ScoreRow t={game.away} score={game.score?.away} dim={winner !== undefined && winner !== game.away.abbr} live={live} />
            <ScoreRow t={game.home} score={game.score?.home} dim={winner !== undefined && winner !== game.home.abbr} live={live} home />
          </div>
          {/* Desktop display line. */}
          <h1 className="display hidden text-5xl font-extrabold leading-none text-chalk sm:block sm:text-6xl">
            <TeamName t={game.away} score={game.score?.away} dim={winner !== undefined && winner !== game.away.abbr} />
            <span className="mx-3 text-chalk-3">@</span>
            <TeamName t={game.home} score={game.score?.home} dim={winner !== undefined && winner !== game.home.abbr} />
          </h1>

          {situation && (
            <p className="mt-1.5 text-sm font-semibold text-turf">
              {situation}
              {l?.lastPlay && <span className="ml-2 font-normal text-chalk-2">{l.lastPlay}</span>}
            </p>
          )}
          <p className="mt-1.5 truncate text-sm text-chalk-3">
            {game.venue} · {game.city}
            <span className="hidden sm:inline"> · report as of {asOf(game.reportAsOf)}</span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-2">
            <span className="chip sm:hidden" style={{ padding: "4px 10px" }} title={`Scout Score ${score}, ${tag}`}>
              <span className="eyebrow">Scout</span>
              <span className={`display text-lg leading-none ${tag === "Hidden Gem" ? "text-turf" : "text-flag"}`}>{score}</span>
              <span className="text-xs text-chalk-3">{tag}</span>
            </span>
            <FollowButton kind="games" id={game.id} label="Watch" size="sm" />
            <ShareButton title={`${game.away.short} at ${game.home.short}`} text={game.whyWatch} />
            {game.source === "live" && (
              <>
                <FollowButton kind="teams" id={game.away.short} label={game.away.abbr} size="sm" />
                <FollowButton kind="teams" id={game.home.short} label={game.home.abbr} size="sm" />
              </>
            )}
            <span className="sm:hidden"><CoverageBadge level={game.coverage} /></span>
          </div>
        </div>
        <div className="hidden sm:block sm:w-48">
          <ScoutScore score={score} tag={tag} size="lg" />
          <p className="mt-2 text-xs text-chalk-3">{radarLine}</p>
        </div>
      </div>
    </header>
  );
}

function ScoreRow({ t, score, dim, live, home }: { t: Team; score?: number; dim: boolean; live: boolean; home?: boolean }) {
  const has = score !== undefined && Number.isFinite(score);
  return (
    <div className={`flex items-center gap-2.5 ${dim ? "opacity-60" : ""}`}>
      {t.logo ? <Image src={t.logo} alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" unoptimized /> : <span className="h-8 w-8 shrink-0 rounded-full" style={{ background: t.color }} />}
      <span className="display flex min-w-0 flex-1 items-baseline gap-1.5 text-3xl font-extrabold leading-none text-chalk">
        {t.rank && <span className="text-lg text-flag-2">{t.rank}</span>}
        <span className="truncate">{t.short}</span>
        <span className="mono text-[10px] font-normal text-chalk-3">{home ? "home" : "away"}</span>
      </span>
      {has && <span className={`display text-3xl font-extrabold leading-none ${live ? "text-turf" : "text-flag"}`}>{score}</span>}
    </div>
  );
}

function TeamName({ t, score, dim }: { t: Team; score?: number; dim: boolean }) {
  const hasScore = score !== undefined && Number.isFinite(score);
  return (
    <span className={`inline-flex items-baseline gap-2 ${dim ? "opacity-60" : ""}`}>
      {t.logo && <Image src={t.logo} alt="" width={40} height={40} className="h-10 w-10 self-center object-contain" unoptimized />}
      {t.rank && (
        <span className="text-3xl text-flag" title={t.rankPoll}>
          {t.rankPoll && !/^AP/i.test(t.rankPoll) && <span className="mono mr-1 text-xs uppercase tracking-wider text-chalk-3">{t.rankPoll.includes("FCS") ? "FCS" : "poll"}</span>}
          {t.rank}
        </span>
      )}
      <span style={{ color: "var(--chalk)" }}>{t.short}</span>
      {hasScore && <span className="text-flag">{score}</span>}
    </span>
  );
}
