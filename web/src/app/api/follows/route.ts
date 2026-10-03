import { NextResponse } from "next/server";
import { readFollows, writeFollows } from "@/lib/follows";

/**
 * Mirrors the browser watchlist to data/follows.json so the Telegram bot can
 * read followed teams and players server-side. The useWatchlist hook POSTs the
 * full list on every toggle (fire-and-forget). Last write wins.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { teams?: unknown; players?: unknown; games?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad body" }, { status: 400 });
  const next = writeFollows({ teams: body.teams as string[], players: body.players as string[], games: body.games as string[] });
  return NextResponse.json({ ok: true, counts: { teams: next.teams.length, players: next.players.length, games: next.games.length } });
}

export async function GET() {
  return NextResponse.json(readFollows());
}
