# Deploy

## Live URL (unchanged)

**https://transcendent-kitsune-43421d.netlify.app/**

Netlify site id: `ea9f0eb9-e894-4d21-8665-08be77d8b6d3`

## Continuous deploy

1. Push to `main` on GitHub (`https://github.com/PaulaVD/phl-apc-command`).
2. GitHub Action drafts a deploy, then restores it to production (same public URL).

Repo secrets (already set from Netlify CLI login): `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`.

## Note on Netlify credits

If the account hits free credit limits, `netlify deploy --prod` may return 403 (“credit usage exceeded”). The Action uses draft + restore so the shared link keeps updating without changing the URL.

## Config

Do not point `cloudApiUrl` / `adminRealtimeUrl` away from the Netlify domain.
