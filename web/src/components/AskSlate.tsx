"use client";

import Link from "next/link";
import { useState } from "react";

interface Call {
  name: string;
  input: Record<string, unknown>;
  resultSummary: string;
  ms: number;
}

interface Answer {
  question: string;
  answer: string;
  notInData: boolean;
  games: { id: string; label: string }[];
  players: { id: string; label: string }[];
  calls: Call[];
  model: string;
  usage: { costUsd: number };
  stoppedEarly?: string;
}

const EXAMPLES = ["Which game tonight has the biggest line-of-scrimmage mismatch?", "Who are the top three 2027 edge rushers playing today?", "How has the model done against the spread this season?", "Is there a sleeper quarterback worth watching this week?"];

export function AskSlate({ model }: { model: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Answer[]>([]);

  const submit = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const j = (await res.json().catch(() => ({}))) as Answer & { error?: string };
      if (!res.ok) setErr(j.error ?? "Could not get an answer.");
      else {
        setHistory((h) => [j, ...h]);
        setQ("");
      }
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
        className="card mt-4 flex flex-col gap-2 p-3 sm:flex-row"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about today's games, the radar, or the record"
          maxLength={500}
          className="flex-1 rounded border border-line bg-white px-3 py-2 text-base text-chalk outline-none focus:border-navy"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60">
          {busy ? "Looking it up..." : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => void submit(ex)} disabled={busy} className="chip cursor-pointer text-xs hover:border-navy disabled:opacity-60">
            {ex}
          </button>
        ))}
      </div>
      {busy && <p className="mono mt-3 text-xs text-chalk-3">Pulling the slate and the evidence through our own tools. Usually 10 to 40 seconds.</p>}
      {err && <p className="mt-3 text-sm text-brick">{err}</p>}

      <div className="mt-5 grid gap-4">
        {history.map((a, i) => (
          <article key={i} className="card p-5">
            <p className="eyebrow">You asked</p>
            <p className="mt-1 text-base font-semibold text-chalk">{a.question}</p>
            <p className={`mt-3 text-lg leading-relaxed ${a.notInData ? "text-chalk-3" : "text-chalk"}`}>{a.answer}</p>
            {a.stoppedEarly && <p className="mt-1 text-xs text-warn">Stopped early: {a.stoppedEarly}.</p>}
            {(a.games.length > 0 || a.players.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mono text-[11px] text-chalk-3">Used</span>
                {a.games.map((g) => (
                  <Link key={g.id} href={`/game/${g.id}`} className="chip text-xs text-sky hover:border-navy">{g.label}</Link>
                ))}
                {a.players.map((p) => (
                  <Link key={p.id} href={`/player/${p.id}`} className="chip text-xs text-sky hover:border-navy">{p.label}</Link>
                ))}
              </div>
            )}
            <details className="mt-3">
              <summary className="mono cursor-pointer select-none text-[11px] text-chalk-3 hover:text-chalk-2">
                {a.calls.length} tool {a.calls.length === 1 ? "call" : "calls"} · {a.model} · ${a.usage.costUsd.toFixed(4)}
              </summary>
              <ul className="mono mt-2 grid gap-1 text-[11px] text-chalk-2">
                {a.calls.map((c, j) => (
                  <li key={j} className="rounded border border-line bg-panel-2 px-2 py-1">
                    <span className="font-medium text-chalk">{c.name}</span>
                    <span className="text-chalk-3"> {JSON.stringify(c.input)}</span>
                    <span className="block text-chalk-3">{c.resultSummary} · {c.ms} ms</span>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
      {history.length === 0 && <p className="mt-4 text-xs text-chalk-3">Answers come only from what the tools return. If the data does not cover it, the answer says so. Model: {model}.</p>}
    </div>
  );
}
