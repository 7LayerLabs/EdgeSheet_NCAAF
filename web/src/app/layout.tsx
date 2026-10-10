import type { Metadata, Viewport } from "next";
import { Barlow_Semi_Condensed, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const barlow = Barlow_Semi_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const source = Source_Sans_3({
  variable: "--font-source",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "EdgeSheet",
  description: "Pick any college football game and know why it is worth watching.",
};

export const viewport: Viewport = {
  themeColor: "#0d1f3c",
};

const I = {
  slate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v4M16 4v4"/></svg>',
  radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v9l6 3"/></svg>',
  rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21h8M12 17v4M5 4h14l-1 7a6 6 0 0 1-12 0z"/><path d="M5 6H3a2 2 0 0 0 0 4h2M19 6h2a2 2 0 0 1 0 4h-2"/></svg>',
  draft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V5M4 19h16M8 15V9M12 15V6M16 15v-4"/></svg>',
  record: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 16.5h.01"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>',
  track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
};

const NAV = [
  { href: "/", label: "Slate", icon: I.slate },
  { href: "/radar", label: "Radar", icon: I.radar },
  { href: "/rankings", label: "Top 25", icon: I.rank },
  { href: "/draft", label: "Draft", icon: I.draft },
  { href: "/history", label: "Record", icon: I.record },
  { href: "/watchlist", label: "Watchlist", icon: I.star },
];

/** Secondary pages behind the More menu (desktop dropdown, mobile sheet from the tab bar). */
const MORE = [
  { href: "/ask", label: "Ask", icon: I.ask },
  { href: "/feed", label: "Feed", icon: I.feed },
  { href: "/edges", label: "Opener edges", icon: I.track },
  { href: "/backtest", label: "Track record", icon: I.track },
  { href: "/sheet", label: "Sheet", icon: I.sheet },
  { href: "/plan", label: "Plan", icon: I.plan },
  { href: "/board", label: "My board", icon: I.board },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${source.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col field">
        <header className="topbar sticky top-0 z-30">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="display flex items-center gap-2 text-3xl font-bold text-white">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v8l5 3" /></svg>
              </span>
              EdgeSheet
            </Link>
            <NavLinks items={NAV} more={MORE} variant="top" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:pb-24">{children}</main>
        <NavLinks items={NAV} more={MORE} variant="tabs" />
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-chalk-3">
          Schedules, scores, records, and lines from CollegeFootballData and ESPN. Forecasts from the National Weather Service. Prospects from a curated file. Nothing is invented; gaps are labeled.
        </footer>
      </body>
    </html>
  );
}
