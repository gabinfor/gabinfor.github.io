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

Images can sit next to the post and be linked with a relative path, e.g. `![alt](images/photo.jpg)`; Astro resizes them and converts them to WebP.

### Or write in the browser

Open [gabinfor.github.io/admin/](https://gabinfor.github.io/admin/) (Sveltia CMS). Choose **Sign In Using Access Token**, follow its link to create a GitHub token with read and write access to this repo's contents, and paste it in. The token stays in that browser's local storage. (**Sign In with GitHub** needs an OAuth server, which this site doesn't have.)

Saving a post commits it to `main`, so it's live about a minute later; tick **Draft** to save without publishing. Uploaded images are converted to WebP (at most 2048 px) and stored in `src/content/blog/images/`. The editor lists `.md` posts only, since `.mdx` posts with components are edited in code. Its settings are in `public/admin/config.yml`. Locally, `npm run dev` serves it at `/admin/index.html`.

## Run locally

```sh
npm install
npm run dev
```

## Where things live

- `src/content/blog/`: posts
- `public/admin/`: the in-browser post editor (Sveltia CMS)
- `src/data/blogroll.ts`: blogs I follow (feeds are fetched at build time)
- `src/data/site.ts`: name, tagline, links
- `src/sky/`: the pixel sky engine: time of day, weather, sprites, fireworks, secrets. Preview with `?hour=21` and/or `?weather=storm` (clear, cloudy, rain, storm, snow, fog).
- `src/data/radio.ts`: the radio stations (HTTPS streams; the radio keeps playing as you move between pages)
- `src/scripts/clicky.ts`: click sounds, sparkles, toasts, and the window buttons
- `scripts/make-cursors.mjs`: regenerates the pixel cursors in `public/cursors/`
- `src/components/GpuBlobs.astro`: the WebGPU demo, usable in any `.mdx` post
- `public/button.svg`: my 88x31 button for other people to link to me
- `.github/workflows/deploy.yml`: builds on push and once a day

## Secrets (spoilers!)

- Click the night sky for fireworks, the day sky to startle birds, and the sun for… see for yourself.
- Konami code (↑↑↓↓←→←→BA) starts a fireworks finale.
- Type anywhere outside a text box: `rain`, `snow`, `storm`, `fog`, `cloudy`, `clear`, `forecast`, `boom`, `cat`, `night`, `day`, `now`, `minecraft` (blocky mode), `creeper`, `zombie`, `skeleton`.
- Now and then a cloud drifts in shaped like a sleeping cat. Click it and it leaps up, back arched, then curls up again.
- Minecraft: a rare creeper walks the hill (click it, then step back). Zombies and skeletons wander at night: hit them three times, or wait for sunrise.
- Automatic: fireworks just after midnight on New Year's Day, snow on Dec 24 to 26, an orange moon on Halloween. The moon shows its real phase.
