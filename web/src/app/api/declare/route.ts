import { NextResponse } from "next/server";
import { isOwner } from "@/lib/owner";
import { setDecision, type Decision } from "@/lib/declarations";

export async function POST(req: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { id?: string; decision?: Decision } | null;
  if (!body?.id || !/^\d+$/.test(body.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!["declared", "returning", "undecided"].includes(body.decision ?? "")) return NextResponse.json({ error: "bad decision" }, { status: 400 });
  setDecision(body.id, body.decision!);
  return NextResponse.json({ ok: true });
}
