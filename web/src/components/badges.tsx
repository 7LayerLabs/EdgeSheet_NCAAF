import type { Coverage, GameStatus } from "@/lib/types";

export function CoverageBadge({ level }: { level: Coverage }) {
  const tone =
    level === "Full" ? "border-turf/50 text-turf" : level === "Standard" ? "border-sky/50 text-sky" : "border-chalk-3/50 text-chalk-3";
  return (
    <span className={`mono inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
      <span aria-hidden>{level === "Full" ? "●●●" : level === "Standard" ? "●●○" : "●○○"}</span>
      {level}
    </span>
  );
}

export function StatusPill({ status, clock }: { status: GameStatus; clock?: string }) {
  if (status === "live")
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-turf">
        <span className="live-dot" /> Live · {clock}
      </span>
    );
  if (status === "final") return <span className="mono text-xs uppercase tracking-wider text-chalk-3">Final</span>;
  return null;
}

export function DivisionTag({ d }: { d: string }) {
  return <span className="mono rounded bg-ink-2 px-1.5 py-0.5 text-[10px] tracking-wider text-chalk-3">{d}</span>;
}

export function Tier({ tier }: { tier: string }) {
  const tone: Record<string, string> = {
    Established: "bg-flag text-ink",
    Emerging: "bg-sky/20 text-sky",
    Future: "bg-turf/20 text-turf",
    Sleeper: "bg-brick/20 text-brick",
    "Watch only": "bg-panel-2 text-chalk-3",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone[tier]}`}>{tier}</span>;
}

export function Confidence({ level }: { level: "High" | "Medium" | "Low" }) {
  const dots = level === "High" ? "●●●" : level === "Medium" ? "●●○" : "●○○";
  return (
    <span className="mono text-[10px] text-chalk-3" title={`${level} confidence`}>
      {dots} {level}
    </span>
  );
}
