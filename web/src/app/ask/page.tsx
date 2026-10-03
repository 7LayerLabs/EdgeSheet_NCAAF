import Link from "next/link";
import { AskSlate } from "@/components/AskSlate";
import { isUnavailable, llmInfo } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default function AskPage() {
  const info = llmInfo({ small: true });
  return (
    <div>
      <Link href="/" className="mono text-xs text-chalk-3 hover:text-chalk">← Slate</Link>
      <p className="eyebrow mt-3">Ask the slate</p>
      <h1 className="display mt-1 text-5xl font-extrabold text-chalk sm:text-6xl">Ask the slate</h1>
      <p className="mt-2 max-w-2xl text-base text-chalk-2">
        A question in, a short answer out, built only from the app&apos;s own data: today&apos;s games, the matchup evidence, the scouting radar, the draft forecast, and the record of graded calls. The tools it used are shown under every answer.
      </p>
      {isUnavailable(info) ? (
        <div className="card mt-4 p-5">
          <p className="text-sm text-chalk-3">Ask needs a model key. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY as a fallback) to .env.local and restart.</p>
        </div>
      ) : (
        <AskSlate model={info.model} />
      )}
    </div>
  );
}
