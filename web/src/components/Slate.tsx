"use client";

import { useMemo, useState } from "react";
import type { Division, Game } from "@/lib/types";
import { scoutScore, scoreTag, prospectCounts } from "@/lib/score";
import { weatherRisk } from "@/lib/weather";
import { kickoffWindow, type Window } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import { GameCard } from "./GameCard";
import { flipScore } from "@/lib/live";

type Quick = "All" | "Live" | "Flip to" | "Upcoming" | "Finished" | "Top 25" | "Top Prospects" | "Hidden Gems" | "Watchlist" | "Late Night Radar";
const QUICK: Quick[] = ["All", "Live", "Flip to", "Upcoming", "Finished", "Top 25", "Top Prospects", "Hidden Gems", "Late Night Radar", "Watchlist"];

const DIVS: Division[] = ["FBS", "FCS"];
const DEFAULT_DIVS: Division[] = ["FBS", "FCS"]; // Division I by default; lower divisions are a toggle

type Group = "top25" | "conference" | "kickoff";
/** Conference display order: the four power leagues, then the rest alphabetically, FBS before FCS. */
const POWER = ["SEC", "Big Ten", "Big 12", "ACC"];
const bestRank = (g: Game) => Math.min(g.home.rank ?? 99, g.away.rank ?? 99);
const confOf = (g: Game) => (g.home.conference || g.away.conference || "Other").replace(/^Mid-American$/, "MAC").replace(/^American Athletic$/, "American");
const WINDOWS: Window[] = ["Noon", "Afternoon", "Prime time", "Late night"];

