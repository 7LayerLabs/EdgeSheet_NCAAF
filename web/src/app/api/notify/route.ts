import { NextResponse } from "next/server";
import { listEntries } from "@/lib/archive";
import { leansDigest, morningSlate, postgameDigest } from "@/lib/digests";
import { getSlate } from "@/lib/slate";
import { sendMessage, telegramMissing, telegramReady } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type Kind = "slate" | "leans" | "grades";

/**
 * Send a digest to Telegram on demand. POST {type: "slate" | "leans" | "grades", date?: "YYYY-MM-DD"}.
 * Used by the "Send to Telegram" buttons. Responds 503 with the missing key when Telegram is not configured.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { type?: Kind; date?: string } | null;
  const type = body?.type;
  if (!type || !["slate", "leans", "grades"].includes(type)) return NextResponse.json({ error: "type must be slate, leans, or grades" }, { status: 400 });
  if (!telegramReady()) return NextResponse.json({ error: telegramMissing() }, { status: 503 });

  let text: string | undefined;
  if (type === "grades") {
    // On demand: the ten most recently graded games, newest first on the page but oldest first in the message.
    const graded = listEntries()
      .filter((e) => e.postgame)
      .sort((a, b) => b.postgame!.capturedAt.localeCompare(a.postgame!.capturedAt))
      .slice(0, 10)
      .reverse();
    text = postgameDigest(graded) ?? "No graded games in the archive yet.";
  } else {
    const slate = await getSlate(body?.date);
    text = type === "slate" ? morningSlate(slate) : leansDigest(slate.games.filter((g) => g.division === "FBS" || g.division === "FCS"), slate.date);
  }
  try {
    const sent = await sendMessage(text, { parseMode: "HTML" });
    return NextResponse.json({ ok: true, messages: sent.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ ready: telegramReady(), missing: telegramMissing() ?? null });
}
