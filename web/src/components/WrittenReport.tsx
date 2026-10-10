import { asOf } from "@/lib/format";
import { isUnavailable } from "@/lib/llm";
import { readReport, reportProvider, seasonOf } from "@/lib/report";
import type { Game } from "@/lib/types";
import { WriteReportButton } from "./WriteReportButton";
import { isOwner } from "@/lib/owner";

/** Server component. Reads the cached report from disk; never calls a model on page load. Write and Rewrite are owner-only (src/lib/owner.ts). */
export async function WrittenReport({ game, embedded = false }: { game: Game; embedded?: boolean }) {
  const d1 = game.division === "FBS" || game.division === "FCS";
  const cached = d1 ? readReport(seasonOf(game.kickoff), game.id) : undefined;
  const provider = reportProvider();
  const stale = cached?.report && cached.pregame && game.status !== "upcoming";
  const owner = await isOwner();

  // Embedded: the page's collapsible Section already carries the eyebrow and headline.
  const Wrap = embedded ? "div" : "section";
  return (
    <Wrap id={embedded ? undefined : "report"} className={embedded ? "" : "mt-10 scroll-mt-28"}>
      {!embedded && <p className="eyebrow">Written report</p>}
      {cached?.report ? (
        <>
          {!embedded && <h2 className="display mt-1 text-3xl font-bold leading-tight text-chalk sm:text-4xl">{cached.report.headline}</h2>}
          <div className="card mt-3 border-l-4 border-l-navy p-5">
            <p className="text-lg leading-relaxed text-chalk">{cached.report.openingParagraph}</p>
            {cached.report.sections.map((s) => (
              <div key={s.title} className="mt-5 border-t border-line pt-4">
                <h3 className="display text-2xl font-bold text-chalk">{s.title}</h3>
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="mt-2 text-base leading-relaxed text-chalk-2">{p}</p>
                ))}
                {s.factIds.length > 0 && (
                  <details className="fold mt-2">
                    <summary className="fold-head">Show evidence</summary>
                    <p className="fold-body mono text-[11px] text-chalk-3">Rests on evidence {s.factIds.join(", ")}</p>
                  </details>
                )}
              </div>
            ))}
            <p className="mt-5 border-t border-line pt-3 text-base font-semibold text-chalk">{cached.report.oneLineForCard}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="mono text-xs text-chalk-3">
              Written by {cached.model} {asOf(cached.generatedAt)} from evidence as of {asOf(cached.evidenceAsOf)}{cached.pregame ? ", pregame" : ""}. Every name and number checked against the evidence packet ({cached.factCount} facts{cached.attempts > 1 ? `, ${cached.attempts} attempts` : ""}).
            </span>
            {owner && !isUnavailable(provider) && <WriteReportButton id={game.id} label={stale ? "Rewrite with the final" : "Rewrite"} force />}
          </div>
          {owner && stale && <p className="mt-1 text-xs text-warn">This report was written before kickoff. The game has moved on; rewrite it to include what the evidence shows now.</p>}
          {cached.verified && (
            cached.flags && cached.flags.length > 0 ? (
              <details className="mt-1 text-xs text-chalk-3">
                <summary className="cursor-pointer select-none text-warn hover:text-chalk-2">
                  {cached.flags.length} of {cached.verified.sentences} sentences could not be confirmed against the evidence by the judgment model. Names and numbers still passed the hard check.
                </summary>
                <ul className="mt-1.5 grid gap-1 pl-4">
                  {cached.flags.map((f) => (
                    <li key={f.sentence} className="list-disc text-chalk-2">
                      {f.sentence} <span className="mono text-chalk-3">({Math.round(f.supported * 100)}% supported)</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="mono mt-1 text-[11px] text-chalk-3">Second pass: all {cached.verified.sentences} sentences read as supported by the evidence (judgment model).</p>
            )
          )}
        </>
      ) : (
        <>
          {!embedded && <h2 className="display mt-1 text-3xl font-bold leading-tight text-chalk sm:text-4xl">{d1 ? "No report written yet" : "Reports are written for Division I games"}</h2>}
          {d1 && (
            <div className="card mt-3 p-5">
              {!owner ? (
                <p className="text-base text-chalk-2">No written report for this game yet. Reports are written on purpose, not for every game, and only from the evidence on this page.</p>
              ) : isUnavailable(provider) ? (
                <p className="text-sm text-chalk-3">Reports need a model key. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY as a fallback) to .env.local.</p>
              ) : (
                <>
                  <p className="text-base text-chalk-2">
                    A 250 to 450 word report built only from the evidence on this page: the matchups, the projection, the radar names, the style profiles, the forecast, and the market. The model explains and ranks the evidence; it cannot add a player, a stat, or a scheme that is not already here, and every name and number is checked before it shows.
                  </p>
                  {cached?.failed && (
                    <p className="mt-2 text-sm text-brick">Last attempt ({asOf(cached.generatedAt)}, {cached.model}) was rejected and not published: {cached.failed.reasons.join(" / ")}</p>
                  )}
                  <div className="mt-3">
                    <WriteReportButton id={game.id} force={Boolean(cached?.failed)} />
                  </div>
                  <p className="mono mt-2 text-[11px] text-chalk-3">Writer: {provider.model}. Reports are written on purpose, not for every game.</p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Wrap>
  );
}
