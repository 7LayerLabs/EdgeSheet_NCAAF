import { NextResponse } from "next/server";
import { fetchPropsForGame, findOddsFile, hasOddsKey, KEY_NOTE } from "@/lib/odds";

/** On-demand player props for one game. Costs 4 Odds API credits; throttled to once an hour per game. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id || !/^\d+$/.test(body.id)) return NextResponse.json({ ok: false, message: "bad id" }, { status: 400 });
  if (!hasOddsKey()) return NextResponse.json({ ok: false, message: KEY_NOTE }, { status: 409 });
  const file = findOddsFile(body.id);
  if (!file) return NextResponse.json({ ok: false, message: "No odds snapshot for this game yet. Open the game page with a key or run odds:snapshot first." }, { status: 404 });
  const result = await fetchPropsForGame(file.season, body.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
