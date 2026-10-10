import Link from "next/link";
import Image from "next/image";
import type { Game, Team } from "@/lib/types";
import { rightNow, type FlipItem, type FlipTone, type PopItem } from "@/lib/rightnow";
import { kickoffTime } from "@/lib/format";
import { LivePoller } from "./LivePoller";
import { Avatar } from "./Avatar";

/**
 * Game-day board on the home page: what to flip to, which radar names are
 * having a big day, and the next kickoff window. Renders nothing when no
 * Division I game is live. The page refreshes itself every minute.
 */
export async function RightNow({ games }: { games: Game[] }) {
  const board = await rightNow(games);
  if (!board.live) return null;
  const top = board.flips.slice(0, 6);
  const rest = board.flips.slice(6);
  const pops = board.popping.slice(0, 8);

  return (
    <section className="card mt-4 overflow-hidden" aria-label="Right now">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-navy px-4 py-2.5 text-white">
        <h2 className="display text-xl font-bold tracking-wide">Right now</h2>
        <span className="mono text-xs text-white/70">{board.live} live</span>
        <span className="ml-auto rounded bg-white px-2 py-0.5">
          <LivePoller active label="updating every minute" />
        </span>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:divide-x lg:divide-line">
        {/* Flip to */}
        <div className="min-w-0 p-3 sm:p-4">
          <p className="eyebrow mb-2">Flip to</p>
          <ul className="grid grid-cols-1 gap-1.5">
            {top.map((f) => (
              <li key={f.game.id}>
                <FlipRow f={f} />
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-sky hover:underline">All {board.live} live games</summary>
              <ul className="mt-1.5 grid grid-cols-1 gap-1">
                {rest.map((f) => (
                  <li key={f.game.id}>
                    <CompactRow f={f} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Radar names popping */}
        <div className="min-w-0 border-t border-line p-3 sm:p-4 lg:border-t-0">
          <p className="eyebrow mb-2">Radar names popping</p>
          {pops.length ? (
            <ul className="grid grid-cols-1 gap-1.5">
              {pops.map((p) => (
                <li key={p.playerId}>
                  <PopRow p={p} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-chalk-3">No radar name has a big line yet. A big line is about 200 passing yards with a score, 100 rushing or receiving yards, two sacks, or a pick.</p>
          )}

          {board.upNext.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow mb-1.5">Up next · {kickoffTime(board.upNext[0].kickoff)} ET</p>
              <div className="scroll-x -mx-3 flex gap-1.5 px-3 sm:-mx-4 sm:px-4">
                {board.upNext.slice(0, 8).map((g) => (
                  <Link key={g.id} href={`/game/${g.id}`} className="chip shrink-0 !px-2.5 !py-1 !text-xs">
                    {teamLabel(g.away)} <span className="font-normal text-chalk-3">at</span> {teamLabel(g.home)}
                    {g.network && !/no listed/i.test(g.network) && <span className="mono text-[10px] font-normal text-chalk-3">{g.network}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const TONE: Record<FlipTone, string> = {
  hot: "bg-brick text-white",
  upset: "bg-warn text-chalk",
  ranked: "bg-navy text-white",
  close: "bg-turf text-white",
  other: "bg-ink-2 text-chalk-2",
};

function teamLabel(t: Team) {
  return (
    <span className="whitespace-nowrap">
      {t.rank ? <span className="mr-0.5 text-[0.8em] font-semibold text-chalk-3">{t.rank}</span> : null}
      {t.short}
    </span>
  );
}

function Logo({ t }: { t: Team }) {
  if (!t.logo) return <span className="inline-block h-5 w-5 shrink-0 rounded-full" style={{ background: t.color }} />;
  return <Image src={t.logo} alt="" width={20} height={20} className="h-5 w-5 shrink-0 object-contain" unoptimized />;
}

function ScoreLine({ t, pts, lead }: { t: Team; pts?: number; lead: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Logo t={t} />
      <span className={`truncate ${lead ? "font-bold text-chalk" : "text-chalk-2"}`}>{teamLabel(t)}</span>
      <span className={`display ml-auto pl-2 text-xl leading-none ${lead ? "font-extrabold text-chalk" : "font-semibold text-chalk-3"}`}>{pts ?? "-"}</span>
    </span>
  );
}

function FlipRow({ f }: { f: FlipItem }) {
  const g = f.game;
  const a = g.score?.away;
  const h = g.score?.home;
  return (
    <Link href={`/game/${g.id}`} className="flex items-stretch gap-3 rounded border border-line px-3 py-2 transition-colors hover:border-line-2 hover:bg-panel-2">
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TONE[f.tone]}`}>{f.reason}</span>
          {g.division === "FCS" && <span className="mono rounded border border-line px-1 text-[10px] text-chalk-3">FCS</span>}
        </span>
        <ScoreLine t={g.away} pts={a} lead={(a ?? 0) > (h ?? 0)} />
        <ScoreLine t={g.home} pts={h} lead={(h ?? 0) > (a ?? 0)} />
      </span>
      <span className="flex w-20 shrink-0 flex-col items-end justify-center gap-0.5 text-right">
        <span className="mono text-xs font-semibold text-turf">{f.clock}</span>
        {f.network && <span className="mono truncate text-[11px] text-chalk-3" style={{ maxWidth: "5rem" }}>{f.network}</span>}
        {f.winProb && <span className="mono text-[10px] text-chalk-3">{f.winProb}</span>}
      </span>
    </Link>
  );
}

function CompactRow({ f }: { f: FlipItem }) {
  const g = f.game;
  return (
    <Link href={`/game/${g.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-panel-2">
      <span className="min-w-0 flex-1 truncate">
        {teamLabel(g.away)} {g.score?.away ?? ""} <span className="text-chalk-3">at</span> {teamLabel(g.home)} {g.score?.home ?? ""}
      </span>
      <span className="mono shrink-0 text-[11px] text-chalk-3">{f.clock}</span>
    </Link>
  );
}

function PopRow({ p }: { p: PopItem }) {
  const g = p.game;
  const vs = p.team === g.home ? "vs" : "at";
  return (
    <Link href={`/game/${g.id}`} className="flex items-center gap-3 rounded border border-line px-3 py-2 transition-colors hover:border-line-2 hover:bg-panel-2">
      <Avatar size="sm" jersey={p.jersey} color={p.team.color} logo={p.team.logo} playerId={p.playerId} name={p.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="display truncate text-base font-bold text-chalk">{p.name}</span>
          <span className="mono shrink-0 text-[11px] text-chalk-3">
            {p.pos} · {p.team.abbr}
          </span>
        </span>
        <span className="mono block truncate text-xs text-chalk">{p.line}</span>
        <span className="block truncate text-[11px] text-chalk-3">
          {vs} {p.opp.short} · {g.score?.clock ?? "live"} · {p.draftYear} class{p.radarScore ? ` · radar ${p.radarScore}` : ""}
        </span>
      </span>
    </Link>
  );
}
