import Link from "next/link";
import type { Prospect, Team } from "@/lib/types";
import { Tier } from "./badges";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { DeltaArrow } from "./MovementBits";
import { GradeWidget } from "./GradeWidget";
import type { LastPlay } from "@/lib/playerlog";

/**
 * One prospect, in the game report or on the radar board. Everything shown is
 * evidence with a source: production, pedigree, size, usage. The score ranks
 * evidence; it is not a draft grade and the card says so.
 */
export function ProspectCard({ p, team, gameLabel, gameHref, compact = false, grade, note, lastPlay }: { p: Prospect; team: Team; gameLabel?: string; gameHref?: string; compact?: boolean; /** When set (game live or final), Derek can grade the player for this game. */ grade?: { gameId: string; date: string }; /** Optional slot above the header, e.g. a feed-derived availability note (AvailabilityNote). */ note?: React.ReactNode; /** Live game: the newest play from ESPN's play-by-play that names him (src/lib/playerlog.ts). */ lastPlay?: LastPlay }) {
  const r = p.radar;
  return (
    <div className="card flex flex-col gap-3 p-4">
      {note}
      <div className="flex items-start gap-3">
        <Avatar jersey={p.jersey} color={team.color} logo={team.logo} size={compact ? "sm" : "md"} playerId={p.id} name={p.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/player/${p.id}`} className="display truncate text-2xl font-bold leading-none text-chalk hover:text-flag">
              {p.name}
            </Link>
            {r && <span className="flex shrink-0 items-center gap-1.5"><DeltaArrow delta={r.delta} /><RadarScore score={r.score} /></span>}
          </div>
          <p className="mono mt-1 text-xs text-chalk-3">
            {p.pos} · {team.abbr} · {p.cls}{p.ht ? ` · ${p.ht}, ${p.wt}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <Tier tier={p.tier} />
            <span className="text-chalk">{p.projected.includes("forecast") ? p.projected.replace(" (forecast)", "") : `${p.draftYear} draft`}</span>
            {r?.stars ? <span className="text-warn">{"★".repeat(r.stars)}</span> : null}
          </div>
        </div>
      </div>

      {r ? (
        <ul className="grid gap-1 text-sm">
          {r.evidence.slice(0, compact ? 2 : 4).map((e) => (
            <li key={e.kind + e.label} className="flex gap-2 leading-snug">
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${e.kind === "production" ? "bg-flag" : e.kind === "pedigree" ? "bg-sky" : e.kind === "size" ? "bg-turf" : "bg-chalk-3"}`} />
              <span className="text-chalk-2">
                {e.label}
                {e.note && <span className="text-chalk-3"> · {e.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {p.traits.map((t) => (
            <span key={t} className="rounded border border-line bg-ink-2 px-2 py-0.5 text-xs text-chalk-2">{t}</span>
          ))}
        </div>
      )}

      {r && (r.qocLabel === "tough" || r.qocLabel === "soft") && (
        <p className="mono -mt-1 text-[11px] text-chalk-3" title="Average opponent percentile on his production axis, from the game log">
          vs {r.qocLabel} schedule{r.qoc !== null ? `, avg opponent ${r.qoc}th pct` : ""}
        </p>
      )}

      {p.lines && p.lines.length > 0 && (
        <div className="rounded-md border border-turf/40 bg-turf/10 px-3 py-2 text-xs">
          <span className="eyebrow text-turf">In this game</span>
          <ul className="mono mt-1 grid gap-0.5 text-chalk">
            {p.lines.map((l) => (
              <li key={l.category}>{l.headline}</li>
            ))}
          </ul>
        </div>
      )}

      {lastPlay && (
        <p className={`rounded-md border px-3 py-1.5 text-xs leading-snug ${lastPlay.isScoring ? "border-turf/40 bg-turf/10" : lastPlay.isBig ? "border-navy/30 bg-panel" : "border-line bg-panel"}`} title={lastPlay.text}>
          <span className="eyebrow mr-1">Last play</span>
          <span className={`font-semibold ${lastPlay.isScoring ? "text-turf" : lastPlay.isBig ? "text-navy" : "text-chalk"}`}>{lastPlay.tag}</span>
          <span className="mono ml-1.5 text-chalk-3">{lastPlay.when}</span>
        </p>
      )}

      {!compact && (
        <p className="text-sm leading-snug text-chalk-2">
          <span className="eyebrow mr-1">Watch for</span>
          {p.watchFor}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        {gameLabel && gameHref ? (
          <Link href={gameHref} className="mono truncate text-xs text-sky hover:text-chalk">{gameLabel}</Link>
        ) : (
          <span className="mono truncate text-xs text-chalk-3">{p.stat}</span>
        )}
        <FollowButton kind="players" id={p.id} size="sm" />
      </div>
      {grade && (
        <div className="border-t border-line pt-2">
          <GradeWidget playerId={p.id} gameId={grade.gameId} date={grade.date} name={p.name} team={p.radar?.team ?? team.name} pos={p.pos} cls={p.cls} compact />
        </div>
      )}
    </div>
  );
}

export function RadarScore({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  const tone = score >= 75 ? "text-flag" : score >= 55 ? "text-chalk" : "text-chalk-3";
  return (
    <span className={`display shrink-0 font-extrabold leading-none ${tone} ${size === "lg" ? "text-6xl" : "text-2xl"}`} title="Radar score: ranks evidence, not a draft grade">
      {score}
    </span>
  );
}
