import { feedForTeams, youtubeFor, type FeedPlayer } from "@/lib/feed";
import { FeedDisclaimer, FeedItemRow, SourceLine } from "./BeatFeed";

/**
 * Server component for the player page: posts and headlines that mention this player in the last 3 days,
 * plus a YouTube highlights link (or an embed when YOUTUBE_API_KEY is set). Wrap in <Suspense>.
 */
export async function PlayerNews({ player }: { player: FeedPlayer }) {
  const [feed, yt] = await Promise.all([feedForTeams([player.team], [player]), youtubeFor(player.name, player.team)]);
  const items = feed.items.filter((it) => it.tags.includes(player.id));
  const names = { [player.id]: player.name };
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const allOff = feed.sources.every((s) => !s.ok);

  return (
    <div>
      <SourceLine feed={feed} />
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-chalk-3">
          {allOff ? "No source answered. The feed will retry in a few minutes." : `No post or headline named ${player.name} in the last ${feed.windowDays} days.`}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((it) => (
            <FeedItemRow key={it.id} item={it} names={names} now={now} />
          ))}
        </ul>
      )}

      <div className="card mt-4 p-4">
        <p className="eyebrow">Highlights</p>
        {yt.videoId ? (
          <>
            <div className="mt-2 aspect-video w-full overflow-hidden rounded bg-ink-2">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${yt.videoId}`}
                title={yt.title ?? `${player.name} highlights`}
                loading="lazy"
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
            <p className="mt-2 text-xs text-chalk-3">
              {yt.title}
              {yt.channel ? ` · ${yt.channel}` : ""}. Top YouTube result for the player name, not a verified clip.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-chalk-2">
            <a href={yt.searchUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky hover:underline">
              Search YouTube for {player.name} highlights
            </a>
            {yt.note && <span className="mt-1 block text-xs text-chalk-3">{yt.note}</span>}
          </p>
        )}
      </div>
      <FeedDisclaimer />
    </div>
  );
}
