"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "top" | "tabs" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (variant === "top") {
    return (
      <nav className="hidden items-center gap-1 text-sm sm:flex">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${active(n.href) ? "bg-flag/15 text-flag" : "text-chalk-2 hover:bg-panel hover:text-chalk"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="tabbar sm:hidden" aria-label="Primary">
      {items.map((n) => (
        <Link key={n.href} href={n.href} className="tab" aria-current={active(n.href) ? "page" : undefined}>
          <span className="tab-icon" dangerouslySetInnerHTML={{ __html: n.icon }} />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
