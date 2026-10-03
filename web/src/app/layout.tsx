import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scout the Slate",
  description: "Pick any college football game and know why it is worth watching.",
};

export const viewport: Viewport = {
  themeColor: "#0d1218",
};

const I = {
  slate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v4M16 4v4"/></svg>',
  radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v9l6 3"/></svg>',
  rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21h8M12 17v4M5 4h14l-1 7a6 6 0 0 1-12 0z"/><path d="M5 6H3a2 2 0 0 0 0 4h2M19 6h2a2 2 0 0 1 0 4h-2"/></svg>',
  draft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V5M4 19h16M8 15V9M12 15V6M16 15v-4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
};

const NAV = [
  { href: "/", label: "Slate", icon: I.slate },
  { href: "/radar", label: "Radar", icon: I.radar },
  { href: "/rankings", label: "Top 25", icon: I.rank },
  { href: "/draft", label: "Draft", icon: I.draft },
  { href: "/watchlist", label: "Watchlist", icon: I.star },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${plex.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col field">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="display text-xl font-bold tracking-wide text-chalk">
              Scout<span className="text-flag"> the </span>Slate
            </Link>
            <nav className="hidden items-center gap-1 text-sm sm:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-chalk-2 hover:bg-panel hover:text-chalk">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:pb-24">{children}</main>
        <nav className="tabbar sm:hidden" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="tab">
              <span className="tab-icon" dangerouslySetInnerHTML={{ __html: n.icon }} />
              {n.label}
            </Link>
          ))}
        </nav>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-chalk-3">
          Schedules, scores, records, and lines from CollegeFootballData. Forecasts from the National Weather Service. Prospects from a curated file. Nothing is invented; gaps are labeled.
        </footer>
      </body>
    </html>
  );
}
