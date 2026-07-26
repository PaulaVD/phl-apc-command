# PH-L Alliance APC Console

Dark War Survival toolkit for **Phoenix Legacy (PH-L)** APC CP submissions and officer analytics.

## Live URL

**https://transcendent-kitsune-43421d.netlify.app/**

That Netlify URL is the public app link (do not change it). Cloud roster and admin realtime APIs stay on this domain.

## Source of truth

This GitHub repo is the source of truth for the code. Edit here, push to `main`, and the live Netlify site updates.

## How deploy works

Pushes to `main` trigger a GitHub Action that deploys to the existing Netlify site (`ea9f0eb9-e894-4d21-8665-08be77d8b6d3`) using `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` repository secrets. The public URL stays the same.

Manual deploy (optional):

```bash
npx --yes netlify-cli deploy --dir=. --prod
```

## Features

- **Guided** or **Quick submit** entry (paste lines like `PlayerOne i5 820/760/710/655`)
- **Gap to frontline** benchmarks on scan, wizard, roster and rankings
- Officer tools: Discord copy, CSV export, JSON sync, stale / below-frontline filters
- Shared roster sync via Netlify Functions (`/api/roster`)

## Local run

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500`.

## Admin

Default admin access uses **personal codes** (one per officer). Ask an R5 for your code.

## Assets

- `assets/phl-logo.png` — Phoenix Legacy logo
- `assets/phl-apc.png` — APC render
- `assets/*.wav` — Sound effects and ambient music
