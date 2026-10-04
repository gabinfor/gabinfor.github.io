// Blogs you like. Each `feed` is fetched at build time and its latest posts
// show up on the homepage and /blogroll. `button` is an optional 88x31 image
// URL; without one a pixel button is generated. Example:
//   { name: 'Julia Evans', url: 'https://jvns.ca', feed: 'https://jvns.ca/atom.xml', note: 'How computers work.' },
export type Blog = { name: string; url: string; feed: string; note?: string; button?: string };

export const BLOGROLL: Blog[] = [];
