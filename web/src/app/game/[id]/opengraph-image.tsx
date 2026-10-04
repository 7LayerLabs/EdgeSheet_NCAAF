import { ImageResponse } from "next/og";
import { getGame } from "@/lib/slate";
import { scoutScore, scoreTag } from "@/lib/score";
import { kickoffTime } from "@/lib/format";
import { BODY, DISPLAY, OG, OG_SIZE, firstSentence, ogFontsOrDefault } from "@/lib/og";
import { cardLineFor } from "@/lib/sheet";
import { seasonOf } from "@/lib/report";
import type { Team } from "@/lib/types";

export const alt = "EdgeSheet game card";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

function Logo({ src, abbr }: { src?: string; abbr: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={150} height={150} alt="" style={{ width: 150, height: 150, objectFit: "contain" }} />
  ) : (
    <div style={{ display: "flex", width: 150, height: 150, borderRadius: 999, background: OG.ink, border: `2px solid ${OG.line}`, alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 48, color: OG.chalk }}>{abbr}</div>
  );
}

const name = (t: Team) => `${t.rank ? `No. ${t.rank} ` : ""}${t.short}`;
const pill = { display: "flex", padding: "4px 12px", border: `1px solid ${OG.line}`, borderRadius: 4, background: OG.panel } as const;

/** 1200 x 630 card for one game: logos, names, kickoff, network, Scout Score, projection line, and the pressure point's first sentence. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [game, fonts] = await Promise.all([getGame(id).catch(() => undefined), ogFontsOrDefault()]);

  if (!game) {
    return new ImageResponse(
      <div style={{ display: "flex", width: "100%", height: "100%", background: OG.ink, alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 64, color: OG.chalk }}>EdgeSheet</div>,
      { ...size, fonts },
    );
  }

  const score = scoutScore(game.scoreComponents);
  const tag = scoreTag(game);
  const p = game.projection;
  const line = game.market.spread ? `${game.market.spread.team} ${game.market.spread.line > 0 ? "+" : ""}${game.market.spread.line}` : "no line posted";
  const total = game.market.total ? `O/U ${game.market.total.line}` : "";
  const proj = p ? `Model: ${p.winner} by ${p.margin.toFixed(1)}, ${Math.round(p.winProb * 100)}% · ${p.away} to ${p.home} · total ${p.total}` : "Model: not available for these teams";
  const pressure = firstSentence(game.pressurePoint || cardLineFor(seasonOf(game.kickoff), game.id) || game.whyWatch, 160);
  const scoreColor = score >= 80 ? OG.turf : score >= 55 ? OG.navy : OG.chalk3;

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
          <div style={{ display: "flex", gap: 24, fontSize: 24, color: "rgba(255,255,255,0.85)" }}>
            <span>{game.division}</span>
            <span>{kickoffTime(game.kickoff)} ET</span>
            <span>{game.network || "no TV listed"}</span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, padding: "28px 48px 0", gap: 36 }}>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <Logo src={game.away.logo} abbr={game.away.abbr} />
              <div style={{ display: "flex", flexDirection: "column", fontFamily: DISPLAY, fontSize: 60, lineHeight: 1 }}>
                <span>{name(game.away)}</span>
                <span style={{ color: OG.chalk3, fontSize: 32, margin: "6px 0" }}>at</span>
                <span>{name(game.home)}</span>
              </div>
              <Logo src={game.home.logo} abbr={game.home.abbr} />
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 26, color: OG.chalk2 }}>
              <span style={pill}>{line}</span>
              {total && <span style={pill}>{total}</span>}
              <span style={{ display: "flex", padding: "4px 12px" }}>
                {game.away.record} vs {game.home.record}
              </span>
            </div>
            <div style={{ display: "flex", fontSize: 24, color: OG.sky }}>{proj}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", width: 220, background: OG.panel, border: `1px solid ${OG.line}`, borderRadius: 4, padding: "18px 0" }}>
            <span style={{ fontSize: 18, letterSpacing: 2, color: OG.chalk3, textTransform: "uppercase" }}>Scout Score</span>
            <span style={{ fontFamily: DISPLAY, fontSize: 120, lineHeight: 1, color: scoreColor }}>{score}</span>
            <span style={{ display: "flex", marginTop: 8, padding: "4px 12px", background: OG.warn, borderRadius: 4, fontSize: 20, fontWeight: 600, color: OG.chalk }}>{tag}</span>
          </div>
        </div>

        <div style={{ display: "flex", margin: "0 48px 36px", padding: "18px 24px", background: OG.panel, border: `1px solid ${OG.line}`, borderLeft: `6px solid ${OG.navy}`, borderRadius: 4, fontSize: 27, lineHeight: 1.25, color: OG.chalk }}>{pressure || "Pressure point not charted for these teams."}</div>
      </div>
    ),
    { ...size, fonts },
  );
}
