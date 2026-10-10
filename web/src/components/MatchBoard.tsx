import Link from "next/link";
import Image from "next/image";
import type { Team } from "@/lib/types";
import { tierOf, type BoardRow, type MatchBoard as Board, type Name, type SideRow, type TeamContext } from "@/lib/matchboard";
import { asOf } from "@/lib/format";
import { Fold } from "./Section";

/**
 * The five-row matchup board on the game page. Same rows, same order, same format for every game:
 * each row shows the away offense against the home defense, and the home offense against the away
 * defense. Nothing that explains a rank is hidden: every stat shows with its own rank, each unit gets
 * a plain-English read, and the schedule each team has played sits on top.
 */
export function MatchBoard({ board, away, home }: { board: Board; away: Team; home: Team }) {
  const teamOf = (school: string) => (school === away.short ? away : home);
  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-2 md:grid-cols-2">
        <Schedule team={away} c={board.context.away} />
        <Schedule team={home} c={board.context.home} />
      </div>
      {board.rows.map((row) => (
        <Row key={row.key} row={row} teamOf={teamOf} />
      ))}
      <p className="text-xs text-chalk-3">
        Each rank is for that unit only, out of every FBS team, 1 = best for that side. Elite is the top 10%, good the top 30%, below average the bottom 30%, bad the
        bottom 10%. Team stats{board.statsAsOf ? ` as of ${asOf(board.statsAsOf)} ET` : ""}, not adjusted for opponents (the schedule line above says which way that cuts).
        Edge at a 20-point percentile gap, clear at 40, mismatch at 55. Names are each side&apos;s top radar player at those positions (red zone: touchdown leader and leading tackler).
      </p>
    </div>
  );
}

const tierTone = (t: string) =>
  t === "Elite" || t === "Good" ? "text-turf" : t === "Below average" ? "text-[#b45309]" : t === "Bad" ? "text-brick" : "text-chalk-2";

function Schedule({ team, c }: { team: Team; c: TeamContext }) {
  const tough = c.sosRank != null && c.sosRank <= 30;
  const soft = c.sosRank != null && c.of > 0 && c.sosRank > c.of - 30;
  return (
    <div className="card flex items-start gap-3 p-3">
      <Logo team={team} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-chalk">
          {team.short}: {c.games ?? "?"} games in these stats
          {c.sosRank != null && (
            <>
              , schedule No. {c.sosRank} toughest of {c.of}
            </>
          )}
        </p>
        <p className="text-xs text-chalk-3">
          {c.toughest.length ? `Best opponents: ${c.toughest.join(", ")}. ` : "No top opponents yet. "}
          {tough
            ? `Tough schedule, so ${team.short}'s ranks probably undersell it.`
            : soft
              ? `Soft schedule, so ${team.short}'s ranks probably flatter it.`
              : "Middle-of-the-road schedule; the ranks are a fair read."}
        </p>
      </div>
    </div>
  );
}

function Row({ row, teamOf }: { row: BoardRow; teamOf: (school: string) => Team }) {
  return (
    <section className="card overflow-hidden">
      <h3 className="display border-b border-line bg-panel-2 px-4 py-2 text-xl font-bold text-chalk">{row.title}</h3>
      <div className="grid md:grid-cols-2 md:divide-x md:divide-line">
        <Side s={row.away} row={row} off={teamOf(row.away.offense)} def={teamOf(row.away.defense)} />
        <Side s={row.home} row={row} off={teamOf(row.home.offense)} def={teamOf(row.home.defense)} />
      </div>
    </section>
  );
}

