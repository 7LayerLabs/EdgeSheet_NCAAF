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

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: PageProps<"/player/[id]">) {
  const { id } = await params;
  const hit = await getPlayer(id);
  if (!hit) notFound();
  const { player: p, game } = hit;
  const team = game ? (p.team === game.home.abbr ? game.home : game.away) : undefined;
  const r = p.radar;
  const meta = genMeta();

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
        <Avatar jersey={p.jersey} color={team?.color ?? "#3a4957"} logo={team?.logo} size="lg" />
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
            <p className="eyebrow mt-1">Radar score</p>
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
              <span className="display text-4xl font-bold text-flag-2">{"★".repeat(r.stars)}</span>
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

      {r && (
        <section className="mt-8 grid gap-2 sm:grid-cols-4">
          <Meter label="Production" value={r.production} note={`percentile vs ${r.classification?.toUpperCase()} ${r.group}`} />
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

      {p.lines && p.lines.length > 0 && (
        <section className="mt-8">
          <p className="eyebrow text-turf">This week&apos;s game</p>
          <ul className="mono mt-2 grid gap-1 text-sm text-chalk">
            {p.lines.map((l) => (
              <li key={l.category}>{l.headline}</li>
            ))}
          </ul>
        </section>
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
