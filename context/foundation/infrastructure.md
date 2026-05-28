---
project: daily-standup-tracker
researched_at: 2026-05-27
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR (output: "server") + React 19 islands
  runtime: Cloudflare Workers (via @astrojs/cloudflare v13)
  database: Supabase PostgreSQL (external)
  auth: Supabase SSR cookie-based sessions
---

## Recommendation

**Deploy on Cloudflare Workers.**

This stack was scaffolded with `@astrojs/cloudflare` as its native adapter and `wrangler` as its deployment tool — Cloudflare Workers is not an opinion, it is the runtime the framework and adapter were written for. It scores Pass on all five agent-friendly criteria, the free tier comfortably covers MVP traffic, and the developer already has hands-on Cloudflare familiarity. One critical note: `tech-stack.md` lists `deployment_target: cloudflare-pages`, but the `@astrojs/cloudflare` v13 adapter (required for Astro 6) dropped Cloudflare Pages support — the correct target is Workers, and `wrangler.jsonc` must reflect that (see Getting Started).

## Platform Comparison

| Platform | CLI-first | Managed / Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Overall |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Netlify** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| Vercel | Pass | Pass | Pass | Partial ¹ | Partial ² | 3P + 2Pa |
| Render | Pass | Partial ³ | Pass | Pass | Pass | 4P + 1Pa |
| Railway | Partial ⁴ | Partial ³ | Pass | Partial ⁴ | Partial ⁵ | 1P + 4Pa |
| Fly.io | Partial ⁶ | Partial ³ | Partial ⁷ | Pass | Partial ⁸ | 1P + 4Pa |

