import { XMLParser } from 'fast-xml-parser';
import { BLOGROLL, type Blog } from '../data/blogroll';

export type FeedItem = { blog: Blog; title: string; link: string; date: Date | null };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string => (typeof x === 'object' && x !== null ? (x['#text'] ?? '') : String(x ?? '')).trim();

async function fetchFeed(blog: Blog): Promise<FeedItem[]> {
  try {
    const res = await fetch(blog.feed, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'gabinfor.github.io blogroll' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = parser.parse(await res.text());
    // RSS 2.0
    if (xml.rss) {
      return arr(xml.rss.channel?.item).map((it: any) => ({
        blog, title: text(it.title), link: text(it.link), date: it.pubDate ? new Date(text(it.pubDate)) : null,
      }));
    }
    // Atom
    if (xml.feed) {
      return arr(xml.feed.entry).map((it: any) => {
        const links = arr(it.link);
        const link = links.find((l: any) => !l.rel || l.rel === 'alternate') ?? links[0];
        const d = it.published ?? it.updated;
        return { blog, title: text(it.title), link: link?.href ?? '', date: d ? new Date(text(d)) : null };
      });
    }
    return [];
  } catch (err) {
    console.warn(`[blogroll] skipped ${blog.feed}: ${(err as Error).message}`);
    return [];
  }
}

let cache: Promise<FeedItem[]> | undefined;

/** Latest posts across the whole blogroll, newest first. Fetched once per build. */
export function getBlogrollPosts(): Promise<FeedItem[]> {
  cache ??= Promise.all(BLOGROLL.map(fetchFeed)).then((lists) =>
    lists.flat().filter((i) => i.title && i.link)
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)),
  );
  return cache;
}
