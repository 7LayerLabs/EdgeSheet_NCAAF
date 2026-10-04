import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayer } from "@/lib/slate";
import { asOf, kickoffTime } from "@/lib/format";
import { genMeta } from "@/lib/generated";
import { GROUP_LABEL } from "@/lib/radar";
import { Confidence, Tier } from "@/components/badges";
import { FollowButton } from "@/components/FollowButton";
import { Avatar } from "@/components/Avatar";
import { RadarScore } from "@/components/ProspectCard";
import { DecisionButtons } from "@/components/DecisionButtons";
import { entryFor, pickText } from "@/lib/forecast";
import { decisionFor } from "@/lib/declarations";
import { Suspense } from "react";
import { PlayerNews } from "@/components/PlayerNews";
import { BeatFeedFallback } from "@/components/BeatFeed";
import { GradeWidget } from "@/components/GradeWidget";
import { etDateOf } from "@/lib/format";
import { GameLog, StockPanel } from "@/components/Movement";
import { DeltaArrow } from "@/components/MovementBits";
import { PlayerGameLog } from "@/components/PlayerGameLog";
import { LivePoller } from "@/components/LivePoller";
import { playerLog } from "@/lib/playerlog";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: PageProps<"/player/[id]">) {
  const { id } = await params;
  const hit = await getPlayer(id);
  if (!hit) notFound();
  const { player: p, game } = hit;
  const team = game ? (p.team === game.home.abbr ? game.home : game.away) : undefined;
  const r = p.radar;
  // Play-by-play log for this week's game once it has kicked off (Division I only, ESPN summary).
  const log = game && game.status !== "upcoming" && (game.division === "FBS" || game.division === "FCS") ? await playerLog(game.id, p.id).catch(() => undefined) : undefined;
  const meta = genMeta();
  const upper = r?.classYear === 3 || r?.classYear === 4;
  const fc = r && upper ? entryFor(r.id) : undefined;
  const decision = r ? decisionFor(r.id) : "undecided";

  return (
    <article className="rise">
      {game ? (
        <Link href={`/game/${game.id}`} className="mono text-xs text-chalk-3 hover:text-chalk">
          ← {game.away.short} @ {game.home.short}
        </Link>
      ) : (
        <Link href="/radar" className="mono text-xs text-chalk-3 hover:text-chalk">← Radar</Link>
      )}

      <header className="mt-3 flex items-start gap-4">
        <Avatar jersey={p.jersey} color={team?.color ?? "#3a4957"} logo={team?.logo} size="lg" playerId={p.id} name={p.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-chalk-2">{team?.name ?? r?.team ?? p.team}</span>
            <Tier tier={p.tier} />
          </div>
          <h1 className="display mt-1 text-5xl font-extrabold leading-none text-chalk sm:text-6xl">{p.name}</h1>
          <p className="mono mt-2 text-sm text-chalk-3">
            {p.pos}{r ? ` (${GROUP_LABEL[r.group]})` : ""} · {p.cls}{p.ht ? ` · ${p.ht}, ${p.wt} lb` : ""}{r?.hometown ? ` · ${r.hometown}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FollowButton kind="players" id={p.id} />
            {r && <span className="mono text-xs text-chalk-3">Stats as of {asOf(meta?.ingestedAt ?? new Date().toISOString())}</span>}
          </div>
        </div>
        {r && (
          <div className="text-right">
            <RadarScore score={r.score} size="lg" />
            <p className="eyebrow mt-1">Radar score <DeltaArrow delta={r.delta} size="lg" /></p>
          </div>
        )}
      </header>

      <section className="mt-8 grid gap-2 sm:grid-cols-3">
        <Box label="Draft class">
          <span className="display text-4xl font-bold text-chalk">{p.draftYear}</span>
          <Confidence level={p.eligibilityConfidence} />
          {r && <span className="text-xs text-chalk-3">{r.eligibilityNote}</span>}
        </Box>
        <Box label={r ? "Evidence strength" : "Projected range"}>
          <span className="text-lg font-semibold text-chalk">{r ? `${r.tier === "Eligible" ? "Draft-eligible" : r.tier} radar` : p.projected}</span>
          <Confidence level={p.projectionConfidence} />
          {r && <span className="text-xs text-chalk-3">Not a draft grade. Ranks production, pedigree, usage, and size.</span>}
        </Box>
        <Box label="Pedigree">
          {r?.stars ? (
            <>
              <span className="display text-4xl font-bold text-warn">{"★".repeat(r.stars)}</span>
              <span className="text-xs text-chalk-3">{r.recruitRank ? `No. ${r.recruitRank} recruit nationally` : "Rated recruit"}</span>
            </>
          ) : (
            <>
              <span className="display text-4xl font-bold text-chalk-3">–</span>
              <span className="text-xs text-chalk-3">No recruiting rating on file</span>
            </>
          )}
        </Box>
      </section>

      {r && upper && (
        <section className="card mt-8 border-l-4 border-l-navy p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{r.draftClass} draft forecast</p>
              {fc ? (
                <>
                  <p className="display mt-1 text-3xl font-bold text-chalk">{fc.band}</p>
                  <p className="mono text-sm text-navy">{pickText(fc)} · {r.group} No. {fc.posRank} · overall No. {fc.overall}</p>
                </>
              ) : (
                <p className="mt-1 text-base text-chalk-2">
                  {decision === "returning" ? "Off the board: marked as returning to school." : "Not on the forecast board. Below the radar threshold for the next class."}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="eyebrow">{r.classYear === 4 ? "Senior" : "Junior"} decision</p>
              <div className="mt-1">
                <DecisionButtons id={r.id} current={decision} senior={r.classYear === 4} />
              </div>
              <p className="mt-1 max-w-xs text-[11px] text-chalk-3">
                {r.classYear === 4 ? "Seniors are eligible by default." : "Juniors stay on the board until they announce they are returning."}
              </p>
            </div>
          </div>
        </section>
      )}

      {r && (
        <section className="mt-8 grid gap-2 sm:grid-cols-4">
          <Meter label="Production" value={r.production} note={r.adjustedProduction !== null ? `raw ${r.rawProduction}, opponent-adjusted ${r.adjustedProduction}, vs ${r.classification?.toUpperCase()} ${r.group}` : `percentile vs ${r.classification?.toUpperCase()} ${r.group}, no game log`} />
          <Meter label="Pedigree" value={r.pedigree} note="recruiting rating" />
          <Meter label="Usage" value={r.usage} note="share of team plays" />
          <Meter label="Size" value={r.size === null ? 40 : r.size ? 100 : 0} note={r.size === null ? "unknown" : r.size ? "meets NFL norms" : "under NFL norms"} />
        </section>
      )}

      <section className="mt-8">
        <p className="eyebrow">{r ? "Season line" : "Traits"}</p>
        {r && r.statLine.length > 0 ? (
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {r.statLine.map((s) => (
              <div key={s.label} className="card px-3 py-2">
                <dt className="eyebrow">{s.label}</dt>
                <dd className="mono mt-0.5 text-xl text-chalk">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {p.traits.map((t) => (
              <span key={t} className="rounded bg-panel px-3 py-1.5 text-sm text-chalk">{t}</span>
            ))}
            {p.weakness && <span className="rounded bg-panel px-3 py-1.5 text-sm text-brick">− {p.weakness}</span>}
            {r && <span className="text-sm text-chalk-3">No box-score stats for this position. {r.evidence.map((e) => e.label).join(" · ")}</span>}
          </div>
        )}
        {r && r.gamesPlayed ? <p className="mono mt-2 text-xs text-chalk-3">{r.gamesPlayed} team games this season.</p> : null}
      </section>

      {r && (
        <>
          <section className="mt-8">
            <StockPanel playerId={r.id} />
          </section>
          <GameLog playerId={r.id} group={r.group} />
        </>
      )}

      {p.lines && p.lines.length > 0 && !log && (
        <section className="mt-8">
          <p className="eyebrow text-turf">This week&apos;s game</p>
          <ul className="mono mt-2 grid gap-1 text-sm text-chalk">
            {p.lines.map((l) => (
              <li key={l.category}>{l.headline}</li>
            ))}
          </ul>
        </section>
      )}

      {log && game && (
        <>
          <PlayerGameLog log={log} boxLines={p.lines} live={game.status === "live"} />
          {game.status === "live" && <LivePoller active label="live, log updates every minute" />}
        </>
      )}

      <section className="mt-8">
        <p className="eyebrow">What to watch</p>
        <p className="mt-2 max-w-3xl text-lg leading-snug text-chalk">{p.watchFor}</p>
        {p.weakness && <p className="mt-2 text-sm text-brick">− {p.weakness}</p>}
      </section>

      <section className="mt-8">
        <p className="eyebrow">This week</p>
        {game ? (
          <Link href={`/game/${game.id}`} className="card mt-2 flex items-center justify-between gap-3 p-4 hover:bg-panel-2">
            <span className="display text-2xl font-bold text-chalk">
              {game.away.rank ? <span className="mr-1 text-lg text-flag">{game.away.rank}</span> : null}{game.away.short} @ {game.home.rank ? <span className="mr-1 text-lg text-flag">{game.home.rank}</span> : null}{game.home.short}
            </span>
            <span className="mono text-right text-xs text-chalk-3">{kickoffTime(game.kickoff)} ET · {game.network}</span>
          </Link>
        ) : (
          <p className="mt-2 text-sm text-chalk-3">No game on this week&apos;s schedule for {r?.team ?? p.team}.</p>
        )}
      </section>

      {/* Derek's own grade for this player. Tied to this week's game when there is one; feeds /board. */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">My grade{game ? ` for ${game.away.short} @ ${game.home.short}` : ""}</p>
          <Link href="/board" className="mono text-xs text-sky hover:underline">My board</Link>
        </div>
        <div className="mt-2">
          <GradeWidget playerId={p.id} gameId={game?.id} date={game ? etDateOf(game.kickoff) : undefined} name={p.name} team={r?.team ?? team?.name ?? p.team} pos={p.pos} cls={p.cls} />
        </div>
      </section>

      {/* Beat feed items that name this player, plus a highlights link. Context only. */}
      <section className="mt-8">
        <p className="eyebrow">In the news</p>
        <Suspense fallback={<BeatFeedFallback />}>
          <PlayerNews player={{ id: p.id, name: p.name, team: team?.short ?? r?.team ?? p.team }} />
        </Suspense>
      </section>
    </article>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="eyebrow">{label}</p>
      {children}
    </div>
  );
}

function Meter({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">{label}</p>
        <span className="mono text-sm text-chalk">{value}</span>
      </div>
      <div className="meter mt-2"><span style={{ width: `${value}%` }} /></div>
      <p className="mt-1 text-[11px] text-chalk-3">{note}</p>
    </div>
  );
}
