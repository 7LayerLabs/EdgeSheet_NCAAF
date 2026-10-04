/**
 * Shared bits for the Open Graph images (next/og ImageResponse). Light theme,
 * same tokens as the site. Fonts: Barlow Semi Condensed 700 for display and
 * Source Sans 3 for body, fetched once from Google Fonts and memoized; if the
 * fetch fails (offline), ImageResponse falls back to its bundled sans.
 */
export const OG_SIZE = { width: 1200, height: 630 };

export const OG = {
  ink: "#f3f4f6",
  panel: "#ffffff",
  line: "#dfe3e8",
  chalk: "#0f1f3d",
  chalk2: "#3b4658",
  chalk3: "#6b7482",
  navy: "#0d1f3c",
  turf: "#1a7f3c",
  brick: "#d23a3a",
  sky: "#1f6fcf",
  warn: "#f7d83b",
};

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

// An old browser user agent makes Google Fonts serve TTF or WOFF (not WOFF2), which satori can read.
const FONT_UA = "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0";
let cache: Promise<OgFont[]> | undefined;

async function fetchFont(family: string, weight: 400 | 600 | 700, name: string): Promise<OgFont | undefined> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { headers: { "User-Agent": FONT_UA }, cache: "force-cache" }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src: url\(([^)]+)\) format\((?:'|")?(?:truetype|opentype|woff)(?:'|")?\)/)?.[1];
    if (!url) return undefined;
    const data = await fetch(url, { cache: "force-cache" }).then((r) => (r.ok ? r.arrayBuffer() : undefined));
    return data ? { name, data, weight, style: "normal" } : undefined;
  } catch {
    return undefined;
  }
}

/** Fonts for ImageResponse, or undefined when none loaded (an empty array would disable the bundled default font). */
export async function ogFontsOrDefault(): Promise<OgFont[] | undefined> {
  const f = await ogFonts();
  return f.length ? f : undefined;
}

export function ogFonts(): Promise<OgFont[]> {
  if (!cache) {
    cache = Promise.all([fetchFont("Barlow+Semi+Condensed", 700, "Barlow Semi Condensed"), fetchFont("Source+Sans+3", 400, "Source Sans 3"), fetchFont("Source+Sans+3", 600, "Source Sans 3")]).then((xs) =>
      xs.filter((x): x is OgFont => Boolean(x)),
    );
  }
  return cache;
}

export const DISPLAY = "'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
export const BODY = "'Source Sans 3', system-ui, sans-serif";

/** First sentence of a block of text, for the one line the card has room for. */
export function firstSentence(text: string | undefined, max = 150): string {
  if (!text) return "";
  const s = text.replace(/\s+/g, " ").trim();
  // Sentence ends at . ! or ? followed by a space and a capital, or end of text. Skip Jr. Sr. St. No. vs. and decimals.
  let first = s;
  const re = /[.!?](?=\s+[A-Z"(]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(0, m.index);
    if (/(^|\s)(Jr|Sr|St|No|vs|Mr|Dr|Jan|Feb|Aug|Sept|Oct|Nov|Dec)$/.test(before)) continue;
    first = s.slice(0, m.index + 1);
    break;
  }
  first = first.trim();
  return first.length > max ? `${first.slice(0, max - 3).trimEnd()}...` : first;
}
