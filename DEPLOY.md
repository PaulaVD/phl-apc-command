# Deploy gratis (static site)

El proyecto es HTML/CSS/JS puro — no necesita build ni backend.

## Opción más rápida: Netlify Drop (sin cuenta compleja)

1. Abrí https://app.netlify.com/drop
2. Arrastrá la carpeta completa `phl-apc-command`
3. Netlify te da una URL pública al instante (ej. `https://random-name.netlify.app`)

Para actualizar: Deploys → arrastrá la carpeta de nuevo.

## CLI (Netlify)

```bash
npx --yes netlify-cli login
npx --yes netlify-cli deploy --dir=. --prod
```

## Alternativas gratis

| Servicio | Cómo |
|----------|------|
| **Vercel** | `npx --yes vercel --yes` |
| **Cloudflare Pages** | `npx --yes wrangler pages deploy . --project-name phl-apc` |
| **GitHub Pages** | Subí el repo y activá Pages → Deploy from branch `/` (root) |

## Admin

Código por defecto: `PHL-R5-2026`

Roster/sync multi-dispositivo: ver `README.md` (JSON export o Supabase).
