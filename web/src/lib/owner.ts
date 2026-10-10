/**
 * Owner-only controls (Send to Telegram, rewrite report, model tools).
 *
 * Set EDGESHEET_OWNER_KEY in .env.local, then visit /api/owner?key=<that key>
 * once per browser; it sets an httpOnly cookie for a year. /api/owner?off=1 clears it.
 *
 * With no key set, `next dev` treats every visitor as the owner (it is your machine)
 * and a production build treats nobody as the owner, so a deploy never shows the
 * buttons by accident.
 */
import { cookies } from "next/headers";

export const OWNER_COOKIE = "es_owner";

export const ownerKey = () => process.env.EDGESHEET_OWNER_KEY?.trim() || undefined;

export async function isOwner(): Promise<boolean> {
  const key = ownerKey();
  if (!key) return process.env.NODE_ENV !== "production";
  const jar = await cookies();
  return jar.get(OWNER_COOKIE)?.value === key;
}
