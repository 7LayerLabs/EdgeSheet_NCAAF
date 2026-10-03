"use client";

import { useSyncExternalStore, useCallback } from "react";

const KEY = "sts-watchlist-v1";

export interface Watchlist {
  games: string[];
  players: string[];
  /** School names as CollegeFootballData spells them. */
  teams: string[];
}

const EMPTY: Watchlist = { games: [], players: [], teams: [] };
const SERVER_SNAPSHOT = { list: EMPTY, ready: false };

let cache: { raw: string | null; value: { list: Watchlist; ready: boolean } } | undefined;
const listeners = new Set<() => void>();

function snapshot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (cache && cache.raw === raw) return cache.value;
  let list = EMPTY;
  try {
    if (raw) list = { ...EMPTY, ...JSON.parse(raw) };
  } catch {}
  cache = { raw, value: { list, ready: true } };
  return cache.value;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useWatchlist() {
  const { list, ready } = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);

  const toggle = useCallback((kind: keyof Watchlist, id: string) => {
    const prev = snapshot().list;
    const has = prev[kind].includes(id);
    const next = { ...prev, [kind]: has ? prev[kind].filter((x) => x !== id) : [...prev[kind], id] };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    for (const l of listeners) l();
    // Mirror to the server (data/follows.json) so the Telegram bot can see followed teams and players. Fire-and-forget.
    try {
      void fetch("/api/follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next), keepalive: true }).catch(() => {});
    } catch {}
  }, []);

  return { list, toggle, ready };
}
