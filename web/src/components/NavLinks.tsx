"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const MORE_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

/**
 * Primary nav. Six primary tabs plus a More menu: a dropdown on desktop and a
 * compact icon-only button at the right end of the mobile tab bar that opens
 * a sheet above the bar. Active state matches the path prefix as before.
 */
export function NavLinks({ items, more = [], variant }: { items: NavItem[]; more?: NavItem[]; variant: "top" | "tabs" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const moreActive = more.some((m) => active(m.href));
  // The menu remembers the path it was opened on, so a route change closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenAt((cur) => ((typeof v === "function" ? v(cur === path) : v) ? path : null));
  const wrap = useRef<HTMLDivElement>(null);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpenAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, path]);

  if (variant === "top") {
    return (
      <nav className="hidden items-center gap-1 text-sm sm:flex">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={`rounded px-3 py-1.5 text-base font-semibold transition-colors ${active(n.href) ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
          >
            {n.label}
          </Link>
        ))}
        {more.length > 0 && (
          <div ref={wrap} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={`flex items-center gap-1 rounded px-3 py-1.5 text-base font-semibold transition-colors ${moreActive || open ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
            >
              More
              <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
              <div role="menu" className="more-menu">
                {more.map((m) => (
                  <Link key={m.href} href={m.href} role="menuitem" aria-current={active(m.href) ? "page" : undefined}>
                    <span className="tab-icon" dangerouslySetInnerHTML={{ __html: m.icon }} />
                    {m.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    );
  }
  return (
    <div ref={wrap} className="sm:hidden">
      {open && more.length > 0 && (
        <div role="menu" className="more-sheet" aria-label="More">
          {more.map((m) => (
            <Link key={m.href} href={m.href} role="menuitem" aria-current={active(m.href) ? "page" : undefined}>
              <span className="tab-icon" dangerouslySetInnerHTML={{ __html: m.icon }} />
              {m.label}
            </Link>
          ))}
        </div>
      )}
      <nav className="tabbar" aria-label="Primary">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className="tab" aria-current={active(n.href) ? "page" : undefined}>
            <span className="tab-icon" dangerouslySetInnerHTML={{ __html: n.icon }} />
            {n.label}
          </Link>
        ))}
        {more.length > 0 && (
          <button type="button" className={`tab-more ${moreActive ? "is-active" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label="More" onClick={() => setOpen((o) => !o)}>
            <span className="tab-icon" dangerouslySetInnerHTML={{ __html: MORE_ICON }} />
            More
          </button>
        )}
      </nav>
    </div>
  );
}
