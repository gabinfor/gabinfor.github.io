# gabinfor.github.io

My personal site, built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Write a post

Add a file to `src/content/blog/` (`.md`, or `.mdx` to use components):

```md
---
title: My post
description: One-line summary
date: 2026-10-05
tags: [notes]
---

Text goes here.
```

Push to `main` and it's live in about a minute.

## Run locally

```sh
npm install
npm run dev
```

## Where things live

- `src/content/blog/`: posts
- `src/data/blogroll.ts`: blogs I follow (feeds are fetched at build time)
- `src/data/site.ts`: name, tagline, links
- `src/components/Sky.astro`: the pixel sky, synced to the visitor's local time. Add `?hour=21` to any URL to preview another time.
- `src/scripts/clicky.ts`: click sounds, sparkles, and the window buttons
- `src/components/GpuBlobs.astro`: the WebGPU demo, usable in any `.mdx` post
- `public/button.svg`: my 88x31 button for other people to link to me
- `.github/workflows/deploy.yml`: builds on push and once a day
