import { NextResponse } from "next/server";
import { getSlate } from "@/lib/slate";
import { cfbdQuotaStatus } from "@/lib/cfbd";

export const dynamic = "force-dynamic";

/**
 * Small JSON view of the slate for the ops scripts (prewarm, healthcheck).
 * GET /api/slate?date=YYYY-MM-DD. Returns only ids, kickoffs, statuses, and
 * divisions, never the full Game objects. Hitting it also warms the slate
 * memo the pages read from, so the prewarm script calls it first.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? undefined;
  const slate = await getSlate(date);
  const pick = (g: (typeof slate.games)[number]) => ({
    id: g.id,
    kickoff: g.kickoff,
    status: g.status,
    division: g.division,
    home: g.home.short,
    away: g.away.short,
  });
  return NextResponse.json(
    {
      source: slate.source,
      /** Whether CFBD's monthly quota is known to be exhausted (the slate then comes from ESPN). Scripts read this before warming CFBD-backed pages. */
      cfbdQuota: cfbdQuotaStatus(),
      season: slate.season,
      date: slate.date,
      days: slate.days,
      games: slate.games.map(pick),
      weekGames: slate.weekGames.map(pick),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
