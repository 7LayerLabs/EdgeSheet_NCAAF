import { ImageResponse } from "next/og";
import { getSlate } from "@/lib/slate";
import { scoutScore } from "@/lib/score";
import { kickoffTime } from "@/lib/format";
import { longDate } from "@/lib/digests";
import { BODY, DISPLAY, OG, OG_SIZE, firstSentence, ogFontsOrDefault } from "@/lib/og";
import { cardLineFor } from "@/lib/sheet";
import type { Team } from "@/lib/types";

export const alt = "EdgeSheet slate card";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const name = (t: Team) => `${t.rank ? `No. ${t.rank} ` : ""}${t.short}`;

/** The slate card: today's date and the top three Division I games by Scout Score. */
export default async function Image() {
  const [slate, fonts] = await Promise.all([getSlate().catch(() => undefined), ogFontsOrDefault()]);
  const games = slate
    ? slate.games
        .filter((g) => g.division === "FBS" || g.division === "FCS")
        .sort((a, b) => scoutScore(b.scoreComponents) - scoutScore(a.scoreComponents))
        .slice(0, 3)
    : [];

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.ink, fontFamily: BODY, color: OG.chalk }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: OG.navy, color: "#fff", padding: "18px 48px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: DISPLAY, fontSize: 36 }}>
            <div style={{ display: "flex", width: 34, height: 34, borderRadius: 999, background: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: 999, border: "3px solid #fff" }} />
            </div>
            EdgeSheet
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.85)" }}>{slate?.week ? `${slate.season} · Week ${slate.week.week}` : "College football through an NFL scouting lens"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "26px 48px 0" }}>
          <span style={{ fontSize: 20, letterSpacing: 2, color: OG.chalk3, textTransform: "uppercase" }}>The slate</span>
          <span style={{ fontFamily: DISPLAY, fontSize: 64, lineHeight: 1 }}>{slate ? longDate(slate.date) : "EdgeSheet"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "22px 48px 0", flex: 1 }}>
          {games.length === 0 && <div style={{ display: "flex", fontSize: 28, color: OG.chalk3 }}>No Division I games on this date.</div>}
          {games.map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 20, background: OG.panel, border: `1px solid ${OG.line}`, borderRadius: 4, padding: "12px 20px" }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 52, lineHeight: 1, color: OG.navy, width: 70 }}>{scoutScore(g.scoreComponents)}</span>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <span style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1.05 }}>
                  {name(g.away)} at {name(g.home)}
                </span>
                <span style={{ fontSize: 21, color: OG.chalk2, marginTop: 4 }}>{firstSentence((slate && cardLineFor(slate.season, g.id)) || g.whyWatch, 110)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 22, color: OG.chalk3, width: 150 }}>
                <span>{kickoffTime(g.kickoff)} ET</span>
                <span>{g.network || "no TV listed"}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", padding: "0 48px 24px", fontSize: 20, color: OG.chalk3 }}>Scout Score 0 to 100. Model, not a pick.</div>
      </div>
    ),
    { ...size, fonts },
  );
}
