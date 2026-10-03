import type { Game, ScoreComponents } from "./types";

export const WEIGHTS: Record<keyof ScoreComponents, number> = {
  draftTalent: 0.35,
  directMatchups: 0.2,
  futureTalent: 0.15,
  // 2022-2025 backtest: competitive expectation tracks the excitement index (+0.35); style contrast runs the wrong way (-0.10).
  competitive: 0.2,
  styleContrast: 0.0,
  storylines: 0.05,
  availability: 0.05,
};

export const COMPONENT_LABELS: Record<keyof ScoreComponents, string> = {
  draftTalent: "Draft talent",
  directMatchups: "Direct matchups",
  futureTalent: "Future talent",
  competitive: "Competitive expectation",
  styleContrast: "Style contrast",
  storylines: "Storylines",
  availability: "Availability",
};

export const COMPONENT_KEYS = Object.keys(WEIGHTS) as (keyof ScoreComponents)[];

/**
 * Each component is scored 0 to 100, then weighted. A null component means the
 * input does not exist yet (no charting, no prospect file). Those are excluded
 * and the remaining weights are renormalized so a game is not punished for
 * data the product has not ingested. The breakdown shows which were excluded.
 */
export function scoutScore(c: ScoreComponents): number {
  let sum = 0;
  let weight = 0;
  for (const k of COMPONENT_KEYS) {
    const v = c[k];
    if (v === null || v === undefined) continue;
    sum += v * WEIGHTS[k];
    weight += WEIGHTS[k];
  }
  if (weight === 0) return 0;
  return Math.round(sum / weight);
}

export function availableWeight(c: ScoreComponents): number {
  return COMPONENT_KEYS.reduce((w, k) => (c[k] === null || c[k] === undefined ? w : w + WEIGHTS[k]), 0);
}

export type ScoreTag = "Marquee" | "Hidden Gem" | "Prospect Heavy" | "Solid" | "Thin";

export function scoreTag(g: Game): ScoreTag {
  const s = scoutScore(g.scoreComponents);
  // Marquee = national over-the-air or flagship cable. Everything else can be a Hidden Gem.
  const marquee = g.division === "FBS" && /^(ABC|CBS|FOX|NBC|ESPN|TNT|Peacock)$/i.test(g.network.trim());
  if (s >= 75 && !marquee) return "Hidden Gem";
  if (s >= 80) return "Marquee";
  if ((g.scoreComponents.draftTalent ?? 0) >= 70) return "Prospect Heavy";
  if (s >= 55) return "Solid";
  return "Thin";
}

export function prospectCounts(g: Game) {
  const likely = g.prospects.filter((p) => p.tier === "Established" || p.tier === "Emerging" || p.tier === "Eligible").length;
  const future = g.prospects.filter((p) => p.tier === "Future" || p.tier === "Sleeper" || p.tier === "Watch only" || p.tier === "Watch").length;
  return { likely, future };
}
