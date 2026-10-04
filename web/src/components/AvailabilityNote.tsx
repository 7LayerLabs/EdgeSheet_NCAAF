import { availabilityNotes, feedForTeams, judgeFeed, type FeedPlayer } from "@/lib/feed";
import { jevAvailable } from "@/lib/jev";
import { memo } from "@/lib/memo";
import { ago } from "./BeatFeed";

/**
 * Server component, async. Renders the strongest feed-derived injury or availability note for one
 * radar player: "Reported injured, Bluesky 3h ago, unverified" with the link. Only when Jev put the
 * probability at or above FEED_CHIP_MIN. Renders nothing otherwise, so it is safe inside any card.
 * Wrap in <Suspense fallback={null}> so the card never waits for the feed.
 * The feed fetch and the Jev request are shared by every card on the page (memo per school pair).
 */
export async function AvailabilityNote({ schools, players, playerId }: { schools: string[]; players: FeedPlayer[]; playerId: string }) {
  if (!jevAvailable()) return null;
  let notes: Awaited<ReturnType<typeof notesFor>>;
  try {
    notes = await notesFor(schools, players);
  } catch {
    return null;
  }
  const n = notes[playerId];
  if (!n) return null;
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      className="-mb-1 flex items-start gap-2 rounded border border-warn bg-warn/15 px-2.5 py-1.5 text-xs leading-snug text-chalk hover:bg-warn/25"
      title={n.text}
    >
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brick" aria-hidden />
      <span>
        <span className="font-semibold">{n.lead}</span>
        <span className="mono text-chalk-3">
          {" "}
          · {n.source} {ago(n.publishedAt)} · unverified
        </span>
      </span>
    </a>
  );
}

function notesFor(schools: string[], players: FeedPlayer[]) {
  const key = `jev:eye:${[...schools].sort().join("|")}:${players.map((p) => p.id).sort().join(",")}`;
  return memo(key, 5 * 60, async () => {
    const feed = await feedForTeams(schools, players);
    const judged = await judgeFeed(feed.items, players, { purpose: "feed", ref: schools.join("+") });
    return availabilityNotes(judged);
  });
}