Notes:
1. Open Astro 6 esbuild parse error (GitHub issue #16258, April 2026); intermittent build failures on Astro 6.1.x + @astrojs/vercel 10.0.x.
2. Vercel MCP is read-only public beta (launched April 2026); no write/mutate operations available.
3. Managed VMs or containers (not fully serverless) — more operational surface area than a pure function runtime.
4. No `railway rollback` CLI command; rollback is dashboard-only. Deployment rollback window: 72h on Hobby.
5. Railway MCP is active development (local) and beta (remote); not GA as of 2026-05-27.
6. No `fly rollback` subcommand; rollback requires re-deploying an old image hash via `fly deploy --image`.
7. No `llms.txt` at fly.io/llms.txt (404); docs are GitHub-backed markdown, not a curated LLM index.
8. `flyctl mcp server` has no explicit GA label as of 2026-05-27; treat as beta.

**Cost weighting applied:** Vercel Hobby prohibits commercial use (Pro required at $20/mo/member); Netlify free tier hits its 125k invocation cap near 100k monthly requests (Pro $19/mo); Railway has no free tier ($5/mo Hobby base); Render free tier spins down after 15 minutes of inactivity with a 50–60 second cold-start penalty. These cost characteristics were weighted against the developer's stated priority to minimize monthly spend.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Native adapter target, zero-friction deploy with `wrangler deploy`, free tier covers 100k requests/day, GA MCP across Workers / R2 / KV / Cloudflare API, best-in-class `llms.txt` and markdown-per-page docs. The one material cost caveat: the Workers Paid plan ($5/mo) is practically required once the AI blocker-similarity feature is active, because the free tier's 10ms CPU-per-request budget is too tight for JWT verification + embedding comparison in the same request.

#### 2. Netlify

Also scores 5/5 on all criteria — GA `@astrojs/netlify` adapter with Astro 6 day-one support, GA MCP (9 tools), full CLI (`netlify deploy --prod`, `netlify logs --follow`), and a stable 60-second function timeout appropriate for AI API calls. Dropped to second place because: (a) the adapter must be swapped from `@astrojs/cloudflare` to `@astrojs/netlify`, adding setup cost; (b) the free tier's 125k invocation cap will be hit at 100k monthly requests, requiring Pro at $19/mo. Primary fallback if any Cloudflare Workers showstopper surfaces.

#### 3. Render

Most cost-effective persistent-process option: Starter tier at $7/month provides an always-on Node.js process with no spin-down, GA MCP (infrastructure management), GA CLI v2.18.0, and an explicit `llms.txt`. Requires adapter swap to `@astrojs/node` (standalone mode) and a `HOST=0.0.0.0` env var. The free tier is unsuitable for production (50–60 second cold-start wake-up). Best choice if the project ever needs persistent WebSocket connections or background processes.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`deployment_target: cloudflare-pages` in `tech-stack.md` is already wrong.** The `@astrojs/cloudflare` v13 adapter dropped Pages deploy support. Running `wrangler pages deploy` with the v13 adapter appears to succeed but serves a blank page or 500 because the Workers-format entrypoint is incompatible with the Pages runtime. Anyone following old tutorials or the Cloudflare dashboard "Connect Git → Pages" flow will silently ship a broken app.

2. **The free tier's 10ms CPU per request won't survive this stack.** Supabase JWT verification + cookie parsing at the middleware layer already burns CPU; the AI blocker-similarity feature (embedding comparison, JSON parsing over N entries) pushes past the limit regularly. The first time it fires in production, the Worker returns a 503 "CPU time limit exceeded" with no graceful fallback. The Workers Paid plan ($5/mo) is the effective minimum.

3. **Secrets wiring is a three-path trap.** Local dev uses `.dev.vars`. CI pipelines need explicit `wrangler secret put` or `--env`-scoped vars in `wrangler.jsonc`. Production reads Workers Secrets (set via `wrangler secret put`). The `astro:env/server` schema maps these to named bindings — not `process.env`. If any code path reads `process.env.SUPABASE_URL` (which the current CLAUDE.md implies), it may work in some environments and silently return `undefined` in others.

4. **Compatibility date gates Web APIs that Supabase needs.** `@supabase/ssr` uses `crypto.subtle` and `fetch`, both gated by the `compatibility_date` in `wrangler.jsonc`. An outdated date causes cryptic "undefined is not a function" errors in token verification or session refresh — errors that only appear in production and are not reproduced by `wrangler dev` if the local compatibility date differs from the deployed one.

5. **Static asset routing changed between Pages and Workers.** Astro outputs static files to `dist/_astro/`; the Workers `assets.directory` binding must point to this correctly or CSS/JS/images return 404 in production. `wrangler dev` serves assets from the local filesystem directly, masking a misconfigured `assets` binding until the first `wrangler deploy`.

### Pre-mortem — How This Could Fail

*Six months in, Daily Standup Tracker's Cloudflare Workers deployment had quietly consumed a third of the available after-hours budget in platform-specific debugging.*

The first two weeks went smoothly. `wrangler deploy` was fast and the standup form worked in production. The first crack appeared in week three: sporadic 503s with "CPU limit exceeded" — the AI blocker-similarity check, added late in the sprint, was pushing past the free tier's 10ms CPU budget. Upgrading to Workers Paid ($5/month) stopped the 503s, but debugging which lines contributed to CPU cost required reading Workers-specific profiling docs that weren't part of the Astro docs the developer had been relying on.

Then Supabase session refresh started failing intermittently on mobile Safari. The `@supabase/ssr` cookie flow hit an edge case when the auth token was within 30 seconds of expiry — and the `workerd` local simulator didn't reproduce it because `.dev.vars` set a longer-lived test token. Two evenings traced it to the `compatibility_date` in `wrangler.jsonc` being below the minimum required for one `crypto.subtle` method. Setting it to a current date fixed the issue, but exposed a subtler problem: some `nodejs_compat` polyfills behaved differently under the new date.

The final blow was a botched rollback after a broken deploy: `wrangler rollback` restored the old Worker script, but the `assets` binding in `wrangler.jsonc` had been updated in the same commit and was not rolled back. The app ran the old code but served broken CSS from the new asset config. The developer spent an evening debugging what looked like a CDN cache issue.

Total platform-specific debugging: ~18 hours across the 5-week MVP — in a project where the full after-hours budget was approximately 40 hours.

### Unknown Unknowns

1. **`wrangler pages deploy` silently deploys a broken app.** If the project was originally wired to Cloudflare Pages (the `tech-stack.md` intent), any git integration set up via the Cloudflare dashboard will keep triggering `wrangler pages deploy`. That command appears to succeed but the Workers-format entrypoint served to the Pages runtime returns a 500. The developer must delete the Pages project and create a Workers project, or disable the Pages integration explicitly.

2. **Workers Paid is not a flat rate beyond $5/mo.** The $5 base covers 30 million CPU milliseconds. At >30ms average CPU per request under load, overages accumulate at $0.02 per 1M additional CPU ms. For an MVP with low traffic this is irrelevant, but the developer should not assume "paid plan = no surprise bills."

3. **`@supabase/ssr` treats Workers as a secondary target.** The library's primary development target is Node.js and Next.js. Cookie handling, session refresh, and SSR auth flow are tested on Node.js first. Any `@supabase/ssr` upgrade that changes the cookie abstraction internals may break on Workers until the Workers-specific compatibility is verified by the Supabase maintainers.

4. **Every future Cloudflare binding (KV, R2, Workers AI) requires both a `wrangler.jsonc` binding AND a TypeScript `Env` interface update.** Missing the type declaration doesn't error at runtime — it types the binding as `any` and silently passes `undefined` to API calls. This pattern is unintuitive for developers used to environment variables.

5. **`astro dev` runs `workerd` natively — standard Node.js debugging tools don't work.** The VS Code Node.js inspector, `--inspect` flag, and breakpoint debugging are not compatible with the `workerd` runtime. Local debugging requires `console.log`-driven development or `wrangler tail` against a deployed Worker. There is no debugger attachment path in local dev.

## Operational Story

- **Preview deploys**: No automatic preview URL per branch in Workers (unlike Pages). Use a separate `[env.staging]` block in `wrangler.jsonc` with `name = "daily-standup-tracker-staging"` and deploy with `wrangler deploy --env staging`. Preview URL is `https://daily-standup-tracker-staging.<subdomain>.workers.dev`. Cloudflare Workers Versions API (GA) supports canary deployments via `wrangler versions upload` + `wrangler versions deploy <id>@<pct>%`, but this is optional for MVP.

- **Secrets**: Set via `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY` — these write encrypted values to Workers Secrets, readable only at runtime. Local dev reads from `.dev.vars` (gitignored ini file). CI pipeline must set secrets before the build step via `echo "SUPABASE_URL=${{ secrets.SUPABASE_URL }}" >> .dev.vars` or the `--secret` flag. Rotation: `wrangler secret put <NAME>` with the new value; the old value is immediately replaced. Never commit secrets to `wrangler.jsonc` or `.dev.vars`.

- **Rollback**: `wrangler rollback [<VERSION_ID>]` instantly promotes the previous (or specified) deployed version. Time-to-revert: typically under 10 seconds globally. Caveat: rollback restores the Worker script only — changes to `wrangler.jsonc` (asset bindings, compatibility date, environment vars) are NOT rolled back. If a broken deploy touched `wrangler.jsonc`, revert the config file manually and redeploy rather than using `wrangler rollback`.

- **Approval**: Agent may run unattended: `wrangler deploy`, `wrangler tail`, `wrangler secret put` (for rotation), `wrangler rollback`. Human-only: deleting a Worker or KV namespace, rotating the Cloudflare API token itself, changing billing plan, modifying DNS records, or any action in the Cloudflare dashboard that affects other projects in the account.

- **Logs**: `wrangler tail [WORKER_NAME] --format json` streams structured live logs. Filter by `--status error` for failures only, `--search <pattern>` for keyword matching, `--sampling-rate 1` for 100% sampling. Historical logs (beyond the live tail window) are in the Cloudflare dashboard under Workers → Logs, or via the Workers Analytics API. Log retention: 3 days on free, 7 days on Workers Paid.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `wrangler pages deploy` silently deploys broken app (Pages entrypoint incompatible with v13 adapter) | Devil's advocate + Unknown unknowns | High (if original Pages integration was created via dashboard) | High | Verify `wrangler.jsonc` targets Workers; delete any Cloudflare Pages project and disable git integration; use `wrangler deploy` exclusively |
| CPU time limit exceeded (free tier 10ms, paid 30ms) causing 503s once AI feature is active | Devil's advocate + Pre-mortem | High | High | Upgrade to Workers Paid ($5/mo) before shipping AI feature; profile CPU usage with `wrangler tail --format json` before launch |
| Secrets undefined in production due to `process.env` vs Workers Secrets binding mismatch | Devil's advocate + Unknown unknowns | Medium | High | Audit all `process.env.*` reads in codebase; replace with `context.locals.runtime.env.*` or `import { env } from 'cloudflare:workers'`; test with `wrangler dev --remote` before deploy |
| Outdated `compatibility_date` breaks Supabase `crypto.subtle` / `fetch` in production | Devil's advocate + Unknown unknowns | Medium | High | Set `compatibility_date` in `wrangler.jsonc` to `"2026-05-27"` or later; update it when upgrading `@astrojs/cloudflare` |
| Static asset 404s in production due to misconfigured `assets.directory` binding | Devil's advocate + Pre-mortem | Medium | Medium | Run `npm run build && wrangler deploy --dry-run` and verify asset bundle before first deploy; confirm `assets.directory` points to Astro's actual static output dir |
| Rollback restores Worker script but not `wrangler.jsonc` config changes (broken partial rollback) | Pre-mortem | Medium | Medium | Treat `wrangler.jsonc` as an immutable config per deploy; only change asset bindings or compatibility date in a dedicated commit, not bundled with feature changes |
| `@supabase/ssr` session refresh fails on near-expiry tokens in Workers (secondary platform target) | Pre-mortem + Unknown unknowns | Low-Medium | Medium | Test auth token expiry flows with `wrangler dev --remote` before launch; monitor Supabase SSR changelog for Workers compatibility notes on upgrades |
| Unexpected Workers billing from CPU overage at higher traffic | Unknown unknowns | Low (MVP scale) | Low | Set Cloudflare spend alert; Workers Paid $5 base covers 30M CPU ms which is sufficient for MVP; revisit if daily active users exceed ~500 |
| No Node.js debugger in `workerd` dev — debugging requires `console.log` or `wrangler tail` | Unknown unknowns | High (will definitely encounter) | Low | Accept as a workflow constraint; use `wrangler tail --format json` for structured log output; structured logging from day one makes this manageable |

## Getting Started

These steps assume the scaffold from `10x-astro-starter` is already in place (Astro 6, `@astrojs/cloudflare` v13, `wrangler.jsonc` present).

1. **Verify `wrangler.jsonc` targets Workers, not Pages.** The entrypoint must be `"main": "@astrojs/cloudflare/entrypoints/server"` — not `dist/_worker.js/index.js` (old format) and not a Pages config. Set `compatibility_date` to today's date or later. Add `"nodejs_compat"` to `compatibility_flags`. If a Cloudflare Pages project was created via the dashboard for this repo, delete it.

2. **Wire secrets for local dev.** Copy `.env.example` to `.dev.vars` (not `.env` — `workerd` reads `.dev.vars`). Set `SUPABASE_URL` and `SUPABASE_KEY` in `.dev.vars`. Confirm `npm run dev` starts without env errors before touching anything else.

3. **Confirm the build and dry-run deploy work.** Run `npm run build && wrangler deploy --dry-run` and inspect the output — verify static assets are included and the entrypoint resolves correctly.

4. **Set production secrets.** Run `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY`. These are encrypted at rest and injected at runtime; they do not appear in deploy output or logs.

5. **Deploy.** Run `npx wrangler deploy` (or `npm run build && wrangler deploy`). The first deploy is free-tier; upgrade to Workers Paid via the Cloudflare dashboard before activating the AI blocker-similarity feature.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow is already scaffolded at `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR, Durable Objects for stateful coordination)
- Cloudflare Access setup for protecting preview/staging Worker URLs
