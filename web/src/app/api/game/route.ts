import { NextResponse } from "next/server";
import { getGame } from "@/lib/slate";

export const dynamic = "force-dynamic";

/**
 * GET /api/game?id=<gameId>. The built Game as JSON, through the same 30s memo
 * the game page uses, so the Telegram bot and the ops scripts read one game
 * without building it in their own process (and without their own CFBD calls).
 * 404 when the game cannot be built (bad id, or every source is down).
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id must be a numeric game id" }, { status: 400 });
  const game = await getGame(id).catch(() => undefined);
  if (!game) return NextResponse.json({ error: "game not found or could not be built" }, { status: 404 });
  return NextResponse.json(game, { headers: { "Cache-Control": "no-store" } });
}
