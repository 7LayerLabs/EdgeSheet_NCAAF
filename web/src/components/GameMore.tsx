import type { ReactNode } from "react";

/**
 * The game page opens on four primary sections; everything else sits in this
 * one collapsed group. Native <details>, so it works with no JavaScript, and
 * JumpOpener opens it (and the section inside) when a deep link points at a
 * section in here.
 */
export function GameMore({ labels, children }: { labels: string[]; children: ReactNode }) {
  return (
    <details id="more" className="sec scroll-mt-28 mt-10">
      <summary className="sec-head">
        <span className="sec-chevron" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">More on this game</span>
          <span className="display mt-0.5 block text-2xl font-bold leading-tight text-chalk sm:text-3xl">
            {labels.length} more {labels.length === 1 ? "section" : "sections"}
          </span>
          <span className="sec-summary">{labels.join(", ")}</span>
        </span>
      </summary>
      <div className="sec-body border-l-2 border-line pl-3 sm:pl-5">{children}</div>
    </details>
  );
}
