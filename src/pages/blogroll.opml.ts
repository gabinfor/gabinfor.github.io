import { BLOGROLL } from '../data/blogroll';
import { SITE } from '../data/site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function GET() {
  const outlines = BLOGROLL.map((b) =>
    `    <outline type="rss" text="${esc(b.name)}" title="${esc(b.name)}" xmlUrl="${esc(b.feed)}" htmlUrl="${esc(b.url)}"/>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>${esc(SITE.title)} blogroll</title></head>
  <body>
${outlines}
  </body>
</opml>
`;
  return new Response(body, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}
