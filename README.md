# PH-L Alliance APC Console

Dark War Survival toolkit for **Phoenix Legacy (PH-L)** APC CP submissions and officer analytics.

## Live URL

**https://transcendent-kitsune-43421d.netlify.app/**

That Netlify URL is the public app link (do not change it). Cloud roster and admin realtime APIs stay on this domain.

## Source of truth

This GitHub repo (`PaulaVD/phl-apc-command`) is the source of truth. Edit here, push to `main`, and the live Netlify site updates.

## How deploy works

Pushes to `main` run the **Deploy to Netlify** GitHub Action. It uploads a draft deploy, then publishes it to the same site URL using `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` repository secrets.

Manual deploy (optional, same account as Netlify CLI login):

```bash
npx --yes netlify-cli deploy --dir=.
# then publish that draft from the Netlify UI, or:
# POST /api/v1/sites/$SITE_ID/deploys/$DEPLOY_ID/restore
```

If Netlify reports “Account credit usage exceeded”, new **production** creates may be blocked until credits reset; draft + restore still updates the live URL.

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
