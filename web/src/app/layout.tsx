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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${plex.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col field">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="display text-xl font-bold tracking-wide text-chalk">
              Scout<span className="text-flag"> the </span>Slate
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 text-chalk-2 hover:bg-panel hover:text-chalk">
                Today
              </Link>
              <Link href="/watchlist" className="rounded-md px-3 py-1.5 text-chalk-2 hover:bg-panel hover:text-chalk">
                Watchlist
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5">{children}</main>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-chalk-3">
          Schedules, scores, records, and lines from CollegeFootballData. Forecasts from the National Weather Service. Prospects from a curated file. Nothing is invented; gaps are labeled.
        </footer>
      </body>
    </html>
  );
}
