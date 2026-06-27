# Daily Standup Tracker

A team standup tool where members submit daily did/plan/blockers entries, track their consistency streak, and team leads can monitor the whole team's activity and blocker patterns.

## What it does

- **Submit standups** — each team member fills in what they did, what they plan, and any blockers, once per business day.
- **Streak tracking** — the dashboard shows your current consecutive-day streak so you can see how consistent you've been.
- **Team feed** — team leads see every member's latest standup in a single view.
- **Blocker detection** — when you submit a blocker, the app uses Claude (Haiku) to compare it against recent entries and flag repeated blockers so the team lead can act.
- **Edit & delete** — members can correct or remove their own entries; the streak recalculates automatically.
- **Workspace invitations** — leads invite members by email; role-based access (member vs. team lead) is enforced at the database layer via Supabase RLS.

## Tech stack

- [Astro](https://astro.build/) v6 — SSR, server-rendered by default
- [React](https://react.dev/) v19 — interactive islands
- [TypeScript](https://www.typescriptlang.org/) v5
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Supabase](https://supabase.com/) — auth, Postgres database, row-level security
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime
- [Anthropic Claude](https://www.anthropic.com/) — blocker similarity detection (optional; falls back to keyword matching if key is absent)

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- Docker (for local Supabase)

## Running locally

1. Install dependencies:

```bash
npm install
```

2. Copy the example env files:

```bash
cp .env.example .env
cp .env.example .dev.vars
```

3. Start the local Supabase stack (downloads Docker images on first run):

```bash
npx supabase start
```

Copy the `API URL` and `anon key` printed by the CLI into both `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key>
```

4. Apply migrations:

```bash
npx supabase db reset
```

5. Start the dev server:

```bash
npm run dev
```

The app is available at `http://localhost:4321`. The Supabase Studio UI is at `http://localhost:54323`.

`ANTHROPIC_API_KEY` is optional — leave it blank and blocker detection falls back to Jaccard keyword similarity.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server (Cloudflare workerd runtime) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint with type-checked rules |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier |

## Running tests

Unit tests (Vitest):

```bash
npx vitest run
```

E2E tests (Playwright) — require local Supabase + dev server running:

```bash
npx playwright test
```

E2E specs that need Supabase skip automatically in CI when the local stack is not available.

## Deployment

```bash
npm run build
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, and optionally `ANTHROPIC_API_KEY` as secrets in Cloudflare:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

## CI

GitHub Actions runs lint + build on every push and PR to `master`. Set `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
