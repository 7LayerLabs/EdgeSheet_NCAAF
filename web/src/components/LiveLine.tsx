import type { Game } from "@/lib/types";
import { winProbLine } from "@/lib/live";

/**
 * One-line live situation plus a win probability bar, for the slate card.
 * Every token comes from the ESPN feed; missing pieces are left out, not guessed.
 */
export function LiveLine({ game }: { game: Game }) {
  const l = game.live;
  if (!l || game.status !== "live") return null;
  const wp = winProbLine(game);
  const situation = [l.possession ? `${l.possession} ball` : undefined, l.downDistance].filter(Boolean).join(", ");
  return (
    <div className="mt-2 rounded border border-turf/30 bg-turf/5 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="mono font-medium text-turf">{l.clock}</span>
        {situation ? <span className="text-chalk">{situation}</span> : <span className="text-chalk-3">between plays</span>}
        {l.broadcast && <span className="text-chalk-3">{l.broadcast}</span>}
      </div>
      {wp ? (
        <div className="mt-1.5 flex items-center gap-2">
          <WinBar home={l.homeWinProb ?? 0.5} homeColor={game.home.color} awayColor={game.away.color} />
          <span className="mono whitespace-nowrap text-[11px] text-chalk">
            {wp.team} {wp.pct}%
            {wp.swing !== undefined ? (
              <span className={wp.swing > 0 ? "text-turf" : wp.swing < 0 ? "text-brick" : "text-chalk-3"}>
                {" "}
                {wp.swing > 0 ? "▲" : wp.swing < 0 ? "▼" : ""}
                {wp.swing > 0 ? "+" : ""}
                {wp.swing} last {wp.minutes} min
              </span>
            ) : (
              <span className="text-chalk-3"> trend builds after 2 min</span>
            )}
          </span>
        </div>
      ) : (
        <p className="mono mt-1 text-[11px] text-chalk-3">Win probability not posted yet</p>
      )}
    </div>
  );
}

/** Home share from the left in the home color, away share from the right. */
export function WinBar({ home, homeColor, awayColor, tall = false }: { home: number; homeColor: string; awayColor: string; tall?: boolean }) {
  const h = Math.round(Math.max(0, Math.min(1, home)) * 100);
  return (
    <span className={`relative inline-flex ${tall ? "h-3" : "h-1.5"} w-full min-w-16 overflow-hidden rounded-sm bg-ink-2`} aria-hidden>
      <span className="h-full" style={{ width: `${h}%`, background: homeColor }} />
      <span className="h-full flex-1" style={{ background: awayColor, opacity: 0.55 }} />
      <span className="absolute left-1/2 top-0 h-full w-px bg-white/80" />
    </span>
  );
}
