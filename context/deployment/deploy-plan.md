---
project: daily-standup-tracker
deployed_at: 2026-05-28
platform: Cloudflare Workers
version_id: 565e90ea-32e9-4c75-bb95-cb1209044a1f
---

## Deployed Worker

- **Name**: `daily-standup-tracker`
- **Production URL**: https://daily-standup-tracker.garlej-p.workers.dev
- **Account**: garlej.p@gmail.com (`c07cb4be3da6a4a16e584346b5284046`)
- **Runtime**: Cloudflare Workers (Astro 6 SSR, `@astrojs/cloudflare` v13)

## Secrets wired (names only)

Set via `npx wrangler secret put` — encrypted at rest in Cloudflare's secret store:

- `SUPABASE_URL`
- `SUPABASE_KEY`

## Auto-provisioned bindings

The `@astrojs/cloudflare` adapter provisioned these on first deploy:

- `SESSION` — KV Namespace (`daily-standup-tracker-session`, ID: `69e08a8b75194847915ec318e795c9fe`) — used for session storage
- `IMAGES` — Cloudflare Images binding — used for image optimization
- `ASSETS` — Static asset serving from `dist/client`

## CI auto-deploy

File: `.github/workflows/ci.yml`

Deploy step runs on every push to `master` (not on PRs). Requires two GitHub repository secrets:

| Secret | Value source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | `c07cb4be3da6a4a16e584346b5284046` |

**Manual gate remaining**: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repo secrets at:
`https://github.com/pgarr/daily-standup-tracker/settings/secrets/actions`

## Operational commands

```bash
# Deploy manually
npm run build && npx wrangler deploy

# Roll back to previous version
npx wrangler rollback

# Roll back to a specific version
npx wrangler rollback 565e90ea-32e9-4c75-bb95-cb1209044a1f

# Stream live logs
npx wrangler tail daily-standup-tracker --format json

# List secrets
npx wrangler secret list

# Update a secret
npx wrangler secret put SUPABASE_URL
```

## Notes

- `workers_dev` is enabled (default) — the `.workers.dev` URL is public. Add Cloudflare Access in front of it if a staging/preview URL needs to be protected.
- Static assets are served directly from Cloudflare's edge CDN (not through the Worker) via the `ASSETS` binding.
- The KV namespace for sessions was auto-provisioned; it is separate from any Supabase data.
