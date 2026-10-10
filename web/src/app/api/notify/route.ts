import { NextResponse } from "next/server";
import { listEntries } from "@/lib/archive";
import { NOT_A_PICK, baseUrl, leansDigest, longDate, morningSlate, postgameDigest } from "@/lib/digests";
import { renderSheetPng } from "@/lib/render";
import { etDate, getSlate } from "@/lib/slate";
import { sendMessage, sendPhoto, telegramMissing, telegramReady } from "@/lib/telegram";
import { getPlan } from "@/lib/plan-load";
import { planText } from "@/lib/plan";
import { isOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

type Kind = "slate" | "leans" | "grades" | "sheet" | "plan";

/**
 * Send a digest to Telegram on demand. POST {type: "slate" | "leans" | "grades", date?: "YYYY-MM-DD"}.
 * Used by the "Send to Telegram" buttons. Responds 503 with the missing key when Telegram is not configured.
 */
export async function POST(req: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { type?: Kind; date?: string } | null;
  const type = body?.type;
  if (!type || !["slate", "leans", "grades", "sheet", "plan"].includes(type)) return NextResponse.json({ error: "type must be slate, leans, grades, sheet, or plan" }, { status: 400 });
  if (!telegramReady()) return NextResponse.json({ error: telegramMissing() }, { status: 503 });

  if (type === "plan") {
    // The Saturday plan for the date: current and upcoming half-hour blocks with picks and switch triggers.
    try {
      const { plan } = await getPlan(body?.date);
      const sent = await sendMessage(planText(plan, baseUrl()), { parseMode: "HTML" });
      return NextResponse.json({ ok: true, messages: sent.length });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  if (type === "sheet") {
    // The Saturday sheet as a photo: render /sheet?print=1 with headless Chrome, then sendPhoto.
    const date = body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : etDate();
    try {
      const png = await renderSheetPng(date, baseUrl());
      const sent = await sendPhoto(png, `EdgeSheet, ${longDate(date)}. ${NOT_A_PICK} ${baseUrl()}/sheet?date=${date}`);
      return NextResponse.json({ ok: true, messages: 1, file: png, messageId: sent.message_id });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

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
