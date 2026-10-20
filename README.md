# Phoenix Legacy — Command Hub

Monorepo for **Phoenix Legacy (PH-L)** alliance tools.

| App | Path | Live URL |
|-----|------|----------|
| **Command hub (portal)** | `/index.html` | https://transcendent-kitsune-43421d.netlify.app/ |
| **APC Command Console** (legacy static) | `legacy/apc-console/` | https://transcendent-kitsune-43421d.netlify.app/legacy/apc-console/ |
| **PH-L Migration Command** (Vinext + D1) | `apps/migration-command/` | https://phl-migration-command.mossyskink1024.chatgpt.site |

Read **`LEEME_PRIMERO.md`** (Spanish) for migration project setup, data backups, and scope notes.

## APC console (Netlify)

Dark War Survival toolkit: APC CP submissions, shared roster sync, events, server clock, officer analytics.

```bash
cd legacy/apc-console
python3 -m http.server 5500
# open http://localhost:5500
```

Netlify Functions stay at repo root (`netlify/functions`). Pushes to `main` deploy via **Deploy to Netlify** (GitHub Action).

## Migration Command (Sites / Cloudflare)

Private migration workspace: Overview, Roster, Diplomacy, Deployment, Tasks, Settings. Persistence via D1 on OpenAI Sites; local dev uses Vinext + mock auth.

```bash
cd apps/migration-command
npm run install:ci
npm run dev
# http://127.0.0.1:5173
```

Checks:

```bash
node node_modules/typescript/bin/tsc --noEmit
node tests/model.mjs
node tests/storage.mjs
```

Deploy/update the published Sites app using the Sites workflow and `.openai/hosting.json` (`project_id` must stay linked to the existing app).

## Source of truth

GitHub repo `PaulaVD/phl-apc-command` — edit here and push to `main` for Netlify; migration app updates go through the same repo under `apps/migration-command/`.
