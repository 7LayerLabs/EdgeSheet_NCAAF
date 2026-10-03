"use client";

import { useWatchlist, type Watchlist } from "@/lib/watchlist";

export function FollowButton({ kind, id, label, size = "md" }: { kind: keyof Watchlist; id: string; label?: string; size?: "sm" | "md" }) {
  const { list, toggle, ready } = useWatchlist();
  const on = ready && list[kind].includes(id);
  const verb = kind === "games" ? "Watch this game" : kind === "teams" ? "Follow team" : "Follow player";
  const done = kind === "games" ? "Watching" : "Following";
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => toggle(kind, id)}
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors ${pad} ${
        on ? "border-flag bg-flag text-ink" : "border-line-2 text-chalk hover:border-chalk-2"
      }`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {on ? done : label ?? verb}
    </button>
  );
}
