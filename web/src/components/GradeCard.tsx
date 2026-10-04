import Link from "next/link";
import type { Game } from "@/lib/types";
import { asOf } from "@/lib/format";

/**
 * Postgame grade card. Reads the locked pregame call and the postgame grades
 * off game.archive and writes them as one paragraph a fan can read in five
 * seconds. Every number comes from the archive entry; nothing is recomputed.
 */
export function GradeCard({ game }: { game: Game }) {
  const entry = game.archive;
  const final = game.score;
  const teamShort = (abbr?: string) => (abbr === game.home.abbr ? game.home.short : abbr === game.away.abbr ? game.away.short : abbr ?? "");
  const actual = final
    ? final.home === final.away
      ? `It ended tied ${final.home} to ${final.away}`
      : `${final.home > final.away ? game.home.short : game.away.short} won ${Math.max(final.home, final.away)} to ${Math.min(final.home, final.away)}`
    : "Final score not posted yet";

  if (!entry) {
    return (
      <div className="card border-l-4 border-l-brick p-5">
        <p className="eyebrow">Grade card</p>
        <p className="mt-1 text-lg leading-relaxed text-chalk">{actual}. No pregame call was locked for this game, so there is nothing to grade.</p>
        <p className="mt-2 text-xs text-chalk-3">Calls lock when a Division I game is opened before kickoff. <Link href="/history" className="text-sky">See the record</Link>.</p>
      </div>
    );
  }

  const pre = entry.pregame;
  const post = entry.postgame;
  const said = pre.projection ? `We said ${teamShort(pre.projection.winner)} by ${pre.projection.margin.toFixed(1)} at ${Math.round(pre.projection.winProb * 100)}%.` : "No projection was locked.";

  if (!post) {
    return (
      <div className="card border-l-4 border-l-brick p-5">
        <p className="eyebrow">Grade card</p>
        <p className="mt-1 text-lg leading-relaxed text-chalk">
          {said} {actual}. Grading when the box score posts.
        </p>
        <p className="mono mt-2 text-xs text-chalk-3">
          Locked {asOf(pre.capturedAt)}: {pre.edges.length} matchup calls, {pre.prospects.length} radar names, Scout Score {pre.scoutScore}.
        </p>
      </div>
    );
  }

  const graded = post.edges.filter((e) => e.edge !== "even" && e.verdict !== "unmeasured");
  const hits = graded.filter((e) => e.verdict === "played out").length;
  const mixed = graded.filter((e) => e.verdict === "mixed").length;
  const pros = post.prospects.filter((p) => p.verdict !== "unmeasured");
  const showed = pros.filter((p) => p.verdict === "showed up");
  const quiet = pros.filter((p) => p.verdict === "quiet");
  const pr = post.projectionResult;
  const winnerWord = pr ? (pr.winnerRight ? "Winner right" : "Winner wrong") : undefined;

  const sideWord =
    pr?.modelSideCovered !== undefined
      ? `Side ${pr.modelSideCovered ? "covered" : "did not cover"}`
      : post.spreadResult
        ? `Line: ${post.spreadResult}`
        : "No side graded";
  const totalWord =
    pr?.totalLeanRight !== undefined && pre.projection?.totalLean && pre.projection.totalLean !== "none"
      ? `total went ${post.totalResult} against an ${pre.projection.totalLean} lean, ${pr.totalLeanRight ? "right" : "wrong"}`
      : post.totalResult
        ? `total went ${post.totalResult}${pre.total !== undefined ? ` on ${pre.total}` : ""}, no lean to grade`
        : "no total graded";

  const score = hits + showed.length;
  const of = graded.length + pros.length;
  const tone = of === 0 ? "border-l-line-2" : score / of >= 0.6 ? "border-l-turf" : score / of >= 0.4 ? "border-l-warn" : "border-l-brick";

  return (
    <div className={`card border-l-4 p-5 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Grade card</p>
        <span className="mono text-xs text-chalk-3">locked {asOf(pre.capturedAt)} · graded {asOf(post.capturedAt)}</span>
      </div>
      <p className="mt-1 text-lg leading-relaxed text-chalk sm:text-xl">
        {said} {actual}{winnerWord ? `, ${winnerWord.toLowerCase()}${pr ? ` and the margin was off by ${pr.marginError.toFixed(0)}` : ""}` : ""}.{" "}
        {graded.length ? `${hits} of ${graded.length} matchup calls played out${mixed ? `, ${mixed} mixed` : ""}.` : "No matchup call could be graded from the box score."}{" "}
        {pros.length
          ? showed.length
            ? `${showed.map((p) => p.name).join(", ")} showed up${quiet.length ? `; ${quiet.map((p) => p.name).join(", ")} ${quiet.length === 1 ? "was" : "were"} quiet` : ""}.`
            : `None of the ${pros.length} radar names showed up.`
          : "No radar name had a box-score line."}{" "}
        {sideWord}, {totalWord}.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Matchup calls" value={graded.length ? `${hits} of ${graded.length}` : "none"} good={graded.length > 0 && hits >= graded.length / 2} />
        <Tile label="Radar names" value={pros.length ? `${showed.length} of ${pros.length}` : "none"} good={pros.length > 0 && showed.length >= pros.length / 2} />
        <Tile label="Winner" value={pr ? (pr.winnerRight ? "right" : "wrong") : "not graded"} good={pr?.winnerRight} />
        <Tile label="Side" value={pr?.modelSideCovered !== undefined ? (pr.modelSideCovered ? "covered" : "no cover") : post.spreadResult ?? "no line"} good={pr?.modelSideCovered} />
      </div>
      <p className="mt-2 text-xs text-chalk-3">
        Pressure point {post.pressurePointVerdict}. Scout Score was {pre.scoutScore}{post.excitement != null ? `; ESPN excitement index ${post.excitement.toFixed(1)}` : ""}. Full detail under Who showed up. Every graded game goes into <Link href="/history" className="text-sky">the record</Link>.
      </p>
    </div>
  );
}

function Tile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const tone = good === undefined ? "text-chalk" : good ? "text-turf" : "text-brick";
  return (
    <div className="rounded border border-line bg-panel-2 px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className={`display mt-0.5 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
