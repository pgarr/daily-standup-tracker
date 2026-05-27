# Repository Guidelines

Astro 6 SSR app with React 19 islands, Tailwind 4, Supabase auth, shadcn/ui, and Cloudflare Workers deployment. See @CLAUDE.md for extended architecture notes.

## Hard Rules

- Always use `cn()` from `@/lib/utils` for Tailwind class merging; never concatenate class strings manually.
- API routes must export `const prerender = false`; do not set `prerender = true` on any endpoint under `src/pages/api/`.
- No Next.js directives (`"use client"`, `"use server"`) in any React component.
- Every new Supabase table must have RLS enabled with per-operation, per-role policies in its migration file.
- Secrets (`SUPABASE_URL`, `SUPABASE_KEY`) must not appear in committed files; use `.env` (Node) or `.dev.vars` (Cloudflare local dev) — both are gitignored.
- Env vars declared via `astro:env/server` are server-only; never import them in client-side code or in any script that runs on the client.

## Project Structure & Module Organization

`src/pages/` holds routes and API endpoints (`api/`, `auth/` subdirectories). `src/components/ui/` is reserved for shadcn/ui components (new-york variant; add with `npx shadcn@latest add [name]`). Shared types go in `src/types.ts`, services and helpers in `src/lib/` or `src/lib/services/`, React hooks in `src/components/hooks/`. Supabase migrations live in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`. Middleware at `src/middleware.ts` resolves `context.locals.user` and enforces `PROTECTED_ROUTES` on every request.

## Build, Test, and Development Commands

See @README.md for the full script list.

No automated test suite. CI gate is lint + build only.

## Coding Style & Naming Conventions

TypeScript strict mode; path alias `@/*` → `./src/*`. Use Astro components for static content and layout; use React only when client-side interactivity is required. ESLint enforces no-console (warn), unused-vars error (`_` prefix exempted), and react-compiler rules. Pre-commit hooks (husky + lint-staged) auto-fix lint on `*.{ts,tsx,astro}` and format `*.{json,css,md}`.

## Commit & Pull Request Guidelines

Conventional Commits: `type(scope): message` or `type: message`. Prefixes observed in history: `docs`, `chore`. CI runs lint + build on every push and PR to `master`; the workflow requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets.

## Security & Configuration

See @README.md for local setup and deployment instructions.
