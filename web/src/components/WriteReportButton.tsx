"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function WriteReportButton({ id, label = "Write the report", force = false }: { id: string; label?: string; force?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const go = () =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, force }) });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; failed?: { reasons: string[] }; attempts?: number };
        if (res.ok && j.ok) {
          router.refresh();
          return;
        }
        if (j.failed) setMsg(`Not published after ${j.attempts ?? 2} attempts. The model wrote something the evidence does not support: ${j.failed.reasons.join(" / ")}`);
        else setMsg(j.error ?? "Could not write the report.");
      } catch {
        setMsg("Could not reach the server.");
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={`rounded px-4 py-2 text-sm font-semibold transition-colors ${force ? "border border-line bg-white text-chalk hover:border-navy" : "bg-navy text-white hover:bg-navy/90"} disabled:opacity-60`}
      >
        {pending ? "Writing and checking..." : label}
      </button>
      {pending && <span className="mono text-xs text-chalk-3">Usually 20 to 60 seconds. Every name and number gets checked before it shows.</span>}
      {msg && <span className="text-sm text-brick">{msg}</span>}
    </div>
  );
}
