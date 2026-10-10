/**
 * Our own Elo, fitted to reproduce CollegeFootballData's pregame Elo.
 *
 * CFBD's Elo is margin-based: a team's rating moves with how far the result beat or
 * missed the margin the ratings expected, not with the win itself (Ohio State beat
 * Nebraska by 4 as a 23-point favorite in 2024 and lost 13 points). Fitted on 5,461
 * consecutive FBS pregame ratings from 2022 to 2025 (scripts/elo-check.mjs):
 *
 *   expected = (rating - oppRating + HFA * site) / POINTS        site: +1 home, -1 away, 0 neutral
 *   change   = K * sign(err) * |err| ^ POWER                     err = actual margin - expected
 *
 * RMSE against CFBD's real week-to-week change: 13.3 Elo points (about half a point of spread),
 * against 44.7 for "no change". Games against FCS opponents are not rated (CFBD carries no FCS
 * Elo; 39% of those games leave the FBS rating unchanged and the rest are noise).
 *
 * Between seasons: next = CARRY * end + (1 - CARRY) * MEAN, fitted on 398 team-seasons (end = last
 * regular-season rating plus bowls), MAE 5.7 Elo. Cold start from last season's end, run on this rule
 * alone, stays within 0.5 to 0.7 spread points of CFBD's ratings through a whole season.
 */
export const ELO = { K: 0.951, POWER: 1.3, HFA: 15, POINTS: 28, CARRY: 0.68, MEAN: 1503 };

export function expectedMargin(rating, opp, site, p = ELO) {
  return (rating - opp + p.HFA * site) / p.POINTS;
}

/** Rating change for the team whose margin is `margin` (its points minus the opponent's). */
export function eloChange(rating, opp, site, margin, p = ELO) {
  const err = margin - expectedMargin(rating, opp, site, p);
  return p.K * Math.sign(err) * Math.abs(err) ** p.POWER;
}

/**
 * Apply one game to a ratings map in place. `fbs` says which teams are rated; a game with an
 * unrated side changes nothing. Returns the pregame ratings it used, or undefined.
 */
export function applyGame(ratings, g, isRated, p = ELO) {
  if (!isRated(g.home) || !isRated(g.away)) return undefined;
  const h = ratings.get(g.home) ?? p.MEAN;
  const a = ratings.get(g.away) ?? p.MEAN;
  const site = g.neutral ? 0 : 1;
  const margin = g.hp - g.ap;
  ratings.set(g.home, h + eloChange(h, a, site, margin, p));
  ratings.set(g.away, a + eloChange(a, h, -site, -margin, p));
  return { h, a };
}

/** CFBD starts a team new to FBS at 1500 (Jacksonville State, Sam Houston, Kennesaw State, Delaware, Missouri State). */
export const NEW_TEAM = 1500;

/**
 * End-of-season ratings: each team's last real pregame rating plus our update for that game,
 * then every postseason game in date order. `games` are backtest rows (hElo/aElo), `bowls`
 * are { home, away, hp, ap, neutral, start } with CFBD school names.
 */
export function seasonEnd(games, fbs, bowls, p = ELO) {
  const last = new Map();
  for (const g of [...games].sort((a, b) => a.start.localeCompare(b.start))) {
    if (!g.completed || g.hp == null) continue;
    if (g.hElo != null) last.set(g.home, g);
    if (g.aElo != null) last.set(g.away, g);
  }
  const ratings = new Map();
  for (const [t, g] of last) {
    const tmp = new Map([[g.home, g.hElo], [g.away, g.aElo]]);
    applyGame(tmp, g, (x) => tmp.get(x) != null && fbs.has(x), p);
    ratings.set(t, tmp.get(t));
  }
  for (const b of [...bowls].sort((x, y) => x.start.localeCompare(y.start))) applyGame(ratings, b, (x) => ratings.has(x), p);
  return ratings;
}

/** Offseason regression toward the mean. */
export function carryOver(ratings, p = ELO) {
  const out = new Map();
  for (const [t, r] of ratings) out.set(t, p.CARRY * r + (1 - p.CARRY) * p.MEAN);
  return out;
}
