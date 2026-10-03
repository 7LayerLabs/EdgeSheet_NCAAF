/**
 * Route-level loading state. Next shows this the instant a link is clicked,
 * before the server has finished rendering the destination page.
 */
export default function Loading() {
  return (
    <div className="rise" aria-busy="true" aria-live="polite">
      <div className="skel h-3 w-32 rounded" />
      <div className="skel mt-3 h-10 w-80 max-w-full rounded-lg" />
      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        <div className="skel h-20 rounded-2xl" />
        <div className="skel h-20 rounded-2xl" />
      </div>
      <div className="mt-6 grid gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skel h-28 rounded-2xl" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <p className="mono mt-4 text-xs text-chalk-3">Loading live data</p>
    </div>
  );
}