export function Slate({ games }: { games: Game[] }) {
  const [quick, setQuick] = useState<Quick>("All");
  const [divs, setDivs] = useState<Set<Division>>(new Set(DEFAULT_DIVS));
  const [weatherOnly, setWeatherOnly] = useState(false);
  const [sort, setSort] = useState<"kickoff" | "score" | "rank">("kickoff");
  const [group, setGroup] = useState<Group>("top25");
  const [q, setQ] = useState("");
  const { list } = useWatchlist();

  const filtered = useMemo(() => {
    let out = games.filter((g) => divs.has(g.division));
    switch (quick) {
      case "Live": out = out.filter((g) => g.status === "live"); break;
      case "Flip to": out = out.filter((g) => g.status === "live"); break;
      case "Upcoming": out = out.filter((g) => g.status === "upcoming"); break;
      case "Finished": out = out.filter((g) => g.status === "final"); break;
      case "Top 25": out = out.filter((g) => g.home.rank || g.away.rank); break;
      case "Top Prospects": out = out.filter((g) => prospectCounts(g).likely >= 2); break;
      case "Hidden Gems": out = out.filter((g) => scoreTag(g) === "Hidden Gem"); break;
      case "Late Night Radar":
        out = out.filter((g) => g.status === "live" || kickoffWindow(g.kickoff) === "Late night");
        break;
      case "Watchlist":
        out = out.filter(
          (g) =>
            list.games.includes(g.id) ||
            list.teams.includes(g.home.short) ||
            list.teams.includes(g.away.short) ||
            g.prospects.some((p) => list.players.includes(p.id)),
        );
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
    if (quick === "Flip to") return [...out].sort((a, b) => flipScore(b) - flipScore(a) || a.kickoff.localeCompare(b.kickoff));
    out = [...out].sort((a, b) =>
      sort === "score"
        ? scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents)
        : sort === "rank"
          ? bestRank(a) - bestRank(b) || a.kickoff.localeCompare(b.kickoff)
          : a.kickoff.localeCompare(b.kickoff) || scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents),
    );
    return out;
  }, [games, quick, divs, weatherOnly, sort, list, q]);

  const grouped = useMemo((): (readonly [string, Game[]])[] => {
    if (quick === "Flip to") return [["Flip to, best first", filtered] as const];
    const byKick = (a: Game, b: Game) => a.kickoff.localeCompare(b.kickoff) || scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents);
    const byScore = (a: Game, b: Game) => scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents);
    const within = sort === "score" ? byScore : byKick;

    if (group === "top25") {
      // AP Top 25 sections for FBS, then the rest of FBS, then FCS Top 25 sections (coaches poll), then the rest of FCS.
      const byRank = (a: Game, b: Game) => bestRank(a) - bestRank(b) || byKick(a, b);
      const out: (readonly [string, Game[]])[] = [];
      for (const d of DIVS) {
        const pool = filtered.filter((g) => g.division === d);
        if (!pool.length) continue;
        const label = d === "FBS" ? "AP Top 25" : "FCS Top 25";
        const both = pool.filter((g) => g.home.rank && g.away.rank).sort(byRank);
        const one = pool.filter((g) => (g.home.rank || g.away.rank) && !(g.home.rank && g.away.rank)).sort(byRank);
        const rest = pool.filter((g) => !g.home.rank && !g.away.rank).sort(within);
        if (both.length) out.push([`${label}: ranked vs ranked`, both] as const);
        if (one.length) out.push([`${label} in action`, one] as const);
        if (rest.length) out.push([d === "FBS" ? "Rest of FBS" : "Rest of FCS", rest] as const);
      }
      return out;
    }

    if (group === "conference") {
      const m = new Map<string, Game[]>();
      for (const g of filtered) m.set(confOf(g), [...(m.get(confOf(g)) ?? []), g]);
      const divRank = (c: string) => {
        const g = m.get(c)![0];
        return g.division === "FBS" ? 0 : g.division === "FCS" ? 1 : 2;
      };
      const order = [...m.keys()].sort((a, b) => {
        const pa = POWER.indexOf(a);
        const pb = POWER.indexOf(b);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return divRank(a) - divRank(b) || a.localeCompare(b);
      });
      return order.map((c) => [c, m.get(c)!.sort(within)] as const);
    }

    if (sort === "score") return [["By Scout Score", [...filtered].sort(byScore)] as const];
    return WINDOWS.map((w) => [w, filtered.filter((g) => kickoffWindow(g.kickoff) === w).sort(byKick)] as const).filter(([, gs]) => gs.length);
  }, [filtered, sort, quick, group]);

  const toggleDiv = (d: Division) =>
    setDivs((prev) => {
      const next = new Set(prev);
      if (next.has(d) && next.size === 1) return new Set(DEFAULT_DIVS); // never allow zero
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
          className="w-full rounded border border-line bg-white px-3 py-2 text-base text-chalk placeholder:text-chalk-3 focus:border-navy focus:outline-none"
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
          className="mono rounded border border-line px-2 py-1 text-[11px] tracking-wider text-chalk-3 aria-pressed:border-warn aria-pressed:text-warn"
        >
          △ Weather risk
        </button>
      </div>

      {/* Group by + order */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <span className="eyebrow">Group by</span>
          <span className="seg">
            <button type="button" aria-pressed={group === "top25"} onClick={() => setGroup("top25")}>Top 25</button>
            <button type="button" aria-pressed={group === "conference"} onClick={() => setGroup("conference")}>Conference</button>
            <button type="button" aria-pressed={group === "kickoff"} onClick={() => setGroup("kickoff")}>Kickoff</button>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="eyebrow">Order</span>
          <span className="seg">
            <button type="button" aria-pressed={sort !== "score"} onClick={() => setSort("kickoff")}>Kickoff</button>
            <button type="button" aria-pressed={sort === "score"} onClick={() => setSort("score")}>Scout Score</button>
          </span>
        </span>
        <span className="text-xs text-chalk-3">{filtered.length} games shown</span>
      </div>

      {/* Groups */}
      {grouped.length === 0 && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-2xl text-chalk">Nothing matches</p>
          <p className="mt-1 text-sm text-chalk-3">
            {quick === "Watchlist"
              ? "Follow a team, a game, or a player and it shows up here."
              : quick === "Top 25"
                ? "No ranked team plays on this day with these filters."
                : "Loosen a filter. Every scheduled game is on the slate."}
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
