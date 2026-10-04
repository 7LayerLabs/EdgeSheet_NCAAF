/**
 * Server loader for the Saturday plan: slate + follows + roster names + live
 * logs for followed players in live games. Used by /plan, /api/notify, and the
 * Telegram bot. Never throws; a plan with notes comes back when a source is out.
 */
import { readFollows } from "./follows";
import { genPlayers } from "./generated";
import { playerLogs, type PlayerLog } from "./playerlog";
import { buildPlan, type Plan, type PlanPlayer } from "./plan";
import { getSlate, type Slate } from "./slate";

/** Followed player ids resolved to name, school, position from the roster digest. Unknown ids are dropped. */
export function followedPlayers(ids: string[]): PlanPlayer[] {
  const want = new Set(ids.map(String));
  if (!want.size) return [];
  return genPlayers()
    .filter((p) => want.has(p.id))
    .map((p) => ({ id: p.id, name: p.n, team: p.t, pos: p.p ?? "" }));
}

/** Live logs for followed players whose game is live, one summary fetch per game. */
export async function followedLogs(slate: Slate, players: PlanPlayer[]): Promise<Record<string, PlayerLog>> {
  const out: Record<string, PlayerLog> = {};
  const byGame = new Map<string, string[]>();
  for (const p of players) {
    const g = slate.games.find((x) => x.status === "live" && (x.home.short === p.team || x.away.short === p.team));
    if (g) byGame.set(g.id, [...(byGame.get(g.id) ?? []), p.id]);
  }
  for (const [gameId, ids] of byGame) {
    try {
      Object.assign(out, await playerLogs(gameId, ids));
    } catch {}
  }
  return out;
}

export async function getPlan(date?: string): Promise<{ plan: Plan; slate: Slate }> {
  const slate = await getSlate(date);
  const follows = readFollows();
  const players = followedPlayers(follows.players);
  const logs = await followedLogs(slate, players);
  const plan = buildPlan({ date: slate.date, games: slate.games, follows, players, logs });
  return { plan, slate };
}
