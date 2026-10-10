import Link from "next/link";
import { radarBoard, radarIndex, GROUP_LABEL, type PosGroup } from "@/lib/radar";
import { generatedLoaded, genMeta } from "@/lib/generated";
import { gameIndexForWeek, radarToProspect } from "@/lib/slate";
import { asOf, kickoffWhen } from "@/lib/format";
import { ProspectCard } from "@/components/ProspectCard";
import type { Team } from "@/lib/types";
import { biggestMoves } from "@/lib/movement";

export const dynamic = "force-dynamic";

const GROUPS: PosGroup[] = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "CB", "S"];
const DIVS = [
  { key: "fbs", label: "FBS" },
  { key: "fcs", label: "FCS" },
  { key: "ii", label: "DII" },
  { key: "iii", label: "DIII" },
] as const;

function href(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/radar?${s}` : "/radar";
}

export default async function RadarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const loaded = generatedLoaded();
  const meta = genMeta();
  const idx = loaded ? radarIndex() : undefined;
  const nextDraft = idx?.nextDraft ?? new Date().getFullYear() + 1;

  const cls = (str("class") && Number(str("class"))) || nextDraft;
  const group = GROUPS.includes(str("pos") as PosGroup) ? (str("pos") as PosGroup) : undefined;
  const div = (DIVS.find((d) => d.key === str("div"))?.key ?? "fbs") as "fbs" | "fcs" | "ii" | "iii";
  const q = str("q");
  const sort = (["score", "pedigree", "production", "risers"].includes(str("sort") ?? "") ? str("sort") : "score") as "score" | "pedigree" | "production" | "risers";
  const showAll = str("all") === "1";
  const base = { class: String(cls), pos: group, div, q, sort: sort === "score" ? undefined : sort, all: showAll ? "1" : undefined };

  const pool = loaded ? radarBoard({ draftClass: cls, group, classification: div, q, limit: 5000 }) : [];
  const sorted = sort === "score" ? pool : sort === "risers" ? [...pool].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || b.score - a.score) : [...pool].sort((a, b) => (sort === "pedigree" ? b.pedigree - a.pedigree || b.score - a.score : b.production - a.production || b.score - a.score));
  const risersEmpty = sort === "risers" && !pool.some((p) => p.delta !== null);
  const players = showAll ? sorted : sorted.slice(0, 60);
  const games = loaded ? await gameIndexForWeek() : new Map();

  const classLabel = cls === nextDraft ? "this year" : cls === nextDraft + 1 ? "next year" : "the year after";

  return (
    <div>
      <p className="eyebrow">Scouting radar{meta ? ` · stats as of ${asOf(meta.ingestedAt)}` : ""}</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">
        {cls} draft <span className="text-chalk-3">· {classLabel}</span>
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-chalk-3">
        Who NFL scouts are looking at, ranked by evidence: season production against the division, recruiting pedigree, usage share, and NFL size norms.
        Juniors and seniors sit in {nextDraft}; sophomores in {nextDraft + 1}; freshmen in {nextDraft + 2}. These are not draft grades and no outside board is loaded.
      </p>

      {!loaded && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-2xl text-chalk">Radar needs ingested data</p>
          <p className="mt-1 text-sm text-chalk-3">Run <code className="mono">npm run ingest</code> inside web/ to pull rosters, stats, and recruiting.</p>
        </div>
      )}

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="seg">
          {[nextDraft, nextDraft + 1, nextDraft + 2].map((y) => (
            <Link key={y} href={href({ ...base, class: String(y) })} aria-current={y === cls}>{y}</Link>
          ))}
        </span>
        <span className="seg">
          {DIVS.map((d) => (
            <Link key={d.key} href={href({ ...base, div: d.key })} aria-current={d.key === div}>{d.label}</Link>
          ))}
        </span>
        <span className="seg" title="Sort">
          {(["score", "pedigree", "production", "risers"] as const).map((k) => (
            <Link key={k} href={href({ ...base, sort: k === "score" ? undefined : k })} aria-current={k === sort}>{k === "score" ? "Radar score" : k === "pedigree" ? "Pedigree" : k === "production" ? "Production" : "Risers"}</Link>
          ))}
        </span>
        <form action="/radar" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="class" value={cls} />
          {sort !== "score" && <input type="hidden" name="sort" value={sort} />}
          {group && <input type="hidden" name="pos" value={group} />}
          <input type="hidden" name="div" value={div} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, school, conference"
            className="w-56 rounded border border-line bg-white px-3 py-1.5 text-sm text-chalk placeholder:text-chalk-3 focus:border-navy focus:outline-none"
          />
        </form>
      </div>
      <div className="scroll-x -mx-4 mt-2 flex gap-2 px-4 pb-1">
        <Link href={href({ ...base, pos: undefined })} className="chip" aria-pressed={!group}>All positions</Link>
        {GROUPS.map((g) => (
          <Link key={g} href={href({ ...base, pos: g })} className="chip" aria-pressed={g === group}>{g}</Link>
        ))}
      </div>

      {loaded && risersEmpty && (
        <div className="card mt-5 px-4 py-3 text-sm text-chalk-3">
          Risers need two weekly snapshots. {biggestMoves(1).note} Until then this list is in radar-score order.
        </div>
      )}

      {loaded && players.length === 0 && (
        <div className="card mt-6 p-8 text-center">
          <p className="display text-2xl text-chalk">Nothing on the radar here</p>
          <p className="mt-1 text-sm text-chalk-3">Try another class, division, or position.</p>
        </div>
      )}

      <ol className="mt-5 grid gap-2.5 md:grid-cols-2">
        {players.map((r, i) => {
          const g = games.get(r.team);
          const team: Team =
            g && g.home.short === r.team ? g.home : g && g.away.short === r.team ? g.away : { id: r.team, name: r.team, short: r.team, abbr: r.team.slice(0, 4).toUpperCase(), record: "", conference: r.conference ?? "", color: "#3a4957" };
          const p = radarToProspect(r, team.abbr);
          const label = g
            ? `${i + 1}. ${g.home.short === r.team ? "vs" : "at"} ${g.home.short === r.team ? g.away.short : g.home.short} · ${g.status === "final" ? `Final, ${kickoffWhen(g.kickoff)} ET` : `${kickoffWhen(g.kickoff)} ET`}`
            : `${i + 1}. idle this week`;
          return (
            <li key={r.id}>
              <ProspectCard p={p} team={team} gameLabel={label} gameHref={g ? `/game/${g.id}` : "/radar"} compact />
            </li>
          );
        })}
      </ol>

      {loaded && pool.length > players.length && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-chalk-3">Showing {players.length} of {pool.length} on the radar for this class, division, and position. Every name is in here; search finds anyone.</span>
          <Link href={href({ ...base, all: "1" })} className="chip">Show all {pool.length}</Link>
        </div>
      )}
      {loaded && showAll && (
        <div className="mt-4">
          <Link href={href({ ...base, all: undefined })} className="chip">Show top 60</Link>
        </div>
      )}

      {loaded && (
        <section className="mt-10 grid gap-2 text-xs text-chalk-3 sm:grid-cols-2">
          <div className="card p-4">
            <p className="eyebrow">How the radar score works</p>
            <p className="mt-1 leading-relaxed">
              Production is a percentile against every player at the same position in the same division, using per-game rates where volume matters. Pedigree uses the public recruiting rating. Usage is the share of team plays. Size compares height and weight to NFL norms by position. At running back, quarterback, tight end, and interior defensive line the score is 55% production, 22% pedigree, 13% usage, 10% size. Everywhere else it is 35% production, 42% pedigree, 13% usage, 10% size, because four seasons of NFL outcomes show scouts draft traits at receiver, corner, safety, linebacker, and edge. Then it is scaled by level of play (FCS, DII, DIII). Linemen have no box-score stats, so their score leans on pedigree, size, and class.
            </p>
          </div>
          <div className="card p-4">
            <p className="eyebrow">What it is not</p>
            <p className="mt-1 leading-relaxed">
              It is not a mock draft and it does not know about injuries, character, or film. A junior listed in {nextDraft} may stay in school. Use it to decide who to watch on Saturday, then watch the player. Follow anyone here and their games land on your watchlist.
            </p>
          </div>
        </section>
      )}

      <p className="mt-6 text-xs text-chalk-3">
        Position groups: {GROUPS.map((g) => `${g} = ${GROUP_LABEL[g]}`).join(", ")}.
      </p>
    </div>
  );
}
