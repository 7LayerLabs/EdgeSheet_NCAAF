"use client";

import { useState } from "react";

type Kind = "slate" | "leans" | "grades";

const LABEL: Record<Kind, string> = { slate: "Send slate to Telegram", leans: "Send leans to Telegram", grades: "Send grades to Telegram" };

/**
 * Small button that POSTs /api/notify. Render it only when the server says
 * Telegram is configured (pass `enabled` from a server component); the button
 * returns null otherwise so a missing token never shows a dead control.
 */
export function SendToTelegram({ type, date, enabled, size = "sm" }: { type: Kind; date?: string; enabled: boolean; size?: "sm" | "md" }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string>("");
  if (!enabled) return null;
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  const text = state === "sending" ? "Sending" : state === "sent" ? "Sent" : state === "error" ? "Failed, retry" : LABEL[type];
  const tone = state === "sent" ? "border-turf text-turf" : state === "error" ? "border-brick text-brick" : "border-line-2 text-chalk hover:border-chalk-2";
  async function send() {
    setState("sending");
    setErr("");
    try {
      const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, date }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setState("sent");
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" onClick={send} disabled={state === "sending"} title={err || undefined} className={`inline-flex items-center gap-1.5 rounded border bg-white font-semibold transition-colors disabled:opacity-60 ${pad} ${tone}`}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4z" />
        </svg>
        {text}
      </button>
      {state === "error" && err && <span className="max-w-[16rem] truncate text-[10px] text-brick">{err}</span>}
    </span>
  );
}