function Side({ s, row, off, def }: { s: SideRow; row: BoardRow; off: Team; def: Team }) {
  const winner = s.edge === "offense" ? off : s.edge === "defense" ? def : undefined;
  const chip =
    s.strength === "mismatch" ? "bg-brick text-white" : s.strength === "clear" ? "bg-navy text-white" : s.strength === "edge" ? "bg-ink-2 text-chalk" : "bg-ink-2 text-chalk-3";
  const verdict = winner ? `${s.strength === "mismatch" ? "Mismatch" : s.strength === "clear" ? "Clear edge" : "Edge"} ${winner.abbr}` : "Even";
  return (
    <div className="border-t border-line p-4 first:border-t-0 md:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">
          {off.abbr} offense vs {def.abbr} defense
        </p>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${chip}`}>{verdict}</span>
      </div>

      <div className="mt-2 flex items-stretch gap-2">
        <Unit team={off} label={s.qb ? "QB" : row.offLabel} rank={s.offRank} of={s.offOf ?? s.of} win={winner === off} lose={winner === def} />
        <span className="self-center text-xs text-chalk-3">vs</span>
        <Unit team={def} label={row.defLabel} rank={s.defRank} of={s.of} win={winner === def} lose={winner === off} />
      </div>

      {s.qb ? (
        <QbBlock s={s} off={off} def={def} defLabel={row.defLabel} />
      ) : (
      <>
      <ul className="mt-2 grid gap-1 text-sm leading-snug">
        <li>
          <span className="font-semibold text-chalk">{off.abbr} {row.offLabel}:</span> <span className="text-chalk-2">{s.offRead}</span>
        </li>
        <li>
          <span className="font-semibold text-chalk">{def.abbr} {row.defLabel}:</span> <span className="text-chalk-2">{s.defRead}</span>
        </li>
      </ul>

      {s.stats.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-chalk-3">
              <th className="py-1 pr-2 font-semibold">Stat</th>
              <th className="py-1 pr-2 text-right font-semibold">{off.abbr}</th>
              <th className="py-1 text-right font-semibold">{def.abbr}</th>
            </tr>
          </thead>
          <tbody>
            {s.stats.map((x) => (
              <tr key={x.offName} className="border-t border-line/60">
                <td className="py-1 pr-2 text-chalk-2">{x.offName.replace(" allowed", "")}</td>
                <td className="mono whitespace-nowrap py-1 pr-2 text-right">
                  <span className="text-chalk">{x.off}</span> <Rank rank={x.offRank} of={s.of} />
                </td>
                <td className="mono whitespace-nowrap py-1 text-right">
                  <span className="text-chalk">{x.def}</span> <Rank rank={x.defRank} of={s.of} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </>
      )}

      {(s.offName || s.defName) && (
        <p className="mt-2 text-sm text-chalk-2">
          <Player p={s.offName} /> <span className="text-chalk-3">vs</span> <Player p={s.defName} />
        </p>
      )}

      <p className="mt-2 text-sm leading-snug text-chalk">
        <span className="eyebrow mr-1">Watch</span>
        {s.watch}
      </p>
    </div>
  );
}

/** Quarterback row: the starter on his own numbers, ranked among FBS starters, and the pass defense he faces. */
function QbBlock({ s, off, def, defLabel }: { s: SideRow; off: Team; def: Team; defLabel: string }) {
  const q = s.qb!;
  return (
    <div className="mt-2 grid gap-2 text-sm">
      <p className="leading-snug">
        <span className="font-semibold text-chalk">{q.name}</span>{" "}
        <span className="rounded bg-ink-2 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-chalk">{q.type}</span>{" "}
        <span className="text-chalk-2">
          Ranks No. {q.rank} of {q.of} FBS quarterbacks once you credit the defenses he has faced.
          {q.rawRank !== q.rank && (
            <>
              {" "}On his numbers alone he is No. {q.rawRank}
              {q.rawRank > q.rank ? ", so he has done it against tougher defenses than most." : ", so his numbers came against easier defenses than most."}
            </>
          )}
        </span>
      </p>
      <p className="text-xs text-chalk-3">{q.why}. Ranked against the {q.of} FBS quarterbacks who throw at least 8 passes a game, which leaves out backups.</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-chalk-3">
            <th className="py-1 pr-2 font-semibold">{off.abbr} QB</th>
            <th className="py-1 text-right font-semibold">Rank among {q.of} QBs</th>
          </tr>
        </thead>
        <tbody>
          {q.line.map((x) => (
            <tr key={x.label} className="border-t border-line/60">
              <td className="py-1 pr-2 text-chalk-2">{x.label}</td>
              <td className="mono whitespace-nowrap py-1 text-right">
                <span className="text-chalk">{x.value}</span> <Rank rank={x.rank} of={q.of} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.games.length > 0 && (
        <Fold label="Game by game: how the defenses he faced move his rank">
          <p className="mt-1 text-xs text-chalk-3">
            Each game gets a score from his line. That score is multiplied by how tough the defense was, half its pass coverage and half its pass rush:
            the best defense in the country counts 1.5 times, an average one 1 time, the worst (or an FCS team) 0.6 times. His rank blends his plain numbers
            and these adjusted ones half and half.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-chalk-3">
                  <th className="py-1 pr-2 font-semibold">Opponent</th>
                  <th className="py-1 pr-2 text-right font-semibold">Coverage</th>
                  <th className="py-1 pr-2 text-right font-semibold">Pass rush</th>
                  <th className="py-1 pr-2 text-right font-semibold">Counts</th>
                  <th className="py-1 pr-2 font-semibold">His line</th>
                  <th className="py-1 text-right font-semibold">Score</th>
                </tr>
              </thead>
              <tbody>
                {q.games.map((g) => (
                  <tr key={`${g.week}-${g.opponent}`} className="border-t border-line/60 align-top">
                    <td className="py-1 pr-2 text-chalk">
                      {g.homeAway === "away" ? "at " : "vs "}
                      {g.opponent}
                      <span className="block text-[10px] text-chalk-3">Week {g.week}</span>
                    </td>
                    <td className="mono py-1 pr-2 text-right">{g.coverRank != null ? <Rank rank={g.coverRank} of={138} /> : <span className="text-chalk-3">FCS</span>}</td>
                    <td className="mono py-1 pr-2 text-right">{g.rushRank != null ? <Rank rank={g.rushRank} of={138} /> : <span className="text-chalk-3">FCS</span>}</td>
                    <td className={`mono py-1 pr-2 text-right font-semibold ${g.weight > 1.02 ? "text-turf" : g.weight < 0.98 ? "text-brick" : "text-chalk-2"}`}>x{g.weight.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-chalk-2">{g.line}</td>
                    <td className="mono whitespace-nowrap py-1 text-right text-chalk">
                      {g.raw} <span className="text-chalk-3">to</span> {g.adjusted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.rawAvg != null && q.adjAvg != null && (
            <p className="mt-1 text-xs text-chalk-2">
              Average game score {q.rawAvg} before, {q.adjAvg} after the defenses are counted.{" "}
              {q.adjAvg > q.rawAvg ? "His schedule was tougher than average, so his rank goes up." : q.adjAvg < q.rawAvg ? "His schedule was easier than average, so his rank comes down." : ""}
            </p>
          )}
        </Fold>
      )}
      <p className="leading-snug">
        <span className="font-semibold text-chalk">{def.abbr} {defLabel}:</span> <span className="text-chalk-2">{s.defRead}</span>
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-chalk-3">
            <th className="py-1 pr-2 font-semibold">{def.abbr} pass defense</th>
            <th className="py-1 text-right font-semibold">Rank of {s.of} teams</th>
          </tr>
        </thead>
        <tbody>
          {s.stats.map((x) => (
            <tr key={x.defName} className="border-t border-line/60">
              <td className="py-1 pr-2 text-chalk-2">{x.defName}</td>
              <td className="mono whitespace-nowrap py-1 text-right">
                <span className="text-chalk">{x.def}</span> <Rank rank={x.defRank} of={s.of} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rank({ rank, of }: { rank: number; of: number }) {
  return <span className={`font-semibold ${tierTone(tierOf(rank, of))}`}>No. {rank}</span>;
}

function Logo({ team }: { team: Team }) {
  return team.logo ? (
    <Image src={team.logo} alt="" width={22} height={22} className="mt-0.5 h-[22px] w-[22px] shrink-0 object-contain" unoptimized />
  ) : (
    <span className="display text-sm font-bold" style={{ color: team.color }}>{team.abbr}</span>
  );
}

function Unit({ team, label, rank, of, win, lose }: { team: Team; label: string; rank: number; of: number; win: boolean; lose: boolean }) {
  const tier = tierOf(rank, of);
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1.5 ${win ? "border-turf bg-turf/5" : "border-line"} ${lose ? "opacity-70" : ""}`}>
      <Logo team={team} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-chalk-3">{team.abbr} {label}</span>
        <span className="display text-lg font-bold text-chalk">No. {rank}</span> <span className="mono text-[10px] text-chalk-3">of {of}</span>
        <span className={`block text-[11px] font-semibold ${tierTone(tier)}`}>{tier}</span>
      </span>
    </span>
  );
}

function Player({ p }: { p?: Name }) {
  if (!p) return <span className="text-chalk-3">no radar name</span>;
  return (
    <Link href={`/player/${p.id}`} className="font-semibold text-chalk hover:text-sky">
      {p.name} <span className="font-normal text-chalk-3">({p.pos})</span>
    </Link>
  );
}
