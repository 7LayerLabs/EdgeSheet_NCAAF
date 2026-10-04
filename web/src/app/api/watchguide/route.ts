import { NextResponse } from "next/server";
import { getGame, getSlate } from "@/lib/slate";
import { scoutScore } from "@/lib/score";
import { buildCandidates, evidenceVersion, generateWatchGuide, readGuide } from "@/lib/watchguide";
import { seasonOf } from "@/lib/report";
import { isUnavailable } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?id=: the candidates a guide is checked against plus the cached record, for auditing.
 * GET ?date=YYYY-MM-DD: the day's Division I games (id, label, status, Scout Score, whether a guide is cached),
 * so the batch script can list games through the server's caches instead of calling CFBD itself.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const game = await getGame(id);
    if (!game) return NextResponse.json({ error: "no such game" }, { status: 404 });
    const candidates = buildCandidates(game);
    return NextResponse.json({ gameId: id, title: `${game.away.short} at ${game.home.short}`, status: game.status, evidenceVersion: evidenceVersion(candidates), candidates, cached: readGuide(seasonOf(game.kickoff), id) ?? null });
  }
  const date = url.searchParams.get("date") ?? undefined;
  const slate = await getSlate(date);
  const games = slate.games
    .filter((g) => g.division === "FBS" || g.division === "FCS")
    .map((g) => {
      const cached = readGuide(seasonOf(g.kickoff), g.id);
      return { id: g.id, label: `${g.away.short} at ${g.home.short}`, status: g.status, kickoff: g.kickoff, score: scoutScore(g.scoreComponents), guide: Boolean(cached?.guide), evidenceVersion: cached?.evidenceVersion };
    })
    .sort((a, b) => b.score - a.score);
  return NextResponse.json({ date: slate.date, days: slate.days, games });
}

/** POST { id, force? }: write (or rewrite) the watch guide for one game, validate it, cache it. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: string; force?: boolean } | null;
  if (!body?.id || !/^\d+$/.test(body.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const game = await getGame(body.id);
  if (!game) return NextResponse.json({ error: "no such game" }, { status: 404 });
  if (game.division !== "FBS" && game.division !== "FCS") return NextResponse.json({ error: "guides are written for Division I games only" }, { status: 400 });
  try {
    const prior = readGuide(seasonOf(game.kickoff), game.id)?.generatedAt;
    const out = await generateWatchGuide(game, { force: Boolean(body.force) });
    if (isUnavailable(out)) return NextResponse.json({ error: out.unavailable, unavailable: true }, { status: 503 });
    const base = { gameId: game.id, title: `${game.away.short} at ${game.home.short}`, status: game.status, model: out.model, provider: out.provider, ranker: out.ranker, rankerNote: out.rankerNote, attempts: out.attempts, attemptLog: out.attemptLog, candidateCount: out.candidateCount, top: out.top, evidenceVersion: out.evidenceVersion, costUsd: out.usage.costUsd, cached: out.generatedAt === prior };
    if (out.failed) return NextResponse.json({ ok: false, failed: out.failed, ...base }, { status: 422 });
    return NextResponse.json({ ok: true, guide: out.guide, ...base });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
