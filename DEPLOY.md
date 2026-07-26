# Deploy

## Live URL (unchanged)

**https://transcendent-kitsune-43421d.netlify.app/**

Netlify site id: `ea9f0eb9-e894-4d21-8665-08be77d8b6d3`

## Continuous deploy

1. Push to `main` on GitHub (`PaulaVD/phl-apc-command`).
2. The `Deploy to Netlify` GitHub Action builds/publishes to that same site.

Required repo secrets: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`.

## Manual deploy

```bash
npx --yes netlify-cli login   # once
npx --yes netlify-cli deploy --dir=. --prod
```

Do not point `cloudApiUrl` / `adminRealtimeUrl` away from the Netlify domain.
