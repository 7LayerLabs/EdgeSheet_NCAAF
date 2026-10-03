import { NextResponse } from "next/server";
import { ask } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { question }: tool-using answer from our own data, with the tool calls shown. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const q = body?.question?.trim();
  if (!q) return NextResponse.json({ error: "ask something" }, { status: 400 });
  try {
    const out = await ask(q);
    if ("unavailable" in out) return NextResponse.json({ error: out.unavailable, unavailable: true }, { status: 503 });
    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
