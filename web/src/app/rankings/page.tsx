import Link from "next/link";
import Image from "next/image";
import { getSlate, type Poll } from "@/lib/slate";
import { kickoffTime } from "@/lib/format";
import { FollowButton } from "@/components/FollowButton";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const slate = await getSlate();
  const byId = new Map(slate.weekGames.map((g) => [g.id, g]));
  const ap = slate.polls.find((p) => p.division === "FBS");
  const others = slate.polls.filter((p) => p !== ap);

  return (
    <div>
      <p className="eyebrow">
        {slate.week ? `${slate.season} · Week ${slate.week.week}` : "Rankings"}
      </p>
      <h1 className="display mt-1 text-4xl font-extrabold text-chalk sm:text-5xl">Top 25</h1>
      <p className="mt-2 max-w-2xl text-sm text-chalk-3">
        Follow a team and every game it plays lands in your watchlist. Ranks come from the AP poll for FBS and the coaches polls below it.
      </p>

      {slate.source !== "live" && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-xl text-chalk">Rankings need live data</p>
          <p className="mt-1 text-sm text-chalk-3">Set CFBD_API_KEY to load this week&apos;s polls.</p>
        </div>
      )}

      {ap && <PollTable poll={ap} byId={byId} open />}
      {others.map((p) => (
        <PollTable key={p.name} poll={p} byId={byId} />
      ))}
    </div>
  );
}

function PollTable({ poll, byId, open = false }: { poll: Poll; byId: Map<string, Game>; open?: boolean }) {
  return (
    <details className="group mt-8" open={open}>
      <summary className="flex cursor-pointer select-none items-baseline gap-3">
        <h2 className="display text-xl font-bold text-chalk">{poll.name}</h2>
        <span className="mono text-xs text-chalk-3">{poll.division}</span>
        <span className="h-px flex-1 bg-line" />
        <span className="mono text-xs text-chalk-3 group-open:hidden">show</span>
      </summary>
      <ol className="mt-3 grid gap-1.5">
        {poll.teams.map(({ rank, team, gameId, firstPlaceVotes }) => {
          const g = gameId ? byId.get(gameId) : undefined;
          const opp = g ? (g.home.short === team.short ? g.away : g.home) : undefined;
          const atHome = g ? g.home.short === team.short : false;
          return (
            <li key={team.short} className="card grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-3 p-3 sm:grid-cols-[2.5rem_auto_1fr_auto_auto]">
              <span className="display text-2xl font-extrabold text-flag">{rank}</span>
              {team.logo ? (
                <Image src={team.logo} alt="" width={28} height={28} className="h-7 w-7 object-contain" unoptimized />
              ) : (
                <span className="inline-block h-6 w-1 rounded-sm" style={{ background: team.color }} />
              )}
              <span className="min-w-0">
                <span className="display block truncate text-xl font-semibold text-chalk">{team.short}</span>
                <span className="mono text-[11px] text-chalk-3">
                  {team.record}{team.conference ? ` · ${team.conference}` : ""}
                  {firstPlaceVotes ? ` · ${firstPlaceVotes} first-place` : ""}
                </span>
              </span>
              <span className="col-span-4 sm:col-span-1 sm:text-right">
                {g && opp ? (
                  <Link href={`/game/${g.id}`} className="mono text-xs text-sky hover:text-chalk">
                    {atHome ? "vs" : "at"} {opp.rank ? `${opp.rank} ` : ""}{opp.short} · {kickoffTime(g.kickoff)} ET
                    {g.status === "final" && g.score && Number.isFinite(g.score.home) ? ` · Final ${atHome ? g.score.home : g.score.away}-${atHome ? g.score.away : g.score.home}` : ""}
                    {g.status === "live" ? " · in progress" : ""}
                  </Link>
                ) : (
                  <span className="mono text-xs text-chalk-3">idle this week</span>
                )}
              </span>
              <span className="col-span-4 justify-self-start sm:col-span-1 sm:justify-self-end">
                <FollowButton kind="teams" id={team.short} label="Follow" size="sm" />
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
