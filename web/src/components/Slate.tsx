"use client";

import { useMemo, useState } from "react";
import type { Division, Game } from "@/lib/types";
import { scoutScore, scoreTag, prospectCounts } from "@/lib/score";
import { weatherRisk } from "@/lib/weather";
import { kickoffWindow, type Window } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import { GameCard } from "./GameCard";

type Quick = "All" | "Live" | "Upcoming" | "Finished" | "Top Prospects" | "Hidden Gems" | "Watchlist" | "Late Night Radar";
const QUICK: Quick[] = ["All", "Live", "Upcoming", "Finished", "Top Prospects", "Hidden Gems", "Late Night Radar", "Watchlist"];
const DIVS: Division[] = ["FBS", "FCS", "DII", "DIII", "NAIA"];
const WINDOWS: Window[] = ["Noon", "Afternoon", "Prime time", "Late night"];

export function Slate({ games }: { games: Game[] }) {
  const [quick, setQuick] = useState<Quick>("All");
  const [divs, setDivs] = useState<Set<Division>>(new Set(DIVS));
  const [weatherOnly, setWeatherOnly] = useState(false);
  const [sort, setSort] = useState<"kickoff" | "score">("kickoff");
  const [q, setQ] = useState("");
  const { list } = useWatchlist();

  const filtered = useMemo(() => {
    let out = games.filter((g) => divs.has(g.division));
    switch (quick) {
      case "Live": out = out.filter((g) => g.status === "live"); break;
      case "Upcoming": out = out.filter((g) => g.status === "upcoming"); break;
      case "Finished": out = out.filter((g) => g.status === "final"); break;
      case "Top Prospects": out = out.filter((g) => prospectCounts(g).likely >= 2); break;
      case "Hidden Gems": out = out.filter((g) => scoreTag(g) === "Hidden Gem"); break;
      case "Late Night Radar":
        out = out.filter((g) => g.status === "live" || kickoffWindow(g.kickoff) === "Late night");
        break;
      case "Watchlist":
        out = out.filter((g) => list.games.includes(g.id) || g.prospects.some((p) => list.players.includes(p.id)));
        break;
    }
    if (weatherOnly) out = out.filter((g) => weatherRisk(g.weather) !== "none");
    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter((g) =>
        [g.home.short, g.home.name, g.home.abbr, g.home.conference, g.away.short, g.away.name, g.away.abbr, g.away.conference, g.network, g.venue]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    out = [...out].sort((a, b) =>
      sort === "score"
        ? scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents)
        : a.kickoff.localeCompare(b.kickoff) || scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents),
    );
    return out;
  }, [games, quick, divs, weatherOnly, sort, list, q]);

  const grouped = useMemo(() => {
    if (sort === "score") return [["By Scout Score", filtered] as const];
    return WINDOWS.map((w) => [w, filtered.filter((g) => kickoffWindow(g.kickoff) === w)] as const).filter(([, gs]) => gs.length);
  }, [filtered, sort]);

  const toggleDiv = (d: Division) =>
    setDivs((prev) => {
      const next = new Set(prev);
      if (next.has(d) && next.size === 1) return new Set(DIVS); // never allow zero
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });

  return (
    <div>
      {/* Search */}
      <label className="block">
        <span className="sr-only">Search teams, conferences, networks</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a team, conference, or network"
          className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-chalk placeholder:text-chalk-3 focus:border-chalk-2 focus:outline-none"
        />
      </label>

      {/* Quick filters */}
      <div className="scroll-x -mx-4 mt-3 flex gap-2 px-4 pb-1">
        {QUICK.map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={quick === k} onClick={() => setQuick(k)}>
            {k === "Live" && <span className="live-dot" />}
            {k}
          </button>
        ))}
      </div>

      {/* Division + extras */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">Division</span>
        {DIVS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={divs.has(d)}
            onClick={() => toggleDiv(d)}
            className="mono rounded border border-line px-2 py-1 text-[11px] tracking-wider text-chalk-3 aria-pressed:border-chalk-2 aria-pressed:text-chalk"
          >
            {d}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          aria-pressed={weatherOnly}
          onClick={() => setWeatherOnly((v) => !v)}
          className="mono rounded border border-line px-2 py-1 text-[11px] tracking-wider text-chalk-3 aria-pressed:border-brick aria-pressed:text-brick"
        >
          △ Weather risk
        </button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-chalk-3">
          Sort
          <button type="button" className="chip !py-1 !text-[11px]" aria-pressed={sort === "kickoff"} onClick={() => setSort("kickoff")}>Kickoff</button>
          <button type="button" className="chip !py-1 !text-[11px]" aria-pressed={sort === "score"} onClick={() => setSort("score")}>Score</button>
        </span>
      </div>

      {/* Groups */}
      {grouped.length === 0 && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-2xl text-chalk">Nothing matches</p>
          <p className="mt-1 text-sm text-chalk-3">
            {quick === "Watchlist" ? "Follow a game or a player and it shows up here." : "Loosen a filter. Every scheduled game is on the slate."}
          </p>
        </div>
      )}
      {grouped.map(([label, gs]) => (
        <section key={label} className="mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <h2 className="display text-2xl font-bold text-chalk">{label}</h2>
            <span className="mono text-xs text-chalk-3">{gs.length} {gs.length === 1 ? "game" : "games"}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid min-w-0 gap-2.5">
            {gs.map((g, i) => (
              <GameCard key={g.id} game={g} index={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
