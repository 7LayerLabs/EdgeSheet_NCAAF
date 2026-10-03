import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayer } from "@/lib/slate";
import { kickoffTime } from "@/lib/format";
import { Confidence, Tier } from "@/components/badges";
import { FollowButton } from "@/components/FollowButton";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: PageProps<"/player/[id]">) {
  const { id } = await params;
  const hit = await getPlayer(id);
  if (!hit) notFound();
  const { player: p, game } = hit;
  const team = game ? (p.team === game.home.abbr ? game.home : game.away) : undefined;

  return (
    <article className="rise">
      {game ? (
        <Link href={`/game/${game.id}`} className="mono text-xs text-chalk-3 hover:text-chalk">
          ← {game.away.short} @ {game.home.short}
        </Link>
      ) : (
        <Link href="/" className="mono text-xs text-chalk-3 hover:text-chalk">← Slate</Link>
      )}

      <header className="mt-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded-sm" style={{ background: team?.color ?? "var(--chalk-3)" }} />
          <span className="text-sm text-chalk-2">{team?.name ?? p.team}</span>
          <Tier tier={p.tier} />
        </div>
        <h1 className="display mt-2 text-6xl font-extrabold leading-none text-chalk">
          <span className="mr-3 text-flag">#{p.jersey}</span>
          {p.name}
        </h1>
        <p className="mono mt-2 text-sm text-chalk-3">
          {p.pos} · {p.cls} · {p.ht}, {p.wt} lb
        </p>
        <div className="mt-4">
          <FollowButton kind="players" id={p.id} />
        </div>
      </header>

      <section className="mt-8 grid gap-2 sm:grid-cols-3">
        <Box label="Expected draft year">
          <span className="display text-4xl font-bold text-chalk">{p.draftYear}</span>
          <Confidence level={p.eligibilityConfidence} />
        </Box>
        <Box label="Projected range">
          <span className="text-lg font-semibold text-chalk">{p.projected}</span>
          <Confidence level={p.projectionConfidence} />
        </Box>
        <Box label="Sources">
          <span className="display text-4xl font-bold text-chalk">{p.sourceCount}</span>
          <span className="text-xs text-chalk-3">Boards stored separately. No single mock is shown as consensus.</span>
        </Box>
      </section>

      <section className="mt-8">
        <p className="eyebrow">Traits</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {p.traits.map((t) => (
            <span key={t} className="rounded bg-panel px-3 py-1.5 text-sm text-chalk">{t}</span>
          ))}
          {p.weakness && <span className="rounded bg-panel px-3 py-1.5 text-sm text-brick">− {p.weakness}</span>}
        </div>
      </section>

      <section className="mt-8">
        <p className="eyebrow">Watch for</p>
        <p className="mt-2 text-lg leading-snug text-chalk">{p.watchFor}</p>
        {p.stat && <p className="mono mt-2 text-xs text-chalk-3">{p.stat}</p>}
      </section>

      <section className="mt-8">
        <p className="eyebrow">This week</p>
        {game ? (
          <Link href={`/game/${game.id}`} className="card mt-2 flex items-center justify-between gap-3 p-4 hover:bg-panel-2">
            <span className="display text-2xl font-bold text-chalk">
              {game.away.short} @ {game.home.short}
            </span>
            <span className="mono text-right text-xs text-chalk-3">{kickoffTime(game.kickoff)} ET · {game.network}</span>
          </Link>
        ) : (
          <p className="mt-2 text-sm text-chalk-3">No game on this week&apos;s schedule for {p.team}.</p>
        )}
      </section>

      <section className="mt-8">
        <p className="eyebrow">Projection history</p>
        <p className="mt-2 text-sm text-chalk-3">Board changes appear here once more than one snapshot is stored. The prospect file holds a single snapshot.</p>
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
