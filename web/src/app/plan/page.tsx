import Link from "next/link";
import { getPlan } from "@/lib/plan-load";
import { asOf } from "@/lib/format";
import { longDate } from "@/lib/plan";
import { telegramReady } from "@/lib/telegram";
import { isOwner } from "@/lib/owner";
import { LivePoller } from "@/components/LivePoller";
import { SendToTelegram } from "@/components/SendToTelegram";

export const dynamic = "force-dynamic";

/**
 * /plan?date=YYYY-MM-DD. Minute-by-minute (30-minute blocks) viewing plan for
 * the day's Division I slate, bent toward followed teams and players, with a
 * recommended game per block and up to two switch triggers. Refreshes every
 * 60 seconds while any game is live.
 */
export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const sp = await searchParams;
  const dateParam = typeof sp.date === "string" ? sp.date : undefined;
  const { plan, slate } = await getPlan(dateParam);
  const idx = slate.days.findIndex((d) => d.date === plan.date);
  const prev = idx > 0 ? slate.days[idx - 1] : undefined;
  const next = idx >= 0 && idx < slate.days.length - 1 ? slate.days[idx + 1] : undefined;
  const nowBlock = plan.blocks.find((b) => b.status === "now");
  const gameById = new Map(slate.games.map((g) => [g.id, g]));

  return (
    <article className="rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Saturday plan</p>
          <h1 className="display mt-1 text-5xl font-extrabold leading-none text-chalk sm:text-6xl">{longDate(plan.date)}</h1>
          <p className="mt-2 text-sm text-chalk-3">
            {plan.gamesConsidered} Division I games in {plan.blocks.length} half-hour blocks. Following {plan.followedTeams.length} {plan.followedTeams.length === 1 ? "team" : "teams"} and {plan.followedPlayers.length} {plan.followedPlayers.length === 1 ? "player" : "players"}.
            {" "}Built {asOf(plan.generatedAt)}. <LivePoller active={plan.liveNow} label="live, plan updates every minute" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {prev && <Link href={`/plan?date=${prev.date}`} className="chip">← {prev.date}</Link>}
          {next && <Link href={`/plan?date=${next.date}`} className="chip">{next.date} →</Link>}
          {(await isOwner()) && <SendToTelegram type="plan" date={plan.date} enabled={telegramReady()} size="md" />}
        </div>
      </div>

      {(plan.followedTeams.length > 0 || plan.followedPlayers.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
          {plan.followedTeams.map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
          {plan.followedPlayers.map((p) => (
            <Link key={p.id} href={`/player/${p.id}`} className="chip hover:text-sky">
              {p.name} <span className="text-chalk-3">{p.team} {p.pos}</span>{p.gameId ? "" : <span className="text-chalk-3"> · no game today</span>}
            </Link>
          ))}
        </div>
      )}

      {nowBlock?.pick && (
        <section className="card mt-6 border-l-4 border-l-turf p-4">
          <p className="eyebrow text-turf">Right now, {nowBlock.label}</p>
          <Link href={`/game/${nowBlock.pick.gameId}`} className="display mt-1 block text-3xl font-bold leading-tight text-chalk hover:text-flag sm:text-4xl">
            {nowBlock.pick.label}
          </Link>
          <p className="mono mt-1 text-xs text-chalk-3">{nowBlock.pick.network}{nowBlock.pick.liveLine ? ` · ${nowBlock.pick.liveLine}` : ""}</p>
          <p className="mt-2 text-base text-chalk-2">{nowBlock.pick.why}</p>
          {nowBlock.triggers.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm text-chalk">
              {nowBlock.triggers.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {plan.blocks.length === 0 ? (
        <p className="mt-8 text-sm text-chalk-3">No Division I games on this date. Pick another day above.</p>
      ) : (
        <ol className="mt-8 grid gap-1.5">
          {plan.blocks.map((b) => {
            const g = b.pick ? gameById.get(b.pick.gameId) : undefined;
            const tone = b.status === "now" ? "border-turf bg-turf/5" : b.status === "past" ? "border-line opacity-60" : "border-line";
            return (
              <li key={b.start} id={b.status === "now" ? "now" : undefined} className={`grid grid-cols-[4.5rem_1fr] gap-3 rounded border p-3 sm:grid-cols-[5.5rem_1fr] ${tone}`}>
                <div>
                  <span className="mono text-sm text-chalk">{b.label}</span>
                  <span className="mono mt-0.5 block text-[10px] uppercase tracking-wide text-chalk-3">{b.status === "now" ? "now" : b.status === "past" ? "done" : ""}</span>
                </div>
                {b.pick ? (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Link href={`/game/${b.pick.gameId}`} className="display text-2xl font-bold leading-none text-chalk hover:text-flag">
                        {b.pick.label}
                      </Link>
                      <span className="mono text-xs text-chalk-3">{b.pick.network}</span>
                      {b.pick.status === "live" && <span className="mono text-xs text-turf">{b.pick.liveLine ?? "live"}</span>}
                      {b.pick.status === "final" && g?.score && <span className="mono text-xs text-brick">Final {g.away.abbr} {g.score.away}, {g.home.abbr} {g.score.home}</span>}
                    </div>
                    <p className="mt-1 text-sm text-chalk-2">{b.pick.why}</p>
                    {b.triggers.length > 0 && (
                      <ul className="mt-1.5 grid gap-0.5 text-sm text-chalk">
                        {b.triggers.map((t) => (
                          <li key={t} className="flex gap-2">
                            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy" />
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {b.others.length > 0 && (
                      <p className="mono mt-1.5 text-[11px] text-chalk-3">
                        Also on: {b.others.map((o) => `${o.short}${o.network ? ` (${o.network})` : ""}`).join(", ")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-chalk-3">Nothing on.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <section className="mt-8">
        <p className="eyebrow">How the plan is built</p>
        <ul className="mt-2 grid gap-1 text-xs text-chalk-3">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
