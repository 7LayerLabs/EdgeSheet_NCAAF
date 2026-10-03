/**
 * Game projection: a predicted outcome from pregame Elo, the four unit edges,
 * and the market. It is a model, not a pick, and the page says so. Every
 * projection is locked pregame and graded after the final on the Record page.
 */
import type { Market, Matchup, Team } from "./types";

export interface Projection {
  winner: string; // abbr
  winProb: number; // 0..1 for the winner
  margin: number; // points, positive for winner
  total: number;
  home: number;
  away: number;
  shape: string; // one sentence on how the game plays
  vsMarket?: string; // where the model disagrees with the number
  modelSide?: string; // abbr the model leans toward against the spread
  basis: string[];
  confidence: "high" | "medium" | "low";
}

const HOME_ELO = 65; // typical college home-field edge in Elo points
const ELO_PER_POINT = 28; // Elo difference per point of spread, college scale
const SIGMA = 16; // standard deviation of college margins

function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const probFromMargin = (m: number) => 0.5 * (1 + erf(m / (SIGMA * Math.SQRT2)));

interface Input {
  home: Team;
  away: Team;
  homeElo: number | null;
  awayElo: number | null;
  neutral: boolean;
  market: Market;
  matchups: Matchup[]; // from unitEdges, a = "<school> run game" etc.
  homeSchool: string;
  awaySchool: string;
  homePassRate?: number | null;
  awayPassRate?: number | null;
}

export function projectGame(i: Input): Projection | undefined {
  const basis: string[] = [];
  let eloMargin: number | undefined;
  if (i.homeElo != null && i.awayElo != null) {
    const diff = i.homeElo + (i.neutral ? 0 : HOME_ELO) - i.awayElo;
    eloMargin = diff / ELO_PER_POINT;
    basis.push(`Pregame Elo: ${i.home.abbr} ${i.homeElo}, ${i.away.abbr} ${i.awayElo}${i.neutral ? ", neutral site" : `, +${HOME_ELO} home field`} → ${eloMargin >= 0 ? i.home.abbr : i.away.abbr} by ${Math.abs(eloMargin).toFixed(1)}`);
  }

  // Tendencies: net percentile gap across the unit edges, scaled to points. Four axes, each up to 100, so +-400 → +-10.
  let tendMargin: number | undefined;
  if (i.matchups.length) {
    const gapOf = (m: Matchup) => {
      const g = Number((m.evidence.match(/gap (\d+) percentile/) ?? [])[1] ?? 0);
      return m.edge === "offense" ? g : m.edge === "defense" ? -g : 0;
    };
    let net = 0;
    for (const m of i.matchups) {
      const homeOffense = m.a.startsWith(i.homeSchool);
      const g = gapOf(m); // positive favors the offense in that matchup
      net += homeOffense ? g : -g;
    }
    tendMargin = net / 40;
    basis.push(`Unit edges: net ${net >= 0 ? "+" : ""}${net} percentile points to ${net >= 0 ? i.home.abbr : i.away.abbr} across ${i.matchups.length} matchups → ${net >= 0 ? i.home.abbr : i.away.abbr} by ${Math.abs(tendMargin).toFixed(1)}`);
  }

  const marketMargin = i.market.spread ? (i.market.spread.team === i.home.abbr ? -i.market.spread.line : i.market.spread.line) : undefined; // positive = home favored
  if (marketMargin !== undefined) basis.push(`Market: ${i.market.spread!.team} ${i.market.spread!.line}${i.market.total ? `, total ${i.market.total.line}` : ""}`);

  let margin: number;
  let confidence: Projection["confidence"];
  if (eloMargin !== undefined && tendMargin !== undefined) {
    margin = 0.6 * eloMargin + 0.4 * tendMargin;
    confidence = "high";
  } else if (eloMargin !== undefined) {
    margin = eloMargin;
    confidence = "medium";
  } else if (tendMargin !== undefined) {
    margin = tendMargin;
    confidence = "low";
  } else if (marketMargin !== undefined) {
    margin = marketMargin;
    confidence = "low";
    basis.push("No rating or tendency data; projection follows the market.");
  } else {
    return undefined;
  }

  const total = i.market.total?.line ?? 50;
  if (!i.market.total) basis.push("No market total; 50 assumed for the score line.");
  const homePts = Math.max(0, Math.round((total + margin) / 2));
  const awayPts = Math.max(0, Math.round(total - homePts));
  const homeWins = margin >= 0;
  const winner = homeWins ? i.home.abbr : i.away.abbr;
  const winProb = probFromMargin(Math.abs(margin));

  // Shape of the game from pass rates and the line-of-scrimmage edges.
  const hp = i.homePassRate ?? 0.5;
  const ap = i.awayPassRate ?? 0.5;
  const lineEdges = i.matchups.filter((m) => /offensive line|run game/i.test(m.a) && m.edge !== "even");
  let shape: string;
  if (hp <= 0.45 && ap <= 0.45) shape = "Two run-first offenses: fewer possessions, a lower-variance game where the first turnover matters more than usual.";
  else if (hp >= 0.56 && ap >= 0.56) shape = "Two pass-first offenses: more possessions, more variance, and the total has room on the high side if either secondary breaks.";
  else if (lineEdges.length >= 2 && lineEdges.every((m) => m.a.startsWith(winner === i.home.abbr ? i.homeSchool : i.awaySchool) ? m.edge === "offense" : m.edge === "defense"))
    shape = `${winner} controls the line of scrimmage on both sides. Expect them to shorten the game once ahead.`;
  else shape = "Balanced styles. The unit edges above decide it more than tempo does.";

  // Where the model disagrees with the number.
  let vsMarket: string | undefined;
  let modelSide: string | undefined;
  if (marketMargin !== undefined) {
    const diff = margin - marketMargin; // positive = model likes home more than the market does
    modelSide = diff >= 0 ? i.home.abbr : i.away.abbr;
    const favAbbr = marketMargin >= 0 ? i.home.abbr : i.away.abbr;
    const modelFavMargin = marketMargin >= 0 ? margin : -margin;
    const mktFavMargin = Math.abs(marketMargin);
    const gap = Math.abs(diff);
    vsMarket =
      gap < 2
        ? `Model and market agree: ${favAbbr} by about ${mktFavMargin.toFixed(1)}.`
        : modelFavMargin > mktFavMargin
          ? `Model has ${favAbbr} by ${modelFavMargin.toFixed(1)}; the market has ${mktFavMargin.toFixed(1)}. The model leans ${favAbbr} against the number by ${gap.toFixed(1)}.`
          : modelFavMargin >= 0
            ? `Model has ${favAbbr} by only ${modelFavMargin.toFixed(1)}; the market has ${mktFavMargin.toFixed(1)}. The model leans ${modelSide} against the number by ${gap.toFixed(1)}.`
            : `Model has ${modelSide} winning outright; the market has ${favAbbr} by ${mktFavMargin.toFixed(1)}. The model leans ${modelSide} against the number by ${gap.toFixed(1)}.`;
  }

  return { winner, winProb, margin: Math.abs(margin), total, home: homePts, away: awayPts, shape, vsMarket, modelSide, basis, confidence };
}
