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
- `src/sky/`: the pixel sky engine: time of day, weather, sprites, fireworks, secrets. Preview with `?hour=21` and/or `?weather=storm` (clear, cloudy, rain, storm, snow, fog).
- `src/data/radio.ts`: the radio stations (music-only HTTPS streams)
- `src/scripts/clicky.ts`: click sounds, sparkles, toasts, and the window buttons
- `scripts/make-cursors.mjs`: regenerates the pixel cursors in `public/cursors/`
- `src/components/GpuBlobs.astro`: the WebGPU demo, usable in any `.mdx` post
- `public/button.svg`: my 88x31 button for other people to link to me
- `.github/workflows/deploy.yml`: builds on push and once a day

## Secrets (spoilers!)

- Click the night sky for fireworks, the day sky to startle birds, and the sun for… see for yourself.
- Konami code (↑↑↓↓←→←→BA) starts a fireworks finale.
- Type anywhere outside a text box: `rain`, `snow`, `storm`, `fog`, `cloudy`, `clear`, `forecast`, `boom`, `cat`, `dog`, `night`, `day`, `now`, `minecraft` (blocky mode), `creeper`, `zombie`, `skeleton`.
- Now and then a cloud drifts in shaped like a cat or a dog. Click it.
- Minecraft: a rare creeper walks the hill (click it, then step back). Zombies and skeletons wander at night: hit them three times, or wait for sunrise.
- Automatic: fireworks just after midnight on New Year's Day, snow on Dec 24 to 26, an orange moon on Halloween. The moon shows its real phase.
