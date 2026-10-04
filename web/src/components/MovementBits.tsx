/**
 * Plain movement pieces with no data imports, safe in any component (server or client).
 */

/* ------------------------------------------------------------ plain pieces */

/** Small arrow with the score delta vs the previous snapshot. Renders nothing when there is no previous snapshot. */
export function DeltaArrow({ delta, size = "sm" }: { delta: number | null | undefined; size?: "sm" | "lg" }) {
  if (delta === null || delta === undefined || delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`mono inline-flex items-center gap-0.5 font-semibold ${up ? "text-turf" : "text-brick"} ${size === "lg" ? "text-base" : "text-xs"}`} title="Radar score change since the previous weekly snapshot">
      <svg viewBox="0 0 10 10" className={size === "lg" ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} aria-hidden>
        {up ? <path d="M5 1 L9 7 L1 7 Z" fill="currentColor" /> : <path d="M5 9 L1 3 L9 3 Z" fill="currentColor" />}
      </svg>
      {Math.abs(delta)}
    </span>
  );
}

/** Inline SVG sparkline of a score series. */
export function Sparkline({ points, width = 160, height = 36 }: { points: { date: string; score: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const xs = points.map((_, i) => (i / (points.length - 1)) * (width - 6) + 3);
  const min = Math.min(...points.map((p) => p.score));
  const max = Math.max(...points.map((p) => p.score));
  const span = Math.max(4, max - min);
  const ys = points.map((p) => height - 3 - ((p.score - min) / span) * (height - 6));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const tone = last.score > first.score ? "var(--color-turf, #2f7a3a)" : last.score < first.score ? "var(--color-brick, #b23a3a)" : "currentColor";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="text-chalk-3" role="img" aria-label={`Radar score from ${first.score} to ${last.score} over ${points.length} snapshots`}>
      <path d={d} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2.2" fill={tone} />
    </svg>
  );
}
