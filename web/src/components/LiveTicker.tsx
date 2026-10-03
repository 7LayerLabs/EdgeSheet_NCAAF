import Link from "next/link";
import type { Game } from "@/lib/types";
import { flipScore } from "@/lib/live";
import { LivePoller } from "./LivePoller";

/**
 * One scrolling row of every in-progress game, best flip first, with the
 * refresh indicator. Nothing renders when nothing is live.
 */
export function LiveTicker({ games }: { games: Game[] }) {
  const live = games.filter((g) => g.status === "live").sort((a, b) => flipScore(b) - flipScore(a) || a.kickoff.localeCompare(b.kickoff));
  if (!live.length) return null;
  return (
    <div className="mt-4 rounded border border-turf/30 bg-turf/5 px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="eyebrow shrink-0 text-turf">{live.length} live</span>
        <LivePoller active label="updating every minute" />
        <span className="ml-auto mono hidden text-[11px] text-chalk-3 sm:inline">sorted by flip score</span>
      </div>
      <div className="scroll-x -mx-3 mt-1.5 flex gap-2 px-3 pb-0.5">
        {live.map((g) => {
          const fs = flipScore(g);
          const l = g.live;
          return (
            <Link key={g.id} href={`/game/${g.id}`} className="chip shrink-0 !py-1 !text-xs hover:bg-panel-2">
              <span className="mono mr-2 text-turf">{fs}</span>
              <span className="text-chalk">
                {g.away.abbr} {g.score?.away ?? ""} <span className="text-chalk-3">@</span> {g.home.abbr} {g.score?.home ?? ""}
              </span>
              <span className="mono ml-2 text-[11px] text-chalk-3">{l?.clock}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
