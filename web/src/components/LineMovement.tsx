import type { GameOdds } from "@/lib/odds";
import type { Team } from "@/lib/types";
import { asOf, mlText } from "@/lib/format";

/**
 * Line movement from The Odds API snapshots: a movement sentence, two inline
 * SVG sparklines (consensus spread and total over time), and the per-book
 * table from the latest snapshot. Server component; everything is plain data.
 */
export function LineMovement({ odds, home, away }: { odds: GameOdds; home: Team; away: Team }) {
  if (odds.keyMissing) {
    return (
      <div className="card mt-4 border-l-4 border-l-warn p-4">
        <p className="eyebrow">Line movement</p>
        <p className="mt-1 text-sm text-chalk">Add <span className="mono">ODDS_API_KEY</span> to <span className="mono">.env.local</span> to track line movement across books, closing lines, and player props.</p>
        <p className="mt-1 text-xs text-chalk-3">Free tier at the-odds-api.com is 500 credits a month. A slate snapshot costs 3, a props pull costs 4.</p>
      </div>
    );
  }
  const spreadPts = odds.history.filter((h) => h.spread !== undefined);
  const totalPts = odds.history.filter((h) => h.total !== undefined);
  const latest = odds.latest;
  const favLabel = (homeSpread: number | undefined) => {
    if (homeSpread === undefined) return "–";
    if (homeSpread === 0) return "PK";
    return homeSpread < 0 ? `${home.abbr} ${fmt(homeSpread)}` : `${away.abbr} ${fmt(-homeSpread)}`;
  };
  const books = latest ? [...latest.perBook].sort((a, b) => (a.spread ?? 99) - (b.spread ?? 99)) : [];

  return (
    <div className="card mt-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Line movement · The Odds API</p>
        {odds.asOf && <span className="mono text-xs text-chalk-3">checked {asOf(odds.asOf)}{odds.usage?.remaining !== undefined ? ` · ${odds.usage.remaining} credits left` : ""}</span>}
      </div>
      <p className="mt-1 text-base text-chalk">{odds.movement}</p>
      {odds.note && <p className="mt-1 text-xs text-chalk-3">{odds.note}</p>}

      {odds.history.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Spark title="Consensus spread" points={spreadPts.map((h) => ({ at: h.at, v: h.spread! }))} label={favLabel} />
          <Spark title="Consensus total" points={totalPts.map((h) => ({ at: h.at, v: h.total! }))} label={(v) => (v === undefined ? "–" : fmt(v))} />
        </div>
      )}

      {(odds.opening || odds.closing) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {odds.opening && <Mini label="Opening snapshot" value={`${favLabel(odds.opening.spread)}${odds.opening.total !== undefined ? ` · ${fmt(odds.opening.total)}` : ""}`} sub={`${asOf(odds.opening.at)} · ${odds.opening.books} books`} />}
          {odds.closing && (
            <Mini
              label="Closing line"
              value={`${favLabel(odds.closing.spread)}${odds.closing.total !== undefined ? ` · ${fmt(odds.closing.total)}` : ""}`}
              sub={odds.closing.hoursBeforeKick !== undefined && odds.closing.hoursBeforeKick > 3 ? `last snapshot ${odds.closing.hoursBeforeKick} h before kick; not a true close` : `${asOf(odds.closing.at)} · ${odds.closing.books} books`}
            />
          )}
          <Mini label="Snapshots" value={String(odds.history.length)} sub={`${odds.books} books in the latest`} />
        </div>
      )}

      {books.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-wider text-chalk-3">
                <th className="py-1 pr-3 font-semibold">Book</th>
                <th className="py-1 pr-3 font-semibold">Spread</th>
                <th className="py-1 pr-3 font-semibold">Total</th>
                <th className="py-1 pr-3 font-semibold">ML {home.abbr}</th>
                <th className="py-1 pr-3 font-semibold">ML {away.abbr}</th>
                <th className="py-1 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="mono">
              {books.map((b) => (
                <tr key={b.book} className="border-t border-line">
                  <td className="py-1 pr-3 text-chalk">{b.title}</td>
                  <td className="py-1 pr-3 text-chalk">
                    {favLabel(b.spread)}
                    {b.spreadPrice !== undefined && <span className="text-chalk-3"> ({mlText(b.spreadPrice)})</span>}
                  </td>
                  <td className="py-1 pr-3 text-chalk">
                    {b.total !== undefined ? fmt(b.total) : "–"}
                    {b.overPrice !== undefined && b.underPrice !== undefined && <span className="text-chalk-3"> (o{mlText(b.overPrice)} / u{mlText(b.underPrice)})</span>}
                  </td>
                  <td className="py-1 pr-3 text-chalk">{b.mlHome !== undefined ? mlText(b.mlHome) : "–"}</td>
                  <td className="py-1 pr-3 text-chalk">{b.mlAway !== undefined ? mlText(b.mlAway) : "–"}</td>
                  <td className="py-1 text-xs text-chalk-3">{b.updated ? asOf(b.updated) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-chalk-3">Spread is shown from the favorite&apos;s side with the price for that side. Consensus is the median across books, rounded to the half point. Game context, not a pick.</p>
        </div>
      )}
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-line bg-panel-2 p-3">
      <p className="eyebrow">{label}</p>
      <p className="mono mt-1 text-lg text-chalk">{value}</p>
      {sub && <p className="mono mt-0.5 text-xs text-chalk-3">{sub}</p>}
    </div>
  );
}

/** Inline SVG sparkline. Opening point hollow, latest point filled. */
function Spark({ title, points, label }: { title: string; points: { at: string; v: number }[]; label: (v: number | undefined) => string }) {
  const W = 320;
  const H = 72;
  const PAD = 8;
  if (!points.length) {
    return (
      <div className="rounded border border-line bg-panel-2 p-3">
        <p className="eyebrow">{title}</p>
        <p className="mt-1 text-sm text-chalk-3">No snapshots with this number.</p>
      </div>
    );
  }
  const times = points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const vals = points.map((p) => p.v);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const span = Math.max(1, vMax - vMin);
  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - vMin) / span) * (H - PAD * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const moved = last.v - first.v;
  return (
    <div className="rounded border border-line bg-panel-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="eyebrow">{title}</p>
        <p className="mono text-xs text-chalk-3">
          {label(first.v)} to {label(last.v)}
          {moved !== 0 && <span className={moved > 0 ? " text-turf" : " text-brick"}> ({moved > 0 ? "+" : ""}{fmt(moved)})</span>}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-16 w-full" role="img" aria-label={`${title}: ${points.length} snapshots from ${label(first.v)} to ${label(last.v)}`}>
        <line x1={PAD} x2={W - PAD} y1={y(first.v)} y2={y(first.v)} stroke="currentColor" className="text-line" strokeDasharray="3 3" />
        <path d={d} fill="none" stroke="currentColor" className="text-navy" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.at} cx={x(times[i])} cy={y(p.v)} r={i === points.length - 1 ? 3.5 : 2} fill={i === 0 ? "white" : "currentColor"} stroke="currentColor" className="text-navy" strokeWidth={1.5} />
        ))}
      </svg>
      <div className="mono flex justify-between text-[10px] text-chalk-3">
        <span>{asOf(first.at)}</span>
        <span>{points.length} snapshots</span>
        <span>{asOf(last.at)}</span>
      </div>
    </div>
  );
}
