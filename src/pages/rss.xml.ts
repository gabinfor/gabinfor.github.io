import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { SITE } from '../data/site';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', (p) => !p.data.draft))
    .sort((a, b) => +b.data.date - +a.data.date);
  return rss({
    title: SITE.title,
    description: SITE.tagline,
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: `/blog/${p.id}/`,
    })),
  });
}
