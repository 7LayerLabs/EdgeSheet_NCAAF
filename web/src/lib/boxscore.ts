/**
 * Game box scores from CollegeFootballData games/players (per week and
 * classification). Responses can exceed the Next fetch cache limit, so they go
 * through the in-process memo instead.
 */
import { memo } from "./memo";
import { cfbdQuotaExhausted, noteCfbdResponse, type Classification } from "./cfbd";

interface Raw {
  id: number;
  teams: {
    team: string;
    homeAway: "home" | "away";
    points: number | null;
    categories: { name: string; types: { name: string; athletes: { id: string; name: string; stat: string }[] }[] }[];
  }[];
}

export interface BoxLine {
  id: string;
  name: string;
  team: string;
  category: string; // passing, rushing, receiving, defensive, interceptions, ...
  stats: Record<string, string>; // YDS, TD, C/ATT, ...
  headline: string; // "19/39, 221 yds, 2 TD, 1 INT"
  yards: number;
}

export interface BoxScore {
  gameId: string;
  teams: { team: string; homeAway: "home" | "away"; points: number | null; leaders: BoxLine[] }[];
  byPlayer: Map<string, BoxLine[]>;
}

async function fetchWeek(year: number, week: number, seasonType: string, cls: Classification): Promise<Raw[]> {
  const key = process.env.CFBD_API_KEY;
  if (!key) return [];
  return memo(`box:${year}:${week}:${seasonType}:${cls}`, 900, async () => {
    // No fetch cache on this call, so never spend it while the monthly quota is known to be gone.
    if (cfbdQuotaExhausted()) return [];
    const path = `/games/players?year=${year}&week=${week}&seasonType=${seasonType}&classification=${cls}`;
    const res = await fetch(`https://api.collegefootballdata.com${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (await noteCfbdResponse(path, res)) return [];
    if (!res.ok) return [];
    return (await res.json()) as Raw[];
  });
}

function headline(category: string, s: Record<string, string>): { text: string; yards: number } {
  const n = (k: string) => Number(s[k] ?? 0);
  switch (category) {
    case "passing": return { text: `${s["C/ATT"] ?? ""}, ${n("YDS")} yds, ${n("TD")} TD, ${n("INT")} INT`, yards: n("YDS") };
    case "rushing": return { text: `${n("CAR")} car, ${n("YDS")} yds, ${n("TD")} TD`, yards: n("YDS") };
    case "receiving": return { text: `${n("REC")} rec, ${n("YDS")} yds, ${n("TD")} TD`, yards: n("YDS") };
    case "defensive": return { text: `${n("TOT")} tkl, ${n("TFL")} TFL, ${n("SACKS")} sacks${n("PD") ? `, ${n("PD")} PD` : ""}`, yards: n("TOT") * 8 + n("TFL") * 15 + n("SACKS") * 25 };
    case "interceptions": return { text: `${n("INT")} INT, ${n("YDS")} yds`, yards: n("INT") * 40 };
    default: return { text: Object.entries(s).map(([k, v]) => `${k} ${v}`).join(", "), yards: 0 };
  }
}

function parse(raw: Raw): BoxScore {
  const byPlayer = new Map<string, BoxLine[]>();
  const teams = raw.teams.map((t) => {
    const lines: BoxLine[] = [];
    for (const cat of t.categories) {
      const perPlayer = new Map<string, { name: string; stats: Record<string, string> }>();
      for (const type of cat.types) {
        for (const a of type.athletes) {
          const e = perPlayer.get(a.id) ?? perPlayer.set(a.id, { name: a.name, stats: {} }).get(a.id)!;
          e.stats[type.name] = a.stat;
        }
      }
      for (const [id, e] of perPlayer) {
        const h = headline(cat.name, e.stats);
        const line: BoxLine = { id, name: e.name, team: t.team, category: cat.name, stats: e.stats, headline: h.text, yards: h.yards };
        lines.push(line);
        (byPlayer.get(id) ?? byPlayer.set(id, []).get(id)!).push(line);
      }
    }
    const leaders = ["passing", "rushing", "receiving", "defensive", "interceptions"]
      .flatMap((c) => lines.filter((l) => l.category === c).sort((a, b) => b.yards - a.yards).slice(0, c === "receiving" || c === "defensive" ? 2 : 1))
      .filter((l) => l.yards > 0);
    return { team: t.team, homeAway: t.homeAway, points: t.points, leaders };
  });
  return { gameId: String(raw.id), teams, byPlayer };
}

export async function boxScore(gameId: string, year: number, week: number, seasonType: string, cls: Classification): Promise<BoxScore | undefined> {
  const rows = await fetchWeek(year, week, seasonType, cls).catch(() => [] as Raw[]);
  const raw = rows.find((r) => String(r.id) === gameId);
  if (!raw || !raw.teams?.length) return undefined;
  const box = parse(raw);
  return box.teams.some((t) => t.leaders.length) ? box : undefined;
}
