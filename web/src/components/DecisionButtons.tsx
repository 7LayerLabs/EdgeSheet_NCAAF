"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Decision } from "@/lib/declarations";

export function DecisionButtons({ id, current, senior }: { id: string; current: Decision; senior: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const set = (decision: Decision) =>
    start(async () => {
      setErr(null);
      const res = await fetch("/api/declare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }) });
      if (!res.ok) setErr("Could not save");
      else router.refresh();
    });

  const opts: { key: Decision; label: string }[] = senior
    ? [{ key: "undecided", label: "Eligible (senior)" }, { key: "returning", label: "Returning (extra year)" }]
    : [{ key: "undecided", label: "Undecided" }, { key: "declared", label: "Declared" }, { key: "returning", label: "Returning" }];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={pending}
          aria-pressed={current === o.key}
          onClick={() => set(o.key)}
          className={`rounded border px-2.5 py-1 text-xs font-semibold transition-colors ${
            current === o.key ? "border-navy bg-navy text-white" : "border-line bg-white text-chalk hover:border-navy"
          } disabled:opacity-60`}
        >
          {o.label}
        </button>
      ))}
      {err && <span className="text-xs text-brick">{err}</span>}
    </div>
  );
}
