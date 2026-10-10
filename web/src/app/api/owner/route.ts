import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerKey } from "@/lib/owner";

export const dynamic = "force-dynamic";

/** GET /api/owner?key=... turns on owner controls in this browser; ?off=1 turns them off. See src/lib/owner.ts. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL("/", url));
  if (url.searchParams.has("off")) {
    res.cookies.delete(OWNER_COOKIE);
    return res;
  }
  const key = ownerKey();
  if (!key || url.searchParams.get("key") !== key) return NextResponse.json({ error: "wrong or missing key" }, { status: 403 });
  res.cookies.set(OWNER_COOKIE, key, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
