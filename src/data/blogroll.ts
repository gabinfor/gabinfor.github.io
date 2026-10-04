// Blogs you like. Each `feed` is fetched at build time and its latest posts
// show up on the homepage and /blogroll. Swap these for your own favourites.
// `button` is an optional 88x31 image URL; without one a pixel button is generated.
export type Blog = { name: string; url: string; feed: string; note?: string; button?: string };

export const BLOGROLL: Blog[] = [
  { name: 'Julia Evans', url: 'https://jvns.ca', feed: 'https://jvns.ca/atom.xml', note: 'Joyful deep-dives into how computers work.' },
  { name: 'Josh W. Comeau', url: 'https://www.joshwcomeau.com', feed: 'https://www.joshwcomeau.com/rss.xml', note: 'Interactive CSS & React explainers.' },
  { name: 'Maggie Appleton', url: 'https://maggieappleton.com', feed: 'https://maggieappleton.com/rss.xml', note: 'Digital gardens, visual essays.' },
  { name: 'Simon Willison', url: 'https://simonwillison.net', feed: 'https://simonwillison.net/atom/everything/', note: 'Daily notes on AI, data & the web.' },
];
